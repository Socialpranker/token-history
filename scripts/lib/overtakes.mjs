// Overtake detection: app A "overtakes" app B between two snapshots when
// A was ranked below B before and is ranked above B now. Each overtake is
// a ready-made story ("Hermes Agent just passed OpenClaw in real usage").

import { humanizeTokens } from './util.mjs';

const MIN_TOKENS = 1e9; // ignore noise at the bottom of the table

/**
 * @param prevApps apps array of the previous snapshot (with slug/rank/tokens)
 * @param curApps  apps array of the current snapshot
 * @returns events [{date, winner:{…}, loser:{…}}]
 */
export function detectOvertakes(prevApps, curApps, date, minTokens = MIN_TOKENS) {
  const prev = new Map(prevApps.map((a) => [a.slug, a]));
  const events = [];
  for (const a of curApps) {
    if (a.tokens < minTokens) continue;
    const pa = prev.get(a.slug);
    if (!pa) continue;
    for (const b of curApps) {
      if (a.slug === b.slug) continue;
      const pb = prev.get(b.slug);
      if (!pb) continue;
      if (a.rank < b.rank && pa.rank > pb.rank) {
        events.push({
          date,
          winner: { slug: a.slug, name: a.name, rank: a.rank, tokens: a.tokens },
          loser: { slug: b.slug, name: b.name, rank: b.rank, tokens: b.tokens },
        });
      }
    }
  }
  events.sort((x, y) => x.winner.rank - y.winner.rank || x.loser.rank - y.loser.rank);
  return events;
}

/** Markdown body for the alert issue. First line doubles as the title. */
export function overtakeIssueMarkdown(events, date) {
  const first = events[0];
  const extra = events.length > 1 ? ` (+${events.length - 1} more)` : '';
  const lines = [
    `# ⚡ ${first.winner.name} passed ${first.loser.name}${extra}`,
    '',
    `Detected in the ${date} snapshot of [OpenRouter App & Agent Rankings](https://openrouter.ai/rankings) (weekly token window):`,
    '',
  ];
  for (const e of events) {
    lines.push(
      `- **${e.winner.name}** (#${e.winner.rank}, ${humanizeTokens(e.winner.tokens)} tokens/wk) ` +
        `passed **${e.loser.name}** (#${e.loser.rank}, ${humanizeTokens(e.loser.tokens)} tokens/wk)`
    );
  }
  lines.push('', '_Source: OpenRouter (openrouter.ai/rankings). Automated alert by token-history._');
  return lines.join('\n');
}
