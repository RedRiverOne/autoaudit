#!/usr/bin/env node
import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'
import chalk from 'chalk'
import * as path from 'path'
import { DEVICES } from './config.js'
import { discoverPages } from './discovery.js'
import { launchBrowser, createContext, openPage, closeBrowser } from './browser.js'
import { checkBrokenLinks } from './audits/broken-links.js'
import { runVisualAudit } from './audits/visual.js'
import { runAccessibilityAudit } from './audits/accessibility.js'
import { runLighthouseAudit } from './audits/lighthouse.js'
import { runSecurityAudit } from './audits/security.js'
import { runDepsAudit } from './audits/deps.js'
import { generateReport } from './report/html.js'
import { generateClaudeFile } from './report/claude.js'
import type { AuditResult, PageResult, DevicePageResult, LighthouseScores } from './types.js'

const argv = await yargs(hideBin(process.argv))
  .usage('Usage: $0 <url> [options]')
  .positional('url', { type: 'string', describe: 'Target base URL' })
  .option('concurrency', { type: 'number', default: 3, describe: 'Max parallel operations' })
  .option('timeout', { type: 'number', default: 30000, describe: 'Page timeout (ms)' })
  .option('crawl-depth', { type: 'number', default: 2, describe: 'Link crawl depth' })
  .option('output', { type: 'string', default: './reports', describe: 'Report output directory' })
  .option('skip', { type: 'string', default: '', describe: 'Comma-separated modules to skip (broken-links,visual,accessibility,lighthouse,security,deps)' })
  .option('max-pages', { type: 'number', default: 20, describe: 'Max pages to audit' })
  .demandCommand(1, 'Provide a target URL')
  .help()
  .argv

const baseUrl = (argv._[0] as string).replace(/\/$/, '')
const outputDir = path.resolve(argv.output as string)
const skip = new Set((argv.skip as string).split(',').filter(Boolean))
const maxPages = argv['max-pages'] as number
const concurrency = argv.concurrency as number
const timeout = argv.timeout as number
const crawlDepth = argv['crawl-depth'] as number
const startTime = Date.now()

console.log(chalk.bold(`\n  AutoAudit — ${baseUrl}\n`))

// 1. Discovery
console.log(chalk.cyan('  [1/7] Discovering pages...'))
let paths = await discoverPages(baseUrl, crawlDepth)
if (paths.length > maxPages) paths = paths.slice(0, maxPages)
console.log(chalk.gray(`         Found ${paths.length} pages`))

// 2. Broken Links
const brokenLinks = skip.has('broken-links') ? [] : await (async () => {
  console.log(chalk.cyan('  [2/7] Checking broken links...'))
  const result = await checkBrokenLinks(baseUrl, paths, concurrency)
  console.log(chalk.gray(`         ${result.length} broken links found`))
  return result
})()

// 3. Security
const securityIssues = skip.has('security') ? [] : await (async () => {
  console.log(chalk.cyan('  [3/7] Running security checks...'))
  const result = await runSecurityAudit(baseUrl, paths)
  console.log(chalk.gray(`         ${result.length} issues found`))
  return result
})()

// 4-6. Browser-based audits (visual, accessibility, lighthouse)
console.log(chalk.cyan('  [4/7] Launching browser...'))
const browser = await launchBrowser()

const pageResults: PageResult[] = []

for (let i = 0; i < paths.length; i++) {
  const p = paths[i]
  const pageUrl = `${baseUrl}${p}`
  console.log(chalk.cyan(`  [5/7] Auditing ${p} (${i + 1}/${paths.length})`))

  const deviceResults: DevicePageResult[] = []

  for (const device of DEVICES) {
    const ctx = await createContext(device)
    try {
      const { page, statusCode, loadTimeMs } = await openPage(ctx, pageUrl, timeout)

      // Visual
      let screenshotPath = ''
      let visualIssues: DevicePageResult['visualIssues'] = []
      if (!skip.has('visual')) {
        const vis = await runVisualAudit(page, device.name, p, outputDir)
        screenshotPath = vis.screenshotPath
        visualIssues = vis.issues
      }

      // Accessibility
      let accessibility: DevicePageResult['accessibility'] = { violations: [], passes: 0, incomplete: 0 }
      if (!skip.has('accessibility')) {
        accessibility = await runAccessibilityAudit(page)
      }

      deviceResults.push({
        device: device.name,
        screenshotPath,
        accessibility,
        visualIssues,
        loadTimeMs,
      })

      await page.close()
    } catch (e) {
      console.log(chalk.yellow(`         ${device.name} failed: ${(e as Error).message}`))
      deviceResults.push({
        device: device.name,
        screenshotPath: '',
        accessibility: { violations: [], passes: 0, incomplete: 0 },
        visualIssues: [],
        loadTimeMs: 0,
      })
    } finally {
      await ctx.close()
    }
  }

  // Lighthouse (launches its own Chrome, one pass per page)
  let lighthouse: LighthouseScores | null = null
  if (!skip.has('lighthouse')) {
    console.log(chalk.gray(`         Running Lighthouse...`))
    lighthouse = await runLighthouseAudit(pageUrl)
  }

  pageResults.push({
    url: pageUrl,
    path: p,
    statusCode: 200,
    devices: deviceResults,
    lighthouse,
  })
}

