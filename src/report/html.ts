import * as fs from 'fs'
import * as path from 'path'
import type { AuditResult, VisualIssue, AxeViolation, SecurityIssue } from '../types.js'

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function severityColor(s: string): string {
  switch (s) {
    case 'critical': return '#dc2626'
    case 'serious': return '#dc2626'
    case 'high': return '#ea580c'
    case 'medium': return '#d97706'
    case 'moderate': return '#d97706'
    case 'warning': return '#d97706'
    case 'low': return '#2563eb'
    case 'minor': return '#2563eb'
    case 'info': return '#6b7280'
    default: return '#6b7280'
  }
}

function gradeColor(g: string): string {
  if (g.startsWith('A')) return '#16a34a'
  if (g.startsWith('B')) return '#2563eb'
  if (g.startsWith('C')) return '#d97706'
  return '#dc2626'
}

function scoreColor(s: number | null): string {
  if (s === null) return '#6b7280'
  if (s >= 90) return '#16a34a'
  if (s >= 50) return '#d97706'
  return '#dc2626'
}

function visualIssueExplanation(issue: VisualIssue): string {
  switch (issue.type) {
    case 'overflow':
      return `<strong>What:</strong> The element <code>${esc(issue.selector)}</code> extends beyond the viewport width.<br>
<strong>Why:</strong> This causes horizontal scrolling on this device, making the page feel broken. Common causes: fixed-width elements, images without max-width, or padding/margin pushing content out.<br>
<strong>Fix:</strong> Add <code>overflow-x: hidden</code> to the container, or use <code>max-width: 100%</code> on the overflowing element. Check if a parent has explicit width wider than the viewport.`
    case 'overlap':
      return `<strong>What:</strong> Elements are overlapping at <code>${esc(issue.selector)}</code>.<br>
<strong>Why:</strong> Overlapping elements can hide content and make the page unusable. Usually caused by absolute/fixed positioning or negative margins.<br>
<strong>Fix:</strong> Check z-index values and positioning of the overlapping elements.`
    case 'contrast':
      return `<strong>What:</strong> Text contrast is too low at <code>${esc(issue.selector)}</code>.<br>
<strong>Why:</strong> WCAG 2.1 requires a minimum 4.5:1 contrast ratio for normal text and 3:1 for large text. Low contrast makes text unreadable for users with visual impairments.<br>
<strong>Fix:</strong> Darken the text color or lighten the background. Use a contrast checker tool to verify.`
    default:
      return issue.description
  }
}

function a11yExplanation(v: AxeViolation): string {
  const nodeHtml = v.nodes.map(n => `<code>${esc(n.html)}</code>`).join('<br>')
  const targets = v.nodes.map(n => n.target.join(' > ')).join(', ')
  return `<strong>Rule:</strong> ${esc(v.id)}<br>
<strong>Impact:</strong> ${esc(v.impact)}<br>
<strong>What:</strong> ${esc(v.description)}<br>
<strong>Elements:</strong> <code>${esc(targets)}</code><br>
<strong>HTML:</strong> ${nodeHtml}<br>
<strong>Why this matters:</strong> ${v.impact === 'critical' || v.impact === 'serious'
    ? 'This prevents assistive technology users from accessing this content. Screen readers, keyboard navigation, or other tools will fail here.'
    : 'This degrades the experience for users with disabilities and may violate WCAG 2.1 AA compliance requirements.'}<br>
<strong>Learn more:</strong> <a href="${esc(v.helpUrl)}" target="_blank">${esc(v.helpUrl)}</a>`
}

function securityExplanation(issue: SecurityIssue): string {
  const explanations: Record<string, string> = {
    'missing-header': 'Security headers tell browsers how to handle your content. Missing headers leave your site vulnerable to clickjacking, XSS, MIME sniffing, and other attacks.',
    'info-leak': 'Server technology disclosure helps attackers identify known vulnerabilities for your specific software version.',
    'exposed-secret': 'API keys or secrets in client-side code can be extracted by anyone viewing the page source, enabling unauthorized API access or data theft.',
    'mixed-content': 'Loading HTTP resources on an HTTPS page can be intercepted by attackers (man-in-the-middle), breaking the security chain.',
    'open-redirect': 'Open redirects allow attackers to craft URLs that appear to be from your site but redirect users to malicious destinations, enabling phishing attacks.',
  }
  return `<strong>What:</strong> ${esc(issue.description)}<br>
<strong>Why:</strong> ${explanations[issue.type] ?? 'This is a security concern that should be addressed.'}<br>
<strong>Fix:</strong> ${esc(issue.recommendation)}<br>
<strong>Affected URL:</strong> <code>${esc(issue.url)}</code>`
}

