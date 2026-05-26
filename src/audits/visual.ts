import type { Page } from 'playwright'
import type { VisualIssue } from '../types.js'
import * as fs from 'fs'
import * as path from 'path'

export async function runVisualAudit(page: Page, device: string, pagePath: string, outputDir: string): Promise<{ screenshotPath: string; issues: VisualIssue[] }> {
  const slug = pagePath.replace(/\//g, '_').replace(/^_/, '') || 'home'
  const dir = path.join(outputDir, 'screenshots', device.toLowerCase().replace(/\s/g, '-'))
  fs.mkdirSync(dir, { recursive: true })
  const screenshotPath = path.join(dir, `${slug}.png`)

  await page.screenshot({ path: screenshotPath, fullPage: true })

  // Check for horizontal overflow
  const issues = await page.evaluate(() => {
    const found: { type: string; selector: string; description: string; severity: string }[] = []
    const vw = window.innerWidth

    document.querySelectorAll('*').forEach((el) => {
      const rect = el.getBoundingClientRect()
      if (rect.width > 0 && rect.right > vw + 2) {
        const sel = el.tagName.toLowerCase() + (el.className ? `.${String(el.className).split(' ')[0]}` : '')
        found.push({
          type: 'overflow',
          selector: sel,
          description: `Element extends ${Math.round(rect.right - vw)}px beyond viewport (${Math.round(rect.width)}px wide)`,
          severity: 'warning',
        })
      }
    })

    // Limit to top 10 unique selectors
    const seen = new Set<string>()
    return found.filter((f) => {
      if (seen.has(f.selector)) return false
      seen.add(f.selector)
      return true
    }).slice(0, 10)
  }) as VisualIssue[]

  return { screenshotPath, issues }
}
