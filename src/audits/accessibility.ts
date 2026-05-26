import AxeBuilder from '@axe-core/playwright'
import type { Page } from 'playwright'
import type { AccessibilityResult } from '../types.js'

export async function runAccessibilityAudit(page: Page): Promise<AccessibilityResult> {
  try {
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'])
      .analyze()

    return {
      violations: results.violations.map((v) => ({
        id: v.id,
        impact: v.impact ?? 'unknown',
        description: v.description,
        helpUrl: v.helpUrl,
        nodes: v.nodes.slice(0, 5).map((n) => ({
          target: n.target.map(String),
          html: n.html.slice(0, 200),
        })),
      })),
      passes: results.passes.length,
      incomplete: results.incomplete.length,
    }
  } catch {
    return { violations: [], passes: 0, incomplete: 0 }
  }
}