export function generateReport(result: AuditResult, outputDir: string): string {
  const ts = result.timestamp.replace(/[:.]/g, '-')
  const htmlPath = path.join(outputDir, `audit-${ts}.html`)
  const jsonPath = path.join(outputDir, `audit-${ts}.json`)

  fs.mkdirSync(outputDir, { recursive: true })
  fs.writeFileSync(jsonPath, JSON.stringify(result, null, 2))

  const s = result.summary

  // Build per-page detail sections
  const pageDetails = result.pages.map(p => {
    const totalIssues = p.devices.reduce((sum, d) => sum + d.visualIssues.length + d.accessibility.violations.length, 0)
    const deviceSections = p.devices.map(d => {
      const imgSrc = d.screenshotPath ? path.relative(outputDir, d.screenshotPath).replace(/\\/g, '/') : ''
      return `
      <div class="device-section">
        <h4>${esc(d.device)} <span class="load-time">${d.loadTimeMs}ms</span></h4>
        ${imgSrc ? `<div class="screenshot-wrap"><img src="${esc(imgSrc)}" alt="${esc(p.path)} on ${esc(d.device)}" loading="lazy" /></div>` : ''}

        ${d.visualIssues.length ? `
        <div class="subsection">
          <h5>Visual Issues (${d.visualIssues.length})</h5>
          ${d.visualIssues.map(vi => `
          <div class="issue-detail-card">
            <div class="issue-header"><span class="badge" style="background:${severityColor(vi.severity)}">${vi.severity}</span> ${esc(vi.type)}: ${esc(vi.selector)}</div>
            <div class="issue-explanation">${visualIssueExplanation(vi)}</div>
          </div>`).join('')}
        </div>` : '<div class="pass">No visual issues</div>'}

        ${d.accessibility.violations.length ? `
        <div class="subsection">
          <h5>Accessibility Violations (${d.accessibility.violations.length})</h5>
          ${d.accessibility.violations.map(v => `
          <div class="issue-detail-card">
            <div class="issue-header"><span class="badge" style="background:${severityColor(v.impact)}">${v.impact}</span> ${esc(v.id)}</div>
            <div class="issue-explanation">${a11yExplanation(v)}</div>
          </div>`).join('')}
        </div>` : `<div class="pass">No accessibility violations (${d.accessibility.passes} rules passed)</div>`}
      </div>`
    }).join('')

    return `
    <details class="page-details" ${totalIssues > 0 ? '' : ''}>
      <summary>
        <span class="page-path">${esc(p.path)}</span>
        <span class="page-status ${p.statusCode >= 400 ? 'status-error' : 'status-ok'}">${p.statusCode}</span>
        ${totalIssues > 0 ? `<span class="issue-count">${totalIssues} issue${totalIssues !== 1 ? 's' : ''}</span>` : '<span class="pass-badge">PASS</span>'}
        ${p.lighthouse ? `<span class="lh-mini">P:${p.lighthouse.performance ?? '—'} A:${p.lighthouse.accessibility ?? '—'} S:${p.lighthouse.seo ?? '—'}</span>` : ''}
      </summary>
      <div class="page-content">
        ${p.lighthouse ? `
        <div class="lighthouse-row">
          <div class="lh-score" style="color:${scoreColor(p.lighthouse.performance)}"><span class="lh-num">${p.lighthouse.performance ?? '—'}</span><span class="lh-label">Performance</span></div>
          <div class="lh-score" style="color:${scoreColor(p.lighthouse.accessibility)}"><span class="lh-num">${p.lighthouse.accessibility ?? '—'}</span><span class="lh-label">Accessibility</span></div>
          <div class="lh-score" style="color:${scoreColor(p.lighthouse.seo)}"><span class="lh-num">${p.lighthouse.seo ?? '—'}</span><span class="lh-label">SEO</span></div>
          <div class="lh-score" style="color:${scoreColor(p.lighthouse.bestPractices)}"><span class="lh-num">${p.lighthouse.bestPractices ?? '—'}</span><span class="lh-label">Best Practices</span></div>
        </div>` : ''}
        ${deviceSections}
      </div>
    </details>`
  }).join('')

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>AutoAudit Report — ${esc(result.baseUrl)}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f8fafc;color:#1e293b;line-height:1.6;font-size:14px}
.container{max-width:1200px;margin:0 auto;padding:2rem 1.5rem}
h1{font-size:1.75rem;font-weight:800}
h2{font-size:1.25rem;font-weight:700;margin:2.5rem 0 1rem;padding-bottom:.5rem;border-bottom:2px solid #e2e8f0}
h3{font-size:1.05rem;font-weight:700;margin:1rem 0 .5rem}
h4{font-size:.9rem;font-weight:700;margin:.75rem 0 .5rem;display:flex;align-items:center;gap:.5rem}
h5{font-size:.8rem;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#64748b;margin:.75rem 0 .375rem}
.meta{font-size:.8rem;color:#64748b;margin-bottom:2rem}
.dashboard{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:.75rem;margin-bottom:2rem}
.card{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:1.25rem;text-align:center}
.card-value{font-size:2rem;font-weight:800;line-height:1}
.card-label{font-size:.65rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#64748b;margin-top:.375rem}
.badge{display:inline-block;padding:.125rem .5rem;border-radius:99px;font-size:.6rem;font-weight:700;color:#fff;vertical-align:middle}
.issue-detail-card{background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:.875rem 1rem;margin-bottom:.625rem}
.issue-header{font-weight:600;font-size:.85rem;margin-bottom:.5rem;display:flex;align-items:center;gap:.5rem}
.issue-explanation{font-size:.8rem;color:#475569;line-height:1.7}
.issue-explanation code{background:#f1f5f9;padding:.1rem .375rem;border-radius:4px;font-size:.75rem;font-family:'SF Mono',Monaco,Consolas,monospace;word-break:break-all}
.issue-explanation strong{color:#1e293b}
.issue-explanation a{color:#2563eb;text-decoration:none}
.issue-explanation a:hover{text-decoration:underline}
.pass{font-size:.8rem;color:#16a34a;padding:.5rem 0;font-weight:500}
.pass-badge{font-size:.65rem;font-weight:700;color:#16a34a;background:#f0fdf4;border:1px solid #bbf7d0;padding:.125rem .5rem;border-radius:99px}
.issue-count{font-size:.65rem;font-weight:700;color:#dc2626;background:#fef2f2;border:1px solid #fecaca;padding:.125rem .5rem;border-radius:99px}
.page-details{border:1px solid #e2e8f0;border-radius:10px;margin-bottom:.75rem;background:#fff;overflow:hidden}
.page-details[open]{border-color:#cbd5e1}
.page-details summary{padding:.875rem 1.25rem;cursor:pointer;display:flex;align-items:center;gap:.75rem;font-size:.9rem;font-weight:600;background:#fafbfc;border-bottom:1px solid transparent;user-select:none}
.page-details[open] summary{border-bottom-color:#e2e8f0;background:#f1f5f9}
.page-details summary:hover{background:#f1f5f9}
.page-path{flex:1;font-family:'SF Mono',Monaco,Consolas,monospace;font-size:.8rem}
.page-status{font-size:.65rem;font-weight:700;padding:.125rem .375rem;border-radius:4px}
.status-ok{color:#16a34a;background:#f0fdf4}
.status-error{color:#dc2626;background:#fef2f2}
.lh-mini{font-size:.65rem;color:#64748b;font-weight:500;font-family:'SF Mono',Monaco,Consolas,monospace}
.page-content{padding:1.25rem}
.device-section{margin-bottom:1.5rem;padding-bottom:1.5rem;border-bottom:1px solid #f1f5f9}
.device-section:last-child{border-bottom:none;margin-bottom:0;padding-bottom:0}
.load-time{font-size:.7rem;font-weight:500;color:#64748b;font-family:monospace}
.screenshot-wrap{margin:.75rem 0;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden}
.screenshot-wrap img{width:100%;max-height:400px;object-fit:cover;object-position:top;display:block}
.subsection{margin:.75rem 0}
.lighthouse-row{display:flex;gap:1.5rem;padding:1rem 0;margin-bottom:1rem;border-bottom:1px solid #f1f5f9}
.lh-score{text-align:center}
.lh-num{font-size:1.75rem;font-weight:800;display:block}
.lh-label{font-size:.6rem;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#64748b}
table{width:100%;border-collapse:collapse;font-size:.8rem;margin:.5rem 0}
th,td{padding:.5rem .75rem;text-align:left;border-bottom:1px solid #e2e8f0}
th{font-size:.65rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#64748b;background:#f8fafc}
.empty{text-align:center;padding:2rem;color:#94a3b8;font-size:.85rem}
@media(max-width:768px){.dashboard{grid-template-columns:repeat(3,1fr)}.lighthouse-row{flex-wrap:wrap;gap:.75rem}}
</style>
</head>
<body>
<div class="container">
<h1>AutoAudit Report</h1>
<div class="meta">${esc(result.baseUrl)} &middot; ${new Date(result.timestamp).toLocaleString()} &middot; ${Math.round(result.durationMs / 1000)}s &middot; ${s.totalPages} pages &middot; 3 devices</div>

<div class="dashboard">
  <div class="card"><div class="card-value" style="color:${gradeColor(s.grade)}">${s.grade}</div><div class="card-label">Grade</div></div>
  <div class="card"><div class="card-value" style="color:${scoreColor(s.avgLighthouse.performance)}">${s.avgLighthouse.performance ?? '—'}</div><div class="card-label">Performance</div></div>
  <div class="card"><div class="card-value" style="color:${scoreColor(s.avgLighthouse.accessibility)}">${s.avgLighthouse.accessibility ?? '—'}</div><div class="card-label">Accessibility</div></div>
  <div class="card"><div class="card-value" style="color:${scoreColor(s.avgLighthouse.seo)}">${s.avgLighthouse.seo ?? '—'}</div><div class="card-label">SEO</div></div>
  <div class="card"><div class="card-value">${s.brokenLinkCount}</div><div class="card-label">Broken Links</div></div>
  <div class="card"><div class="card-value" style="color:${s.securityCounts.critical + s.securityCounts.high > 0 ? '#dc2626' : '#16a34a'}">${s.securityCounts.critical + s.securityCounts.high + s.securityCounts.medium}</div><div class="card-label">Security</div></div>
  <div class="card"><div class="card-value" style="color:${s.accessibilityViolations > 0 ? '#d97706' : '#16a34a'}">${s.accessibilityViolations}</div><div class="card-label">A11y Issues</div></div>
</div>

<h2>Page-by-Page Audit</h2>
<p style="font-size:.8rem;color:#64748b;margin-bottom:1rem">Click any page to expand and see detailed issues per device with screenshots, explanations, and fix suggestions.</p>
${pageDetails}

${result.brokenLinks.length ? `
<h2>Broken Links (${result.brokenLinks.length})</h2>
<table>
<thead><tr><th>Target URL</th><th>Status</th><th>Type</th><th>Found On</th><th>Link Text</th></tr></thead>
<tbody>
${result.brokenLinks.map(l => `<tr>
  <td><code style="font-size:.75rem;word-break:break-all">${esc(l.targetUrl)}</code></td>
  <td><span class="badge" style="background:${severityColor('high')}">${l.statusCode ?? 'timeout'}</span></td>
  <td>${esc(l.type)}</td>
  <td style="font-size:.75rem">${esc(l.sourceUrl.replace(result.baseUrl, ''))}</td>
  <td style="font-size:.75rem">${l.anchorText ? esc(l.anchorText) : '—'}</td>
</tr>`).join('')}
</tbody>
</table>` : ''}

${result.securityIssues.length ? `
<h2>Security Issues (${result.securityIssues.length})</h2>
${result.securityIssues.map(i => `
<div class="issue-detail-card">
  <div class="issue-header"><span class="badge" style="background:${severityColor(i.severity)}">${i.severity}</span> ${esc(i.type)}</div>
  <div class="issue-explanation">${securityExplanation(i)}</div>
</div>`).join('')}` : ''}

${result.depVulnerabilities.length ? `
<h2>Dependency Vulnerabilities (${result.depVulnerabilities.length})</h2>
<table>
<thead><tr><th>Package</th><th>Severity</th><th>Title</th><th>Details</th></tr></thead>
<tbody>
${result.depVulnerabilities.map(v => `<tr>
  <td><strong>${esc(v.name)}</strong></td>
  <td><span class="badge" style="background:${severityColor(v.severity)}">${v.severity}</span></td>
  <td>${esc(v.title)}</td>
  <td>${v.url ? `<a href="${esc(v.url)}" target="_blank">View</a>` : '—'}</td>
</tr>`).join('')}
</tbody>
</table>` : ''}

</div>
</body>
</html>`

  fs.writeFileSync(htmlPath, html)
  return htmlPath
}
