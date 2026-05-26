import { execSync } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import type { DepVulnerability } from '../types.js'

export function runDepsAudit(): DepVulnerability[] {
  const vulnerabilities: DepVulnerability[] = []

  // Check parent site project
  const sitePath = path.resolve(process.cwd(), '..', 'site')
  const sitePackageJson = path.join(sitePath, 'package.json')

  if (fs.existsSync(sitePackageJson)) {
    try {
      const output = execSync('pnpm audit --json 2>/dev/null || true', { cwd: sitePath, encoding: 'utf-8', timeout: 30000 })
      try {
        const data = JSON.parse(output)
        if (data.advisories) {
          for (const [, advisory] of Object.entries(data.advisories) as [string, any][]) {
            vulnerabilities.push({
              name: advisory.module_name ?? 'unknown',
              severity: advisory.severity ?? 'unknown',
              title: advisory.title ?? '',
              url: advisory.url ?? '',
            })
          }
        }
      } catch {
        // pnpm audit output might not be JSON — parse line-by-line
        const lines = output.split('\n')
        for (const line of lines) {
          if (line.includes('critical') || line.includes('high') || line.includes('moderate')) {
            vulnerabilities.push({
              name: 'dependency',
              severity: line.includes('critical') ? 'critical' : line.includes('high') ? 'high' : 'moderate',
              title: line.trim().slice(0, 120),
              url: '',
            })
          }
        }
      }
    } catch {
      // audit command failed
    }
  }

  return vulnerabilities
}
