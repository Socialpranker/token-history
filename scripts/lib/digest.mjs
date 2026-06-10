// Weekly digest: "This week in agent usage" — auto-generated Monday issue.
// Compares the current snapshot with one ~7 days older; pulls week's events.

import { humanizeTokens } from './util.mjs';

const DAY = 86_400_000;

/** Digest is due on Mondays (UTC), once per date. */
export function digestDue(date, lastDigestDate) {
  const isMonday = new Date(date + 'T00:00:00Z').getUTCDay() === 1;
  return isMonday && lastDigestDate !== date;
}

function pctMoves(curWeek, oldWeek, topN = 3) {
  const old = new Map(oldWeek.map((a) => [a.slug, a]));
  const moves = [];
  for (const a of curWeek) {
    const b = old.get(a.slug);
    if (!b || !b.tokens || a.tokens < 1e9) continue;
    moves.push({ name: a.name, slug: a.slug, pct: Math.round((a.tokens / b.tokens - 1) * 100), tokens: a.tokens });
  }
  const gainers = moves.filter((m) => m.pct > 0).sort((x, y) => y.pct - x.pct).slice(0, topN);
  const losers = moves.filter((m) => m.pct < 0).sort((x, y) => x.pct - y.pct).slice(0, topN);
  return { gainers, losers };
}

function categoryShares(weekApps) {
  const byCat = {};
  let total = 0;
  for (const a of weekApps) {
    const cat = a.categories?.[0] ?? 'other';
    byCat[cat] = (byCat[cat] ?? 0) + a.tokens;
    total += a.tokens;
  }
  return Object.entries(byCat)
    .map(([cat, t]) => ({ cat, share: Math.round((t / total) * 100) }))
    .sort((x, y) => y.share - x.share)
    .filter((c) => c.share >= 3);
}

/**
 * @param date     digest date (Monday)
 * @param cur      { day, week } — current normalized windows
 * @param oldWeek  week window from ~7 days ago (or null)
 * @param events   { overtakes, declines, entrants } — already filtered to the last 7 days
 * @param indexApps current index apps (for momentum)
 */
export function buildDigestMarkdown({ date, cur, oldWeek, events, indexApps }) {
  const lines = [`# 📰 This week in agent usage — ${date}`, ''];
  const top = (cur.week ?? cur.day)[0];
  lines.push(
    `**#1 by weekly tokens: ${top.name}** (${humanizeTokens(top.tokens)}/wk).`,
    ''
  );

  if (oldWeek?.length) {
    const { gainers, losers } = pctMoves(cur.week ?? cur.day, oldWeek);
    if (gainers.length) {
      lines.push('**Top gainers (week over week):**');
      for (const g of gainers) lines.push(`- ${g.name}: +${g.pct}% → ${humanizeTokens(g.tokens)}/wk`);
      lines.push('');
    }
    if (losers.length) {
      lines.push('**Top losers:**');
      for (const l of losers) lines.push(`- ${l.name}: ${l.pct}% → ${humanizeTokens(l.tokens)}/wk`);
      lines.push('');
    }
  }

  const accel = (indexApps ?? [])
    .filter((a) => a.momentum != null && a.tokens > 5e9)
    .sort((x, y) => y.momentum - x.momentum);
  if (accel.length >= 2) {
    const hot = accel[0];
    const cold = accel[accel.length - 1];
    lines.push(
      `**Pace:** ${hot.name} is running ${Math.round((hot.momentum - 1) * 100)}% above its weekly average today; ` +
        `${cold.name} ${Math.round((1 - cold.momentum) * 100)}% below.`,
      ''
    );
  }

  if (events.entrants?.length) {
    lines.push('**New in the top-20:**');
    for (const e of events.entrants) lines.push(`- ${e.name} (entered ${e.date}, ${humanizeTokens(e.tokens)}/day)`);
    lines.push('');
  }
  if (events.overtakes?.length) {
    lines.push('**Overtakes:**');
    for (const o of events.overtakes) lines.push(`- ${o.date}: ${o.winner.name} passed ${o.loser.name}`);
    lines.push('');
  }
  if (events.declines?.length) {
    lines.push('**Declines:**');
    for (const d of events.declines) lines.push(`- ${d.name}: −${d.drop_pct}% over ~30 days`);
    lines.push('');
  }

  const cats = categoryShares(cur.week ?? cur.day);
  if (cats.length) {
    lines.push(
      '**Where the tokens go:** ' + cats.map((c) => `${c.cat} ${c.share}%`).join(' · '),
      ''
    );
  }

  lines.push(
    `_Data: [token-history](https://socialpranker.github.io/token-history/) — daily archive of OpenRouter App & Agent Rankings. ` +
      `Source: OpenRouter (openrouter.ai/rankings). Watch this repo to get the digest by email._`
  );
  return lines.join('\n');
}

/** filter helper: events within the last `days` of `date` */
export function lastDays(events, date, days = 7) {
  const cutoff = Date.parse(date) - days * DAY;
  return (events ?? []).filter((e) => Date.parse(e.date) >= cutoff);
}
