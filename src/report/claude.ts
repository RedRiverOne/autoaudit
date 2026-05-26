import * as fs from 'fs'
import * as path from 'path'
import type { AuditResult } from '../types.js'

export function generateClaudeFile(result: AuditResult, outputDir: string): string {
  const ts = result.timestamp.replace(/[:.]/g, '-')
  const mdPath = path.join(outputDir, `audit-${ts}.claude.md`)
  const s = result.summary

  const lines: string[] = []

  lines.push(`# AutoAudit Report — ${result.baseUrl}`)
  lines.push(`**Date:** ${new Date(result.timestamp).toLocaleString()}`)
  lines.push(`**Grade:** ${s.grade} | **Pages:** ${s.totalPages} | **Duration:** ${Math.round(result.durationMs / 1000)}s`)
  lines.push(`**Lighthouse Avg:** Perf ${s.avgLighthouse.performance ?? '—'} | A11y ${s.avgLighthouse.accessibility ?? '—'} | SEO ${s.avgLighthouse.seo ?? '—'} | BP ${s.avgLighthouse.bestPractices ?? '—'}`)
  lines.push('')
  lines.push('---')
  lines.push('')

  // Broken links
  if (result.brokenLinks.length) {
    lines.push(`## Broken Links (${result.brokenLinks.length})`)
    lines.push('')
    lines.push('Fix these broken links in the codebase. Search for the link text or href to find the source.')
    lines.push('')
    for (const l of result.brokenLinks) {
      const sourcePath = l.sourceUrl.replace(result.baseUrl, '')
      lines.push(`- **${l.targetUrl}** → ${l.statusCode ?? 'timeout'} (${l.type})`)
      lines.push(`  - Found on: \`${sourcePath}\`${l.anchorText ? ` — link text: "${l.anchorText}"` : ''}`)
      if (l.type === 'broken-anchor') {
        lines.push(`  - Fix: The anchor target ID does not exist on the page. Either add the ID to the target element or remove the anchor link.`)
      } else if (l.type === 'http-error' && l.statusCode === 404) {
        lines.push(`  - Fix: The linked page does not exist. Update the href to point to the correct URL, or remove the link.`)
      }
    }
    lines.push('')
  }

  // Security
  if (result.securityIssues.length) {
    lines.push(`## Security Issues (${result.securityIssues.length})`)
    lines.push('')
    for (const i of result.securityIssues) {
      lines.push(`### [${i.severity.toUpperCase()}] ${i.type}`)
      lines.push(`- **Issue:** ${i.description}`)
      lines.push(`- **URL:** \`${i.url}\``)
      lines.push(`- **Fix:** ${i.recommendation}`)
      if (i.type === 'missing-header') {
        lines.push(`- **Where to fix:** Add the header in the server configuration or SvelteKit hooks (\`src/hooks.server.ts\`). Example:`)
        lines.push('  ```typescript')
        lines.push(`  response.headers.set('${i.description.replace('Missing security header: ', '')}', 'value-here')`)
        lines.push('  ```')
      }
      lines.push('')
    }
  }

  // Per-page accessibility issues
  const a11yByRule = new Map<string, { rule: string; impact: string; description: string; helpUrl: string; pages: string[]; elements: string[] }>()
  for (const p of result.pages) {
    for (const d of p.devices) {
      for (const v of d.accessibility.violations) {
        const existing = a11yByRule.get(v.id)
        const targets = v.nodes.map(n => n.target.join(' > '))
        if (existing) {
          if (!existing.pages.includes(`${p.path} (${d.device})`)) existing.pages.push(`${p.path} (${d.device})`)
          for (const t of targets) if (!existing.elements.includes(t)) existing.elements.push(t)
        } else {
          a11yByRule.set(v.id, {
            rule: v.id,
            impact: v.impact,
            description: v.description,
            helpUrl: v.helpUrl,
            pages: [`${p.path} (${d.device})`],
            elements: targets,
          })
        }
      }
    }
  }

  if (a11yByRule.size) {
    lines.push(`## Accessibility Violations (${s.accessibilityViolations} total, ${a11yByRule.size} unique rules)`)
    lines.push('')
    lines.push('These are grouped by rule. Fix the rule once and it resolves across all pages.')
    lines.push('')

    const sorted = [...a11yByRule.values()].sort((a, b) => {
      const order: Record<string, number> = { critical: 0, serious: 1, moderate: 2, minor: 3 }
      return (order[a.impact] ?? 4) - (order[b.impact] ?? 4)
    })

    for (const v of sorted) {
      lines.push(`### [${v.impact.toUpperCase()}] ${v.rule}`)
      lines.push(`- **What:** ${v.description}`)
      lines.push(`- **Affected elements:** ${v.elements.slice(0, 5).map(e => `\`${e}\``).join(', ')}${v.elements.length > 5 ? ` +${v.elements.length - 5} more` : ''}`)
      lines.push(`- **Pages:** ${v.pages.slice(0, 5).join(', ')}${v.pages.length > 5 ? ` +${v.pages.length - 5} more` : ''}`)
      lines.push(`- **Learn more:** ${v.helpUrl}`)
      lines.push('')
    }
  }

  // Visual issues
  const allVisual = result.pages.flatMap(p => p.devices.flatMap(d => d.visualIssues.map(vi => ({ ...vi, page: p.path, device: d.device }))))
  if (allVisual.length) {
    lines.push(`## Visual Issues (${allVisual.length})`)
    lines.push('')
    for (const vi of allVisual) {
      lines.push(`- **${vi.type}** on \`${vi.page}\` (${vi.device}): \`${vi.selector}\``)
      lines.push(`  - ${vi.description}`)
      if (vi.type === 'overflow') {
        lines.push(`  - Fix: Add \`max-width: 100%\` or \`overflow-x: hidden\` to the element or its container.`)
      }
    }
    lines.push('')
  }

  // Lighthouse per page
  const lhPages = result.pages.filter(p => p.lighthouse)
  if (lhPages.length) {
    lines.push(`## Lighthouse Scores`)
    lines.push('')
    lines.push('| Page | Performance | Accessibility | SEO | Best Practices |')
    lines.push('|------|------------|---------------|-----|----------------|')
    for (const p of lhPages) {
      lines.push(`| \`${p.path}\` | ${p.lighthouse!.performance ?? '—'} | ${p.lighthouse!.accessibility ?? '—'} | ${p.lighthouse!.seo ?? '—'} | ${p.lighthouse!.bestPractices ?? '—'} |`)
    }
    lines.push('')
  }

  // Dependencies
  if (result.depVulnerabilities.length) {
    lines.push(`## Dependency Vulnerabilities (${result.depVulnerabilities.length})`)
    lines.push('')
    for (const v of result.depVulnerabilities) {
      lines.push(`- **[${v.severity}] ${v.name}:** ${v.title}${v.url ? ` — [Details](${v.url})` : ''}`)
    }
    lines.push('')
  }

  // Summary action items
  lines.push('---')
  lines.push('')
  lines.push('## Priority Fix Order')
  lines.push('')
  if (result.securityIssues.some(i => i.severity === 'critical')) lines.push('1. Fix critical security issues (exposed secrets)')
  if (result.brokenLinks.length) lines.push(`${result.securityIssues.some(i => i.severity === 'critical') ? '2' : '1'}. Fix ${result.brokenLinks.length} broken links`)
  if (a11yByRule.size) {
    const critA11y = [...a11yByRule.values()].filter(v => v.impact === 'critical' || v.impact === 'serious')
    if (critA11y.length) lines.push(`- Fix ${critA11y.length} critical/serious accessibility rules: ${critA11y.map(v => v.rule).join(', ')}`)
  }
  if (result.securityIssues.some(i => i.type === 'missing-header')) lines.push('- Add missing security headers in hooks.server.ts')
  if (allVisual.length) lines.push(`- Fix ${allVisual.length} visual overflow issues`)
  lines.push('')

  const content = lines.join('\n')
  fs.writeFileSync(mdPath, content)
  return mdPath
}
