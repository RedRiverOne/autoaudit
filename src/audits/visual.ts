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

  // Run all checks in a single evaluate — use arrow functions only to avoid __name issue
  const issues = await page.evaluate(() => {
    const found: { type: string; selector: string; description: string; severity: string }[] = []
    const vw = window.innerWidth
    const seen = new Set<string>()

    const getSelector = (el: Element): string => {
      const tag = el.tagName.toLowerCase()
      if (el.id) return `${tag}#${el.id}`
      const cls = el.className ? String(el.className).split(' ').filter(c => c && !c.startsWith('svelte-'))[0] : ''
      return cls ? `${tag}.${cls}` : tag
    }

    const srgbToLinear = (c: number): number => {
      c = c / 255
      return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
    }

    const luminance = (r: number, g: number, b: number): number =>
      0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b)

    const parseColor = (color: string): [number, number, number, number] | null => {
      const m = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/)
      if (!m) return null
      return [parseInt(m[1]), parseInt(m[2]), parseInt(m[3]), m[4] !== undefined ? parseFloat(m[4]) : 1]
    }

    const contrastRatio = (l1: number, l2: number): number => {
      const lighter = Math.max(l1, l2)
      const darker = Math.min(l1, l2)
      return (lighter + 0.05) / (darker + 0.05)
    }

    // 1. Horizontal overflow (skip fixed/absolute off-screen)
    document.querySelectorAll('*').forEach((el) => {
      const style = window.getComputedStyle(el)
      if (style.position === 'fixed' || style.position === 'absolute') return
      if (style.display === 'none' || style.visibility === 'hidden') return
      const rect = el.getBoundingClientRect()
      if (rect.width > 0 && rect.right > vw + 2) {
        const sel = getSelector(el)
        if (seen.has('of:' + sel)) return
        seen.add('of:' + sel)
        found.push({
          type: 'overflow',
          selector: sel,
          description: `Extends ${Math.round(rect.right - vw)}px beyond viewport (element is ${Math.round(rect.width)}px wide, viewport is ${vw}px)`,
          severity: 'warning',
        })
      }
    })

    // 2. Text color contrast
    document.querySelectorAll('p, span, a, h1, h2, h3, h4, h5, h6, li, td, th, label, button').forEach((el) => {
      const style = window.getComputedStyle(el)
      if (style.display === 'none' || style.visibility === 'hidden') return
      if (!el.textContent?.trim()) return
      if (el.children.length > 3) return

      const fgColor = parseColor(style.color)
      if (!fgColor || fgColor[3] < 0.1) return

      let bg: [number, number, number, number] | null = null
      let current: Element | null = el
      while (current) {
        const ps = window.getComputedStyle(current)
        const pbg = parseColor(ps.backgroundColor)
        if (pbg && pbg[3] > 0.1) { bg = pbg; break }
        current = current.parentElement
      }
      if (!bg) bg = [255, 255, 255, 1]

      const fgL = luminance(fgColor[0], fgColor[1], fgColor[2])
      const bgL = luminance(bg[0], bg[1], bg[2])
      const ratio = contrastRatio(fgL, bgL)
      const fontSize = parseFloat(style.fontSize)
      const isBold = parseInt(style.fontWeight) >= 700
      const isLargeText = fontSize >= 24 || (fontSize >= 18.66 && isBold)
      const threshold = isLargeText ? 3 : 4.5

      if (ratio < threshold) {
        const sel = getSelector(el)
        if (seen.has('ct:' + sel)) return
        seen.add('ct:' + sel)
        const text = el.textContent!.trim().slice(0, 40)
        found.push({
          type: 'contrast',
          selector: sel,
          description: `Contrast ratio ${ratio.toFixed(1)}:1 (needs ${threshold}:1). Text "${text}" — color: ${style.color} on ${style.backgroundColor || 'inherited bg'}`,
          severity: ratio < 2 ? 'critical' : 'warning',
        })
      }
    })

    return found.slice(0, 20)
  }) as VisualIssue[]

  return { screenshotPath, issues }
}
