import type { LighthouseScores } from '../types.js'

export async function runLighthouseAudit(url: string): Promise<LighthouseScores> {
  try {
    const lighthouse = (await import('lighthouse')).default
    const chromeLauncher = await import('chrome-launcher')

    const chrome = await chromeLauncher.launch({ chromeFlags: ['--headless', '--no-sandbox', '--disable-gpu'] })

    const result = await lighthouse(url, {
      port: chrome.port,
      output: 'json',
      logLevel: 'error',
      onlyCategories: ['performance', 'accessibility', 'seo', 'best-practices'],
    })

    await chrome.kill()

    if (!result?.lhr) return { performance: null, accessibility: null, seo: null, bestPractices: null }

    const cats = result.lhr.categories
    return {
      performance: cats.performance ? Math.round(cats.performance.score! * 100) : null,
      accessibility: cats.accessibility ? Math.round(cats.accessibility.score! * 100) : null,
      seo: cats.seo ? Math.round(cats.seo.score! * 100) : null,
      bestPractices: cats['best-practices'] ? Math.round(cats['best-practices'].score! * 100) : null,
    }
  } catch (e) {
    console.error(`  Lighthouse failed for ${url}:`, (e as Error).message)
    return { performance: null, accessibility: null, seo: null, bestPractices: null }
  }
}
