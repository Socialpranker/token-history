#!/usr/bin/env node
// Daily collector. Primary source: the JSON endpoint the rankings page itself
// uses (/api/frontend/rankings/apps — day/week/month windows, no key needed).
// Fallback: extracting the embedded payload from the page HTML. Core archiving
// FAILS LOUDLY (red workflow run) — the predecessor project died silently.
// Enhancement layers (GitHub stars) fail soft.

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { extractApps, normalizeApiPayload } from './lib/extract.mjs';
import { Store } from './lib/store.mjs';
import { detectOvertakes, overtakeIssueMarkdown } from './lib/overtakes.mjs';
import { detectDeclines, declineIssueMarkdown } from './lib/declines.mjs';
import { fetchStarsMap } from './lib/stars.mjs';
import { todayUTC, humanizeTokens } from './lib/util.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const API_URL = 'https://openrouter.ai/api/frontend/rankings/apps';
const PAGE_URL = 'https://openrouter.ai/rankings';
const UA = 'token-history-bot/0.1 (+https://github.com/Socialpranker/token-history)';

async function fetchWithTimeout(url, accept) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 45_000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'user-agent': UA, accept },
      redirect: 'follow',
    });
    if (!res.ok) throw new Error(`GET ${url} → HTTP ${res.status}`);
    return res;
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

async function fetchWindows() {
  try {
    const res = await fetchWithTimeout(API_URL, 'application/json');
    const windows = normalizeApiPayload(await res.json());
    return { windows, via: 'frontend-api' };
  } catch (err) {
    console.warn(`[collect] API source failed (${err.message}); falling back to page HTML`);
    const res = await fetchWithTimeout(PAGE_URL, 'text/html');
    const { apps, via } = extractApps(await res.text());
    return { windows: { day: apps }, via: `html-fallback/${via}` };
  }
}

async function main() {
  const date = process.env.SNAPSHOT_DATE || todayUTC();
  const fetchedAt = new Date().toISOString();

  // --- core: tokens (fatal on failure) ---
  const { windows: rawWindows, via } = await fetchWindows();

  const store = new Store(ROOT);
  const withSlugs = (arr) =>
    arr.map((a) => ({ ...a, slug: store.resolveSlug(a.name, a.url, a.slug) }));
  const windows = {};
  for (const [win, arr] of Object.entries(rawWindows)) windows[win] = withSlugs(arr);

  const dayApps = windows.day ?? windows.week ?? Object.values(windows)[0];
  const weekApps = windows.week ?? null;
  const weekBySlug = new Map((weekApps ?? []).map((a) => [a.slug, a]));

  // --- enhancement: GitHub stars (never fatal) ---
  const repos = readReposMap();
  const starsMap = await fetchStarsMap(repos, { token: process.env.GH_API_TOKEN, userAgent: UA });
  const decorate = (a) => ({
    ...a,
    stars: starsMap[a.slug] ?? null,
    repo: repos[a.slug] ?? null,
    week_tokens: weekBySlug.get(a.slug)?.tokens ?? null,
    week_rank: weekBySlug.get(a.slug)?.rank ?? null,
  });
  const indexApps = dayApps.map(decorate);

  // series = union of day + week apps (so nobody drops out of the archive)
  const daySlugs = new Set(dayApps.map((a) => a.slug));
  const weekOnly = (weekApps ?? [])
    .filter((a) => !daySlugs.has(a.slug))
    .map((a) => ({ ...a, tokens: null, rank: null, requests: null }))
    .map(decorate);
  const seriesApps = [...indexApps, ...weekOnly];

  const meta = {
    source_url: API_URL,
    fetched_at: fetchedAt,
    window: 'day', // primary window for series/badges; week+month archived in snapshot
    extracted_via: via,
    citation: `Source: OpenRouter (openrouter.ai/rankings), as of ${fetchedAt}.`,
  };

  // overtake detection uses the previous snapshot, read BEFORE writing today's
  const prev = store.readPrevSnapshot(date);

  store.writeSnapshot(date, meta, windows);
  store.updateSeries(date, seriesApps);
  store.writeIndex(date, meta, indexApps);
  store.writeLatest(date);
  store.writeBadges(indexApps);

  // --- alerts: overtakes (on the WEEK window — stable, not daily noise) ---
  let overtakes = [];
  const prevWeek = prev?.windows?.week ?? null;
  if (prevWeek?.length && weekApps?.length) {
    overtakes = detectOvertakes(prevWeek, weekApps, date);
    if (overtakes.length > 0) {
      store.appendOvertakes(overtakes);
      const f = process.env.OVERTAKE_ISSUE_FILE;
      if (f) fs.writeFileSync(f, overtakeIssueMarkdown(overtakes, date) + '\n');
    }
  }

  // --- alerts: declines (week tokens; needs ~30 days of archive) ---
  const declineApps = (weekApps ?? dayApps).map((a) => ({ ...a }));
  const declines = detectDeclines({
    apps: declineApps,
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
  const starred = indexApps.filter((a) => a.stars != null).length;
  console.log(
    `[token-history] ${date} via=${via} windows=${Object.keys(windows).join(',')} ` +
      `apps=${indexApps.length} stars=${starred}/${Object.keys(repos).length} ` +
      `overtakes=${overtakes.length} declines=${declines.length}`
  );
  for (const a of indexApps.slice(0, 5)) {
    const star = a.stars != null ? ` ★${humanizeTokens(a.stars)}` : '';
    console.log(`  #${a.rank} ${a.name} — ${humanizeTokens(a.tokens)} tokens/day${star}`);
  }
  for (const e of overtakes) console.log(`  ⚡ ${e.winner.name} passed ${e.loser.name} (week)`);
  for (const e of declines) console.log(`  📉 ${e.name} −${e.drop_pct}% since ${e.base_date}`);
}

main().catch((err) => {
  console.error('[token-history] FAILED:', err.message);
  process.exit(1);
});
