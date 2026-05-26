import type { DeviceConfig } from './types.js'

export const DEVICES: DeviceConfig[] = [
  { name: 'Desktop', viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false },
  { name: 'Mobile', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
  { name: 'Tablet', viewport: { width: 820, height: 1180 }, isMobile: true, hasTouch: true },
]

export const DEFAULT_PATHS = [
  '/',
  '/search',
  '/login',
  '/blog',
  '/contact',
  '/compare',
  '/saved',
  '/about',
  '/privacy',
  '/terms',
]

export const SECURITY_HEADERS = [
  'strict-transport-security',
  'content-security-policy',
  'x-content-type-options',
  'x-frame-options',
  'referrer-policy',
  'permissions-policy',
]

export const SECRET_PATTERNS = [
  /sk_live_[a-zA-Z0-9]+/,
  /pk_live_[a-zA-Z0-9]+/,
  /AKIA[0-9A-Z]{16}/,
  /ghp_[a-zA-Z0-9]{36}/,
  /api[_-]?key\s*[:=]\s*['"][a-zA-Z0-9]{20,}['"]/i,
]
