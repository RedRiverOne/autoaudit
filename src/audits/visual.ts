import type { Page } from 'playwright'
import type { VisualIssue } from '../types.js'
import * as fs from 'fs'
import * as path from 'path'

export async function runVisualAudit(page: Page, device: string, pagePath: string, outputDir: string): Promise<{ screenshotPath: string; issues: VisualIssue[] }> {
  const slug = pagePath.replace(/\//g, '_').replace(/^_/, '') || 'home'
  const dir = path.join(outputDir, 'screenshots', device.toLowerCase().replace(/\s/g, '-'))
  fs.mkdirSync(dir, { recursive: true })
  const screenshotPath = path.join(dir, `${slug}.png`)

  await page.screenshot({ path: screenshotPath, fullPage: true })

  try {
    // Use addScriptTag + evaluate to avoid tsx __name transform issue
    await page.addScriptTag({
      content: `
        window.__visualAudit = function() {
          var found = [];
          var vw = window.innerWidth;
          var seen = {};

          function getSel(el) {
            var tag = el.tagName.toLowerCase();
            if (el.id) return tag + '#' + el.id;
            var cls = el.className ? String(el.className).split(' ').filter(function(c) { return c && c.indexOf('svelte-') !== 0; })[0] : '';
            return cls ? tag + '.' + cls : tag;
          }

          function srgb(c) { c = c / 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
          function lum(r, g, b) { return 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b); }
          function parseC(color) {
            var m = color.match(/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)(?:,\\s*([\\d.]+))?\\)/);
            if (!m) return null;
            return [parseInt(m[1]), parseInt(m[2]), parseInt(m[3]), m[4] !== undefined ? parseFloat(m[4]) : 1];
          }
          function cr(l1, l2) { return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); }

          var allEls = document.querySelectorAll('*');
          for (var i = 0; i < allEls.length; i++) {
            var el = allEls[i];
            var st = window.getComputedStyle(el);
            if (st.position === 'fixed' || st.position === 'absolute') continue;
            if (st.display === 'none' || st.visibility === 'hidden') continue;
            // Skip children of off-screen fixed parents
            var fixedParent = el.closest('[style*="translateX"]');
            if (fixedParent) continue;
            var rect = el.getBoundingClientRect();
            if (rect.width > 0 && rect.right > vw + 2) {
              var sel = getSel(el);
              if (seen['of:' + sel]) continue;
              seen['of:' + sel] = 1;
              found.push({ type: 'overflow', selector: sel, description: 'Extends ' + Math.round(rect.right - vw) + 'px beyond viewport (' + Math.round(rect.width) + 'px wide, viewport ' + vw + 'px)', severity: 'warning' });
            }
          }

          var textEls = document.querySelectorAll('p, span, a, h1, h2, h3, h4, h5, h6, li, td, th, label, button');
          for (var j = 0; j < textEls.length; j++) {
            var tel = textEls[j];
            var ts = window.getComputedStyle(tel);
            if (ts.display === 'none' || ts.visibility === 'hidden') continue;
            var txt = (tel.textContent || '').trim();
            if (!txt) continue;
            if (tel.children.length > 3) continue;

            var fg = parseC(ts.color);
            if (!fg || fg[3] < 0.1) continue;

            var bg = null;
            var cur = tel;
            while (cur) {
              var ps = window.getComputedStyle(cur);
              var pbg = parseC(ps.backgroundColor);
              if (pbg && pbg[3] > 0.1) { bg = pbg; break; }
              cur = cur.parentElement;
            }
            if (!bg) bg = [255, 255, 255, 1];

            var fgL = lum(fg[0], fg[1], fg[2]);
            var bgL = lum(bg[0], bg[1], bg[2]);
            var ratio = cr(fgL, bgL);
            var fontSize = parseFloat(ts.fontSize);
            var bold = parseInt(ts.fontWeight) >= 700;
            var large = fontSize >= 24 || (fontSize >= 18.66 && bold);
            var thresh = large ? 3 : 4.5;

            if (ratio < thresh) {
              var csel = getSel(tel);
              if (seen['ct:' + csel]) continue;
              seen['ct:' + csel] = 1;
              found.push({ type: 'contrast', selector: csel, description: 'Contrast ' + ratio.toFixed(1) + ':1 (needs ' + thresh + ':1). "' + txt.slice(0, 40) + '" color:' + ts.color + ' bg:' + (ts.backgroundColor || 'inherited'), severity: ratio < 2 ? 'critical' : 'warning' });
            }
          }

          return found.slice(0, 20);
        };
      `,
    })
    const issues = await page.evaluate('window.__visualAudit()') as VisualIssue[]
    return { screenshotPath, issues }
  } catch (e) {
    console.error(`    Visual check error: ${(e as Error).message.split('\n')[0]}`)
    return { screenshotPath, issues: [] }
  }
}
