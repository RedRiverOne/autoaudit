export interface DeviceConfig {
  name: string
  viewport: { width: number; height: number }
  isMobile: boolean
  hasTouch: boolean
}

export interface AuditConfig {
  baseUrl: string
  paths: string[]
  devices: DeviceConfig[]
  concurrency: number
  outputDir: string
  timeout: number
  crawlDepth: number
  skipModules: string[]
}

export interface BrokenLink {
  sourceUrl: string
  targetUrl: string
  statusCode: number | null
  anchorText: string
  type: 'http-error' | 'broken-anchor' | 'timeout' | 'redirect-loop'
}

export interface VisualIssue {
  type: 'overflow' | 'overlap' | 'contrast'
  selector: string
  description: string
  severity: 'critical' | 'warning' | 'info'
}

export interface AxeViolation {
  id: string
  impact: string
  description: string
  helpUrl: string
  nodes: { target: string[]; html: string }[]
}

export interface AccessibilityResult {
  violations: AxeViolation[]
  passes: number
  incomplete: number
}

export interface LighthouseScores {
  performance: number | null
  accessibility: number | null
  seo: number | null
  bestPractices: number | null
}

export interface SecurityIssue {
  type: string
  severity: 'critical' | 'high' | 'medium' | 'low'
  url: string
  description: string
  recommendation: string
}

export interface DepVulnerability {
  name: string
  severity: string
  title: string
  url: string
}

export interface DevicePageResult {
  device: string
  screenshotPath: string
  accessibility: AccessibilityResult
  visualIssues: VisualIssue[]
  loadTimeMs: number
}

export interface PageResult {
  url: string
  path: string
  statusCode: number
  devices: DevicePageResult[]
  lighthouse: LighthouseScores | null
}

export interface AuditResult {
  timestamp: string
  baseUrl: string
  durationMs: number
  pages: PageResult[]
  brokenLinks: BrokenLink[]
  securityIssues: SecurityIssue[]
  depVulnerabilities: DepVulnerability[]
  summary: {
    totalPages: number
    brokenLinkCount: number
    accessibilityViolations: number
    securityCounts: { critical: number; high: number; medium: number; low: number }
    avgLighthouse: LighthouseScores
    grade: string
  }
}
