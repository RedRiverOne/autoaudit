import * as cheerio from 'cheerio'
import type { BrokenLink } from '../types.js'

export async function checkBrokenLinks(baseUrl: string, paths: string[], concurrency: number): Promise<BrokenLink[]> {
  const broken: BrokenLink[] = []
  const checked = new Map<string, number | null>()

  async function checkUrl(target: string): Promise<number | null> {
    if (checked.has(target)) return checked.get(target)!
    try {
      const res = await fetch(target, { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(8000) })
      checked.set(target, res.status)
      return res.status
    } catch {
      checked.set(target, null)
      return null
    }
  }

  for (const path of paths) {
    const pageUrl = `${baseUrl}${path}`
    try {
      const res = await fetch(pageUrl, { signal: AbortSignal.timeout(10000) })
      if (!res.ok) continue
      const html = await res.text()
      const $ = cheerio.load(html)
      const links: { href: string; text: string }[] = []

      $('a[href]').each((_, el) => {
        const href = $(el).attr('href')
        const text = $(el).text().trim().slice(0, 80)
        if (href && !href.startsWith('#') && !href.startsWith('mailto:') && !href.startsWith('tel:') && !href.startsWith('javascript:')) {
          links.push({ href, text })
        }
      })

      // Check anchors
      $('a[href^="#"]').each((_, el) => {
        const href = $(el).attr('href')
        if (href && href.length > 1) {
          const id = href.slice(1)
          if (!$(`#${CSS.escape(id)}`).length) {
            broken.push({
              sourceUrl: pageUrl,
              targetUrl: href,
              statusCode: null,
              anchorText: $(el).text().trim().slice(0, 80),
              type: 'broken-anchor',
            })
          }
        }
      })

      // Check HTTP links (batched)
      const batch: Promise<void>[] = []
      for (const link of links) {
        const fn = async () => {
          try {
            const target = new URL(link.href, pageUrl).href
            const status = await checkUrl(target)
            if (status === null) {
              broken.push({ sourceUrl: pageUrl, targetUrl: target, statusCode: null, anchorText: link.text, type: 'timeout' })
            } else if (status >= 400) {
              broken.push({ sourceUrl: pageUrl, targetUrl: target, statusCode: status, anchorText: link.text, type: 'http-error' })
            }
          } catch { /* invalid URL */ }
        }
        batch.push(fn())
        if (batch.length >= concurrency) {
          await Promise.all(batch)
          batch.length = 0
        }
      }
      if (batch.length) await Promise.all(batch)
    } catch { /* page fetch failed */ }
  }

  return broken
}
