import * as cheerio from 'cheerio'
import { DEFAULT_PATHS } from './config.js'

export async function discoverPages(baseUrl: string, crawlDepth: number): Promise<string[]> {
  const found = new Set<string>(DEFAULT_PATHS)
  const visited = new Set<string>()
  const queue: { path: string; depth: number }[] = [{ path: '/', depth: 0 }]

  // Try sitemap first
  try {
    const res = await fetch(`${baseUrl}/sitemap.xml`, { signal: AbortSignal.timeout(10000) })
    if (res.ok) {
      const xml = await res.text()
      const $ = cheerio.load(xml, { xml: true })
      $('loc').each((_, el) => {
        const loc = $(el).text().trim()
        try {
          const url = new URL(loc)
          if (url.origin === new URL(baseUrl).origin) {
            found.add(url.pathname)
          }
        } catch { /* skip invalid URLs */ }
      })
    }
  } catch { /* sitemap not available */ }

  // Crawl links from pages
  while (queue.length > 0) {
    const item = queue.shift()!
    if (visited.has(item.path) || item.depth > crawlDepth) continue
    visited.add(item.path)

    try {
      const res = await fetch(`${baseUrl}${item.path}`, { signal: AbortSignal.timeout(10000) })
      if (!res.ok) continue
      const html = await res.text()
      const $ = cheerio.load(html)

      $('a[href]').each((_, el) => {
        const href = $(el).attr('href')
        if (!href) return
        try {
          const url = new URL(href, baseUrl)
          if (url.origin !== new URL(baseUrl).origin) return
          const path = url.pathname.replace(/\/$/, '') || '/'
          if (!found.has(path) && !path.startsWith('/api/')) {
            found.add(path)
            if (item.depth < crawlDepth) {
              queue.push({ path, depth: item.depth + 1 })
            }
          }
        } catch { /* skip invalid */ }
      })
    } catch { /* page fetch failed */ }
  }

  return [...found].sort()
}