await closeBrowser()

// 7. Dependency audit
const depVulnerabilities = skip.has('deps') ? [] : (() => {
  console.log(chalk.cyan('  [7/7] Checking dependencies...'))
  return runDepsAudit()
})()

// Compute summary
const totalViolations = pageResults.reduce((sum, p) =>
  sum + p.devices.reduce((ds, d) => ds + d.accessibility.violations.length, 0), 0)

const lhPages = pageResults.filter(p => p.lighthouse)
const avgLH = (key: keyof LighthouseScores) => {
  const scores = lhPages.map(p => p.lighthouse![key]).filter((s): s is number => s !== null)
  return scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null
}

const secCounts = { critical: 0, high: 0, medium: 0, low: 0 }
for (const i of securityIssues) secCounts[i.severity]++

const avgLighthouse: LighthouseScores = {
  performance: avgLH('performance'),
  accessibility: avgLH('accessibility'),
  seo: avgLH('seo'),
  bestPractices: avgLH('bestPractices'),
}

// Grade calculation
const scores: number[] = []
scores.push(Math.max(0, 100 - brokenLinks.length * 10)) // broken links
scores.push(Math.max(0, 100 - totalViolations * 5)) // accessibility
if (avgLighthouse.performance !== null) scores.push(avgLighthouse.performance)
if (avgLighthouse.accessibility !== null) scores.push(avgLighthouse.accessibility)
scores.push(Math.max(0, 100 - secCounts.critical * 25 - secCounts.high * 15 - secCounts.medium * 5))

const avg = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0
const grade = avg >= 90 ? 'A' : avg >= 80 ? 'B+' : avg >= 70 ? 'B' : avg >= 60 ? 'C' : avg >= 45 ? 'D' : 'F'

const result: AuditResult = {
  timestamp: new Date().toISOString(),
  baseUrl,
  durationMs: Date.now() - startTime,
  pages: pageResults,
  brokenLinks,
  securityIssues,
  depVulnerabilities,
  summary: {
    totalPages: pageResults.length,
    brokenLinkCount: brokenLinks.length,
    accessibilityViolations: totalViolations,
    securityCounts: secCounts,
    avgLighthouse,
    grade,
  },
}

// Generate report
console.log(chalk.cyan('\n  Generating report...'))
const reportPath = generateReport(result, outputDir)

const claudePath = generateClaudeFile(result, outputDir)

console.log(chalk.bold.green(`\n  Done! Grade: ${grade}`))
console.log(chalk.gray(`  Report:  ${reportPath}`))
console.log(chalk.gray(`  Claude:  ${claudePath}`))
console.log(chalk.gray(`  Duration: ${Math.round(result.durationMs / 1000)}s\n`))

// Summary table
console.log(chalk.bold('  Summary:'))
console.log(`    Pages:          ${result.summary.totalPages}`)
console.log(`    Broken Links:   ${result.summary.brokenLinkCount}`)
console.log(`    A11y Issues:    ${result.summary.accessibilityViolations}`)
console.log(`    Security:       ${secCounts.critical} critical, ${secCounts.high} high, ${secCounts.medium} medium`)
console.log(`    Lighthouse:     Perf ${avgLighthouse.performance ?? '—'} | A11y ${avgLighthouse.accessibility ?? '—'} | SEO ${avgLighthouse.seo ?? '—'} | BP ${avgLighthouse.bestPractices ?? '—'}`)
console.log()
