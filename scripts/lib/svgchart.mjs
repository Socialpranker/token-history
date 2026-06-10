// Zero-dependency SVG line charts for embedding in READMEs.
// Dark theme matching the site; regenerated on every collection run and
// served from GitHub Pages (correct image/svg+xml content-type).

import { humanizeTokens } from './util.mjs';

const PALETTE = ['#5ab0f7', '#f7775a', '#7df0a8', '#f5d76e', '#c89bf7', '#6ef0e0', '#f78ab9'];
const BG = '#0b0d10';
const GRID = '#1b2026';
const TEXT = '#e6e9ec';
const MUTED = '#8a949e';
const FONT = 'system-ui,-apple-system,Segoe UI,sans-serif';

const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * @param title    chart heading (e.g. app name or "Top agents")
 * @param series   [{ name, points: [[date, value], …] }] — values pre-filtered, numeric
 * @param branding footer-left text
 * @param citation footer-right text
 */
export function renderChartSVG({
  title,
  series,
  width = 800,
  height = 360,
  branding = 'token-history',
  citation = 'Source: OpenRouter (openrouter.ai/rankings)',
}) {
  const PAD = { l: 64, r: 16, t: 44, b: 40 };
  const plotW = width - PAD.l - PAD.r;
  const plotH = height - PAD.t - PAD.b;

  const drawn = series.filter((s) => s.points.length > 0).slice(0, PALETTE.length);
  const dates = [...new Set(drawn.flatMap((s) => s.points.map((p) => p[0])))].sort();
  const values = drawn.flatMap((s) => s.points.map((p) => p[1]));
  const vMax = values.length ? Math.max(...values) : 1;
  const vMin = values.length ? Math.min(...values) : 0;
  const yMax = vMax * 1.06 || 1;
  const yMin = Math.max(0, vMin * 0.85);
  const xFor = (d) => {
    const i = dates.indexOf(d);
    return PAD.l + (dates.length < 2 ? plotW / 2 : (i / (dates.length - 1)) * plotW);
  };
  const yFor = (v) => PAD.t + plotH - ((v - yMin) / (yMax - yMin || 1)) * plotH;

  const parts = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(title)}">`
  );
  parts.push(`<title>${esc(title)}</title>`);
  parts.push(`<rect width="${width}" height="${height}" rx="10" fill="${BG}"/>`);
  parts.push(
    `<text x="${PAD.l}" y="26" font-family="${FONT}" font-size="16" font-weight="600" fill="${TEXT}">${esc(title)}</text>`
  );

  // y grid + labels (4 ticks)
  for (let i = 0; i <= 3; i++) {
    const v = yMin + ((yMax - yMin) * i) / 3;
    const y = yFor(v);
    parts.push(`<line x1="${PAD.l}" y1="${y}" x2="${width - PAD.r}" y2="${y}" stroke="${GRID}" stroke-width="1"/>`);
    parts.push(
      `<text x="${PAD.l - 8}" y="${y + 4}" text-anchor="end" font-family="${FONT}" font-size="11" fill="${MUTED}">${humanizeTokens(v)}</text>`
    );
  }
  // x labels (first / mid / last)
  const xticks = dates.length <= 3 ? dates : [dates[0], dates[Math.floor(dates.length / 2)], dates[dates.length - 1]];
  for (const d of xticks) {
    parts.push(
      `<text x="${xFor(d)}" y="${height - PAD.b + 18}" text-anchor="middle" font-family="${FONT}" font-size="11" fill="${MUTED}">${esc(d)}</text>`
    );
  }

  drawn.forEach((s, i) => {
    const color = PALETTE[i % PALETTE.length];
    const pts = s.points.map((p) => `${xFor(p[0]).toFixed(1)},${yFor(p[1]).toFixed(1)}`);
    if (pts.length > 1) {
      parts.push(
        `<polyline points="${pts.join(' ')}" fill="none" stroke="${color}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>`
      );
    }
    if (s.points.length < 10) {
      for (const p of s.points) {
        parts.push(`<circle cx="${xFor(p[0]).toFixed(1)}" cy="${yFor(p[1]).toFixed(1)}" r="3.5" fill="${color}"/>`);
      }
    }
    // legend entry + latest value
    const last = s.points[s.points.length - 1];
    parts.push(
      `<g font-family="${FONT}" font-size="12">` +
        `<circle cx="${PAD.l + 4 + i * 170}" cy="${PAD.t - 8}" r="4" fill="${color}"/>` +
        `<text x="${PAD.l + 14 + i * 170}" y="${PAD.t - 4}" fill="${TEXT}">${esc(s.name)} · ${humanizeTokens(last[1])}/day</text>` +
        `</g>`
    );
  });

  if (drawn.length === 0) {
    parts.push(
      `<text x="${width / 2}" y="${height / 2}" text-anchor="middle" font-family="${FONT}" font-size="13" fill="${MUTED}">no data yet</text>`
    );
  }

  parts.push(
    `<text x="${PAD.l}" y="${height - 10}" font-family="${FONT}" font-size="11" fill="${MUTED}">${esc(branding)}</text>`
  );
  parts.push(
    `<text x="${width - PAD.r}" y="${height - 10}" text-anchor="end" font-family="${FONT}" font-size="11" fill="${MUTED}">${esc(citation)}</text>`
  );
  parts.push('</svg>');
  return parts.join('\n');
}

/** day-tokens points from a stored series (slot 1), nulls dropped */
export function dayPoints(series) {
  return (series?.points ?? [])
    .filter((p) => p[1] != null && Number.isFinite(p[1]))
    .map((p) => [p[0], p[1]]);
}
