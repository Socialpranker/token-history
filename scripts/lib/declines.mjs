// Decline detection: the story star charts are structurally incapable of
// telling. Fires when an app's weekly token volume drops ≥ minDropPct
// versus a baseline ~windowDays ago. Cooldown prevents re-alerting the
// same app every day while it keeps falling.

import { humanizeTokens } from './util.mjs';

const DAY = 86_400_000;

/**
 * @param apps       current apps (with slug/name/tokens)
 * @param date       current snapshot date YYYY-MM-DD
 * @param getSeries  (slug) => series object ({points:[[date,tokens,…]]}) or null
 * @param prevEvents previously recorded decline events (for cooldown)
 */
export function detectDeclines({
  apps,
  date,
  getSeries,
  prevEvents = [],
  windowDays = 30,
  minDropPct = 40,
  minTokensThen = 5e9,
  cooldownDays = 30,
}) {
  const now = Date.parse(date);
  const cutoff = now - (windowDays - 2) * DAY; // accept baselines ≥ windowDays-2 old
  const events = [];
  for (const app of apps) {
    const last = prevEvents.filter((e) => e.slug === app.slug).map((e) => Date.parse(e.date)).sort().pop();
    if (last !== undefined && now - last < cooldownDays * DAY) continue;

    const series = getSeries(app.slug);
    if (!series?.points?.length) continue;
    const base = series.points.filter((p) => Date.parse(p[0]) <= cutoff).pop();
    if (!base) continue; // archive younger than the window

    // prefer the week-window value (slot 5) for stability; fall back to day (slot 1)
    const tokensThen = base[5] ?? base[1];
    if (!Number.isFinite(tokensThen) || tokensThen < minTokensThen) continue;
    const dropPct = (1 - app.tokens / tokensThen) * 100;
    if (dropPct < minDropPct) continue;

    events.push({
      date,
      slug: app.slug,
      name: app.name,
      base_date: base[0],
      tokens_then: tokensThen,
      tokens_now: app.tokens,
      drop_pct: Math.round(dropPct),
    });
  }
  events.sort((a, b) => b.drop_pct - a.drop_pct);
  return events;
}

/** Markdown body for the alert issue. First line doubles as the title. */
export function declineIssueMarkdown(events, date) {
  const first = events[0];
  const extra = events.length > 1 ? ` (+${events.length - 1} more)` : '';
  const lines = [
    `# 📉 ${first.name} usage down ${first.drop_pct}% in ~30 days${extra}`,
    '',
    `Detected in the ${date} snapshot of [OpenRouter App & Agent Rankings](https://openrouter.ai/rankings) (weekly token window):`,
    '',
  ];
  for (const e of events) {
    lines.push(
      `- **${e.name}**: ${humanizeTokens(e.tokens_then)} → ${humanizeTokens(e.tokens_now)} tokens/wk ` +
        `(−${e.drop_pct}% since ${e.base_date})`
    );
  }
  lines.push('', '_Source: OpenRouter (openrouter.ai/rankings). Automated alert by token-history._');
  return lines.join('\n');
}
