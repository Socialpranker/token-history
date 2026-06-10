// Static Atom feed (feed.xml) regenerated on every run from recorded events.
// Subscribable by journalists/analysts without any server.

const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * @param siteUrl  e.g. https://socialpranker.github.io/token-history
 * @param repoUrl  e.g. https://github.com/Socialpranker/token-history
 * @param events   { overtakes, declines, entrants, digests } (raw stored arrays)
 */
export function buildAtomFeed({ siteUrl, repoUrl, events, updated = new Date().toISOString() }) {
  const items = [];
  for (const o of events.overtakes ?? []) {
    items.push({
      id: `overtake-${o.date}-${o.winner.slug}-${o.loser.slug}`,
      date: o.date,
      title: `⚡ ${o.winner.name} passed ${o.loser.name}`,
      summary: `${o.winner.name} (#${o.winner.rank}) passed ${o.loser.name} (#${o.loser.rank}) in weekly token volume.`,
      link: `${siteUrl}/#${o.winner.slug}&${o.loser.slug}`,
    });
  }
  for (const d of events.declines ?? []) {
    items.push({
      id: `decline-${d.date}-${d.slug}`,
      date: d.date,
      title: `📉 ${d.name} usage down ${d.drop_pct}%`,
      summary: `${d.name}: −${d.drop_pct}% weekly tokens vs ${d.base_date}.`,
      link: `${siteUrl}/#${d.slug}`,
    });
  }
  for (const e of events.entrants ?? []) {
    items.push({
      id: `entrant-${e.date}-${e.slug}`,
      date: e.date,
      title: `🆕 ${e.name} entered the top-20`,
      summary: `${e.name} appeared in the OpenRouter app rankings top-20.`,
      link: `${siteUrl}/#${e.slug}`,
    });
  }
  for (const g of events.digests ?? []) {
    items.push({
      id: `digest-${g.date}`,
      date: g.date,
      title: `📰 This week in agent usage — ${g.date}`,
      summary: 'Weekly digest: gainers, losers, new entrants, overtakes.',
      link: `${repoUrl}/issues?q=label%3Adigest`,
    });
  }
  items.sort((a, b) => (a.date < b.date ? 1 : -1));
  const latest = items.slice(0, 50);

  const entries = latest
    .map(
      (i) => `  <entry>
    <id>tag:token-history,${i.date}:${esc(i.id)}</id>
    <title>${esc(i.title)}</title>
    <updated>${i.date}T12:00:00Z</updated>
    <link href="${esc(i.link)}"/>
    <summary>${esc(i.summary)}</summary>
  </entry>`
    )
    .join('\n');

  return `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <id>${esc(siteUrl)}/</id>
  <title>token-history — agent usage events</title>
  <subtitle>Overtakes, declines and new entrants in the OpenRouter App &amp; Agent Rankings. Source: OpenRouter (openrouter.ai/rankings).</subtitle>
  <link href="${esc(siteUrl)}/"/>
  <link rel="self" href="${esc(siteUrl)}/feed.xml"/>
  <updated>${esc(updated)}</updated>
${entries}
</feed>
`;
}
