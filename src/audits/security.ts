import { SECURITY_HEADERS, SECRET_PATTERNS } from '../config.js'
import type { SecurityIssue } from '../types.js'

export async function runSecurityAudit(baseUrl: string, paths: string[]): Promise<SecurityIssue[]> {
  const issues: SecurityIssue[] = []

  // Check security headers on first page
  try {
    const res = await fetch(baseUrl, { signal: AbortSignal.timeout(10000) })
    const headers = Object.fromEntries([...res.headers.entries()].map(([k, v]) => [k.toLowerCase(), v]))

    for (const header of SECURITY_HEADERS) {
      if (!headers[header]) {
        issues.push({
          type: 'missing-header',
          severity: header === 'content-security-policy' ? 'high' : 'medium',
          url: baseUrl,
          description: `Missing security header: ${header}`,
          recommendation: `Add ${header} response header`,
        })
      }
    }

    if (headers['x-powered-by']) {
      issues.push({
        type: 'info-leak',
        severity: 'low',
        url: baseUrl,
        description: `X-Powered-By header exposes: ${headers['x-powered-by']}`,
        recommendation: 'Remove X-Powered-By header',
      })
    }
  } catch { /* fetch failed */ }

  // Check for exposed secrets in page source
  for (const p of paths.slice(0, 10)) {
    try {
      const res = await fetch(`${baseUrl}${p}`, { signal: AbortSignal.timeout(10000) })
      if (!res.ok) continue
      const body = await res.text()

      for (const pattern of SECRET_PATTERNS) {
        const match = body.match(pattern)
        if (match) {
          issues.push({
            type: 'exposed-secret',
            severity: 'critical',
            url: `${baseUrl}${p}`,
            description: `Possible API key/secret found in page source: ${match[0].slice(0, 20)}...`,
            recommendation: 'Move secrets to server-side environment variables',
          })
        }
      }

      // Mixed content check (HTTPS pages loading HTTP resources)
      if (baseUrl.startsWith('https')) {
        const httpResources = body.match(/(?:src|href)=["']http:\/\/[^"']+["']/gi)
        if (httpResources) {
          issues.push({
            type: 'mixed-content',
            severity: 'medium',
            url: `${baseUrl}${p}`,
            description: `${httpResources.length} mixed content resource(s) found`,
            recommendation: 'Use HTTPS for all resources',
          })
        }
      }
    } catch { /* skip */ }
  }

  // Open redirect check
  const redirectParams = ['redirect', 'next', 'return_to', 'returnUrl']
  try {
    for (const param of redirectParams) {
      const testUrl = `${baseUrl}/?${param}=https://evil.com`
      const res = await fetch(testUrl, { redirect: 'manual', signal: AbortSignal.timeout(5000) })
      const location = res.headers.get('location') ?? ''
      if (location.includes('evil.com')) {
        issues.push({
          type: 'open-redirect',
          severity: 'high',
          url: testUrl,
          description: `Open redirect via ?${param}= parameter`,
          recommendation: 'Validate redirect URLs against an allowlist',
        })
      }
    }
  } catch { /* skip */ }

  return issues
}
