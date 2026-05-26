import { chromium, type Browser, type BrowserContext, type Page } from 'playwright'
import type { DeviceConfig } from './types.js'

let browser: Browser | null = null

export async function launchBrowser(): Promise<Browser> {
  if (!browser) {
    browser = await chromium.launch({ headless: true })
  }
  return browser
}

export async function createContext(device: DeviceConfig): Promise<BrowserContext> {
  const b = await launchBrowser()
  return b.newContext({
    viewport: device.viewport,
    isMobile: device.isMobile,
    hasTouch: device.hasTouch,
    userAgent: device.isMobile
      ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
      : undefined,
  })
}

export async function openPage(ctx: BrowserContext, url: string, timeout: number): Promise<{ page: Page; statusCode: number; loadTimeMs: number }> {
  const page = await ctx.newPage()
  const start = Date.now()
  let statusCode = 0
  page.on('response', (res) => {
    if (res.url() === url || res.url() === url + '/') statusCode = res.status()
  })
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout })
  } catch {
    if (!statusCode) statusCode = 0
  }
  return { page, statusCode: statusCode || 200, loadTimeMs: Date.now() - start }
}

export async function closeBrowser(): Promise<void> {
  if (browser) {
    await browser.close()
    browser = null
  }
}
