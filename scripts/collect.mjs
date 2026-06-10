#!/usr/bin/env node
// Daily collector: fetch openrouter.ai/rankings → archive the apps ranking.
// Core (tokens) is designed to FAIL LOUDLY: any extraction problem exits
// non-zero so the GitHub Actions run goes red (the predecessor project died
// silently). Enhancement layers (GitHub stars) fail soft.

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { extractApps } from './lib/extract.mjs';
import { Store } from './lib/store.mjs';
import { detectOvertakes, overtakeIssueMarkdown } from './lib/overtakes.mjs';
import { detectDeclines, declineIssueMarkdown } from './lib/declines.mjs';
import { fetchStarsMap } from './lib/stars.mjs';
import { todayUTC, humanizeTokens } from './lib/util.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_URL = 'https://openrouter.ai/rankings';
const UA = 'token-history-bot/0.1 (+https://github.com/Socialpranker/token-history)';

async function fetchHtml(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 45_000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'user-agent': UA, accept: 'text/html' },
      redirect: 'follow',
    });
    if (!res.ok) throw new Error(`GET ${url} → HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

function readReposMap() {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, 'repos.json'), 'utf8'));
  } catch {
    return {};
  }
}

async function main() {
  const date = process.env.SNAPSHOT_DATE || todayUTC();
  const fetchedAt = new Date().toISOString();

  // --- core: tokens (fatal on failure) ---
  const html = await fetchHtml(SOURCE_URL);
  const { apps: rawApps, via } = extractApps(html);

  const store = new Store(ROOT);
  let apps = rawApps.map((a) => ({ ...a, slug: store.resolveSlug(a.name, a.url) }));

  // --- enhancement: GitHub stars (never fatal) ---
  const repos = readReposMap();
  const starsMap = await fetchStarsMap(repos, { token: process.env.GH_API_TOKEN, userAgent: UA });
  apps = apps.map((a) => ({
    ...a,
    stars: starsMap[a.slug] ?? null,
    repo: repos[a.slug] ?? null,
  }));

  const meta = {
    source_url: SOURCE_URL,
    fetched_at: fetchedAt,
    window: 'week', // the rankings page shows trailing-week token totals
    extracted_via: via,
    citation: `Source: OpenRouter (openrouter.ai/rankings), as of ${fetchedAt}.`,
  };

  // overtake detection uses the previous snapshot, read BEFORE writing today's
  const prev = store.readPrevSnapshot(date);

  store.writeSnapshot(date, meta, apps);
  store.updateSeries(date, apps);
  store.writeIndex(date, meta, apps);
  store.writeLatest(date);
  store.writeBadges(apps);

  // --- alerts: overtakes ---
  let overtakes = [];
  if (prev?.apps?.length) {
    const prevApps = prev.apps.map((a) => ({ ...a, slug: a.slug ?? store.resolveSlug(a.name, a.url) }));
    overtakes = detectOvertakes(prevApps, apps, date);
    if (overtakes.length > 0) {
      store.appendOvertakes(overtakes);
      const f = process.env.OVERTAKE_ISSUE_FILE;
      if (f) fs.writeFileSync(f, overtakeIssueMarkdown(overtakes, date) + '\n');
    }
  }

  // --- alerts: declines (needs ~windowDays of archive; inert before that) ---
  const declines = detectDeclines({
    apps,
    date,
    getSeries: (slug) => store.readSeries(slug),
    prevEvents: store.readDeclines(),
  });
  if (declines.length > 0) {
    store.appendDeclines(declines);
    const f = process.env.DECLINE_ISSUE_FILE;
    if (f) fs.writeFileSync(f, declineIssueMarkdown(declines, date) + '\n');
  }

  // --- summary ---
  const starred = apps.filter((a) => a.stars != null).length;
  console.log(
    `[token-history] ${date} via=${via} apps=${apps.length} stars=${starred}/${Object.keys(repos).length} ` +
      `overtakes=${overtakes.length} declines=${declines.length}`
  );
  for (const a of apps.slice(0, 5)) {
    const star = a.stars != null ? ` ★${humanizeTokens(a.stars)}` : '';
    console.log(`  #${a.rank} ${a.name} — ${humanizeTokens(a.tokens)} tokens/wk${star}`);
  }
  for (const e of overtakes) console.log(`  ⚡ ${e.winner.name} passed ${e.loser.name}`);
  for (const e of declines) console.log(`  📉 ${e.name} −${e.drop_pct}% since ${e.base_date}`);
}

main().catch((err) => {
  console.error('[token-history] FAILED:', err.message);
  process.exit(1);
});
