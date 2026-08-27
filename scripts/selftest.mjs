#!/usr/bin/env node
// Offline self-test: exercises extraction, store, badges and overtake logic
// against a real-shape fixture (no network). Run: npm run selftest

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractApps, decodeNextFChunks, normalizeApiPayload } from './lib/extract.mjs';
import { Store } from './lib/store.mjs';
import { detectOvertakes, overtakeIssueMarkdown } from './lib/overtakes.mjs';
import { detectDeclines, declineIssueMarkdown } from './lib/declines.mjs';
import { renderChartSVG, dayPoints } from './lib/svgchart.mjs';
import { buildAtomFeed } from './lib/feed.mjs';
import { digestDue, buildDigestMarkdown, lastDays } from './lib/digest.mjs';
import { slugify, humanizeTokens } from './lib/util.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(
  fs.readFileSync(path.join(HERE, '..', 'test', 'fixtures', 'apps-snapshot.json'), 'utf8')
);

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

// Build a synthetic Next.js page: the payload is split across two
// __next_f.push chunks mid-string, exactly like real RSC streaming.
function buildPage(payloadObj, { breakAt = 1234 } = {}) {
  const payload = JSON.stringify(payloadObj);
  const a = payload.slice(0, breakAt);
  const b = payload.slice(breakAt);
  return (
    '<!DOCTYPE html><html><body><div id="app">No models found</div>' +
    `<script>self.__next_f.push([1,${JSON.stringify(a)}])</script>` +
    `<script>self.__next_f.push([1,${JSON.stringify(b)}])</script>` +
    '</body></html>'
  );
}

console.log('extract:');

test('decodes and joins split __next_f chunks', () => {
  const html = buildPage({ hello: 'world'.repeat(500) });
  const joined = decodeNextFChunks(html);
  assert.ok(joined.includes('"hello"'));
  JSON.parse(joined); // must be valid JSON again after the join
});

test('extracts apps via "apps": key from split chunks', () => {
  const html = buildPage({ props: { rankings: { apps: fixture }, x: 1 } });
  const { apps, via } = extractApps(html);
  assert.equal(apps.length, 20);
  assert.equal(via, 'next_f/apps-key');
  assert.equal(apps[0].name, 'OpenClaw');
  assert.equal(apps[0].tokens, 894267675606);
  assert.equal(apps[5].name, 'Hermes Agent');
  assert.equal(apps[5].description, null);
});

test('falls back to object scan when the key is renamed', () => {
  const html = buildPage({ props: { rankings: { zzapps: fixture } } });
  const { apps, via } = extractApps(html);
  assert.ok(via.endsWith('fallback-objects'));
  assert.equal(apps.length, 20);
  assert.equal(apps[0].name, 'OpenClaw');
});

test('fallback ignores model rows (model_id present)', () => {
  const modelRows = fixture.map((a, i) => ({ ...a, name: 'model-' + i, model_id: 'x/y' }));
  const html = buildPage({ a: { zz: modelRows }, b: { zz2: fixture } });
  const { apps } = extractApps(html);
  assert.equal(apps.length, 20);
  assert.ok(apps.every((a) => !a.name.startsWith('model-')));
});

test('throws loudly on an empty page', () => {
  assert.throws(() => extractApps('<html><body>nothing here</body></html>'), /extractApps/);
});

console.log('api payload (real fixture):');

test('normalizes day/week/month windows from the live API shape', () => {
  const api = JSON.parse(
    fs.readFileSync(path.join(HERE, '..', 'test', 'fixtures', 'apps-api.json'), 'utf8')
  );
  const windows = normalizeApiPayload(api);
  assert.deepEqual(Object.keys(windows).sort(), ['day', 'month', 'week']);
  assert.equal(windows.day.length, 20);
  const top = windows.day[0];
  assert.equal(top.name, 'Hermes Agent');
  assert.equal(top.slug, 'hermes-agent');
  assert.ok(Number.isFinite(top.tokens) && top.tokens > 1e9);
  assert.ok(Number.isFinite(top.requests));
  assert.ok(windows.week[0].tokens > windows.day[0].tokens); // week ⊇ day volumes
});

test('throws loudly on an unrecognized API shape', () => {
  assert.throws(() => normalizeApiPayload({ data: { day: 'nope' } }), /normalizeApiPayload/);
  assert.throws(() => normalizeApiPayload({}), /normalizeApiPayload/);
});

console.log('util:');

test('slugify', () => {
  assert.equal(slugify('OpenClaw'), 'openclaw');
  assert.equal(slugify('Kilo Code'), 'kilo-code');
  assert.equal(slugify('ISEKAI ZERO'), 'isekai-zero');
  assert.equal(slugify('Chub AI'), 'chub-ai');
  assert.equal(slugify('  ---  '), 'app');
});

test('humanizeTokens', () => {
  assert.equal(humanizeTokens(894267675606), '894B');
  assert.equal(humanizeTokens(1631041198302), '1.63T');
  assert.equal(humanizeTokens(7021170891), '7.02B');
  assert.equal(humanizeTokens(40732224847), '40.7B');
  assert.equal(humanizeTokens(999), '999');
});

console.log('store:');

test('snapshot + series are idempotent per date', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'th-'));
  const store = new Store(tmp);
  const apps = fixture.map((a) => ({ ...a, slug: store.resolveSlug(a.name, a.url) }));
  const meta = { fetched_at: '2026-06-09T00:00:00Z', window: 'day', citation: 'x' };

  store.writeSnapshot('2026-06-09', meta, { day: apps });
  store.updateSeries('2026-06-09', apps);
  store.updateSeries('2026-06-09', apps); // same date twice → still one point
  store.updateSeries('2026-06-10', apps);
  store.writeIndex('2026-06-10', meta, apps);
  store.writeLatest('2026-06-10');
  store.writeBadges(apps);

  const series = JSON.parse(fs.readFileSync(path.join(tmp, 'data', 'series', 'openclaw.json'), 'utf8'));
  assert.equal(series.points.length, 2);
  assert.deepEqual(series.points[0][0], '2026-06-09');
  assert.equal(series.points[0].length, 7); // fixed-width points

  const idx = JSON.parse(fs.readFileSync(path.join(tmp, 'data', 'index.json'), 'utf8'));
  assert.equal(idx.apps.length, 20);
  assert.equal(idx.apps[0].tokens_display, '894B');

  const badge = JSON.parse(fs.readFileSync(path.join(tmp, 'badges', 'openclaw.json'), 'utf8'));
  assert.equal(badge.schemaVersion, 1);
  assert.equal(badge.message, '894B');
  assert.equal(badge.label, 'tokens · day');

  const prev = store.readPrevSnapshot('2026-06-10');
  assert.equal(prev.windows.day[0].name, 'OpenClaw');
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('resolveSlug prefers a valid API slug, rejects a bad one', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'th-'));
  const store = new Store(tmp);
  assert.equal(store.resolveSlug('Hermes Agent', 'u', 'hermes-agent'), 'hermes-agent');
  assert.equal(store.resolveSlug('Hermes Agent', 'u', 'Bad Slug!'), 'hermes-agent');
  assert.equal(store.resolveSlug('Hermes Agent', 'u', null), 'hermes-agent');
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('slug collision with a different url gets a suffix', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'th-'));
  const store = new Store(tmp);
  const apps = [{ rank: 1, name: 'Foo', url: 'https://a.com', tokens: 5e9, requests: 1, categories: [], description: null, slug: 'foo' }];
  store.updateSeries('2026-06-09', apps);
  const slug2 = store.resolveSlug('Foo', 'https://b.com');
  assert.notEqual(slug2, 'foo');
  assert.ok(slug2.startsWith('foo-'));
  fs.rmSync(tmp, { recursive: true, force: true });
});

console.log('overtakes:');

test('detects a rank swap', () => {
  const prev = [
    { slug: 'a', name: 'A', rank: 1, tokens: 10e9 },
    { slug: 'b', name: 'B', rank: 2, tokens: 9e9 },
    { slug: 'c', name: 'C', rank: 3, tokens: 1e9 },
  ];
  const cur = [
    { slug: 'b', name: 'B', rank: 1, tokens: 11e9 },
    { slug: 'a', name: 'A', rank: 2, tokens: 10e9 },
    { slug: 'c', name: 'C', rank: 3, tokens: 1e9 },
  ];
  const events = detectOvertakes(prev, cur, '2026-06-09');
  assert.equal(events.length, 1);
  assert.equal(events[0].winner.slug, 'b');
  assert.equal(events[0].loser.slug, 'a');

  const md = overtakeIssueMarkdown(events, '2026-06-09');
  assert.ok(md.startsWith('# ⚡ B passed A'));
  assert.ok(md.includes('Source: OpenRouter'));
});

test('no event when nothing changes / below token floor', () => {
  const prev = [
    { slug: 'a', name: 'A', rank: 1, tokens: 10e9 },
    { slug: 'b', name: 'B', rank: 2, tokens: 9e9 },
    { slug: 'x', name: 'X', rank: 9, tokens: 2e8 },
    { slug: 'y', name: 'Y', rank: 10, tokens: 1e8 },
  ];
  const cur = [
    { slug: 'a', name: 'A', rank: 1, tokens: 10e9 },
    { slug: 'b', name: 'B', rank: 2, tokens: 9e9 },
    { slug: 'y', name: 'Y', rank: 9, tokens: 3e8 }, // swap below the floor
    { slug: 'x', name: 'X', rank: 10, tokens: 2e8 },
  ];
  assert.equal(detectOvertakes(prev, cur, '2026-06-09').length, 0);
});

test('newcomers (no prev entry) do not produce events', () => {
  const prev = [{ slug: 'a', name: 'A', rank: 1, tokens: 10e9 }];
  const cur = [
    { slug: 'n', name: 'New', rank: 1, tokens: 99e9 },
    { slug: 'a', name: 'A', rank: 2, tokens: 10e9 },
  ];
  assert.equal(detectOvertakes(prev, cur, '2026-06-09').length, 0);
});

console.log('stars & depth:');

test('series point: stars in slot 4, week tokens/rank in slots 5-6, nulls when unknown', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'th-'));
  const store = new Store(tmp);
  const base = { rank: 1, name: 'OpenClaw', url: 'https://openclaw.ai/', tokens: 186e9, requests: 2e6, categories: [], description: null, slug: 'openclaw' };
  store.updateSeries('2026-06-09', [{ ...base, stars: 377822, week_tokens: 1308e9, week_rank: 5 }]);
  store.updateSeries('2026-06-10', [{ ...base }]); // stars/week unavailable that day
  const s = JSON.parse(fs.readFileSync(path.join(tmp, 'data', 'series', 'openclaw.json'), 'utf8'));
  assert.deepEqual(s.points[0], ['2026-06-09', 186e9, 1, 2e6, 377822, 1308e9, 5]);
  assert.deepEqual(s.points[1], ['2026-06-10', 186e9, 1, 2e6, null, null, null]);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('index carries stars, repo and tokens_per_request', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'th-'));
  const store = new Store(tmp);
  const meta = { fetched_at: 'x', window: 'week', citation: 'c' };
  const apps = [
    { rank: 1, name: 'OpenClaw', url: 'u', tokens: 894267675606, requests: 13327434, categories: [], description: null, slug: 'openclaw', stars: 377822, repo: 'openclaw/openclaw' },
    { rank: 2, name: 'NoStars', url: 'u2', tokens: 10e9, requests: 0, categories: [], description: null, slug: 'nostars' },
  ];
  store.writeIndex('2026-06-09', meta, apps);
  const idx = JSON.parse(fs.readFileSync(path.join(tmp, 'data', 'index.json'), 'utf8'));
  assert.equal(idx.apps[0].stars, 377822);
  assert.equal(idx.apps[0].repo, 'openclaw/openclaw');
  assert.equal(idx.apps[0].tokens_per_request, Math.round(894267675606 / 13327434));
  assert.equal(idx.apps[1].stars, null);
  assert.equal(idx.apps[1].tokens_per_request, null);
  assert.equal(idx.apps[1].week_tokens, null);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('week-window value (slot 5) is preferred for decline baselines', () => {
  const series = { a: { slug: 'a', points: [['2026-05-10', 10e9, 1, 1, null, 100e9, 2]] } };
  const events = detectDeclines({
    apps: [{ slug: 'a', name: 'A', tokens: 50e9 }], // current week tokens
    date: '2026-06-09',
    getSeries: (s) => series[s],
  });
  assert.equal(events.length, 1);
  assert.equal(events[0].drop_pct, 50); // vs 100B week baseline, not 10B day
});

console.log('declines:');

const mkSeries = (points) => ({ slug: 'a', name: 'A', points });

test('fires on a ≥40% drop vs a ~30-day-old baseline', () => {
  const series = { a: mkSeries([['2026-05-10', 100e9, 1, 1], ['2026-06-08', 60e9, 1, 1]]) };
  const events = detectDeclines({
    apps: [{ slug: 'a', name: 'A', tokens: 50e9 }],
    date: '2026-06-09',
    getSeries: (s) => series[s],
  });
  assert.equal(events.length, 1);
  assert.equal(events[0].drop_pct, 50);
  assert.equal(events[0].base_date, '2026-05-10');
  const md = declineIssueMarkdown(events, '2026-06-09');
  assert.ok(md.startsWith('# 📉 A usage down 50%'));
  assert.ok(md.includes('Source: OpenRouter'));
});

test('silent when the archive is younger than the window', () => {
  const series = { a: mkSeries([['2026-06-01', 100e9, 1, 1]]) };
  const events = detectDeclines({
    apps: [{ slug: 'a', name: 'A', tokens: 10e9 }],
    date: '2026-06-09',
    getSeries: (s) => series[s],
  });
  assert.equal(events.length, 0);
});

test('respects cooldown and the token floor', () => {
  const series = { a: mkSeries([['2026-05-10', 100e9, 1, 1]]), b: mkSeries([['2026-05-10', 1e9, 2, 1]]) };
  const apps = [
    { slug: 'a', name: 'A', tokens: 50e9 },
    { slug: 'b', name: 'B', tokens: 0.4e9 }, // 60% drop but baseline below 5B floor
  ];
  const withCooldown = detectDeclines({
    apps, date: '2026-06-09', getSeries: (s) => series[s],
    prevEvents: [{ slug: 'a', date: '2026-05-25' }],
  });
  assert.equal(withCooldown.length, 0);
  const without = detectDeclines({ apps, date: '2026-06-09', getSeries: (s) => series[s] });
  assert.equal(without.length, 1);
  assert.equal(without[0].slug, 'a');
});

test('no event on growth', () => {
  const series = { a: mkSeries([['2026-05-10', 50e9, 1, 1]]) };
  const events = detectDeclines({
    apps: [{ slug: 'a', name: 'A', tokens: 80e9 }],
    date: '2026-06-09',
    getSeries: (s) => series[s],
  });
  assert.equal(events.length, 0);
});

console.log('svg / feed / digest / momentum:');

test('momentum lands in index.json as day×7/week', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'th-'));
  const store = new Store(tmp);
  const meta = { fetched_at: 'x', window: 'day', citation: 'c' };
  store.writeIndex('2026-06-10', meta, [
    { rank: 1, name: 'A', url: 'u', tokens: 814e9, requests: 1, categories: [], description: null, slug: 'a', week_tokens: 5596e9, week_rank: 1 },
    { rank: 2, name: 'B', url: 'u', tokens: 10e9, requests: 1, categories: [], description: null, slug: 'b' },
  ]);
  const idx = JSON.parse(fs.readFileSync(path.join(tmp, 'data', 'index.json'), 'utf8'));
  assert.equal(idx.apps[0].momentum, Number(((814e9 * 7) / 5596e9).toFixed(2))); // ≈1.02
  assert.equal(idx.apps[1].momentum, null);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('renderChartSVG produces valid-looking SVG with line, dots and branding', () => {
  const svg = renderChartSVG({
    title: 'OpenClaw — tokens per day',
    series: [{ name: 'OpenClaw', points: [['2026-06-09', 190e9], ['2026-06-10', 186e9]] }],
    branding: 'token-history · test',
  });
  assert.ok(svg.startsWith('<svg'));
  assert.ok(svg.includes('polyline'));
  assert.ok(svg.includes('circle')); // few points → dots
  assert.ok(svg.includes('OpenClaw'));
  assert.ok(svg.includes('token-history · test'));
  assert.ok(svg.includes('Source: OpenRouter'));
  assert.ok(!svg.includes('&&')); // crude unescaped-entity guard
});

test('dayPoints drops null slots', () => {
  const pts = dayPoints({ points: [['d1', 5, 1, 1, null, 9, 1], ['d2', null, null, null, null, 8, 2]] });
  assert.deepEqual(pts, [['d1', 5]]);
});

test('buildAtomFeed is well-formed and escapes entities', () => {
  const xml = buildAtomFeed({
    siteUrl: 'https://x.test/th',
    repoUrl: 'https://github.com/x/th',
    events: {
      overtakes: [{ date: '2026-06-10', winner: { slug: 'a', name: 'A & B', rank: 1 }, loser: { slug: 'c', name: 'C', rank: 2 } }],
      declines: [{ date: '2026-06-09', slug: 'd', name: 'D', drop_pct: 41, base_date: '2026-05-10' }],
      entrants: [{ date: '2026-06-08', slug: 'e', name: 'E', tokens: 1e9 }],
      digests: [{ date: '2026-06-08' }],
    },
    updated: '2026-06-10T00:00:00Z',
  });
  assert.ok(xml.startsWith('<?xml'));
  assert.ok(xml.includes('A &amp; B'));
  assert.equal((xml.match(/<entry>/g) || []).length, 4);
  assert.ok(xml.indexOf('overtake-2026-06-10') < xml.indexOf('decline-2026-06-09')); // sorted desc by date
});

test('digestDue fires only on Mondays and only once', () => {
  assert.equal(digestDue('2026-06-15', null), true); // Monday
  assert.equal(digestDue('2026-06-15', '2026-06-15'), false); // already made
  assert.equal(digestDue('2026-06-10', null), false); // Wednesday
});

test('buildDigestMarkdown: gainers, losers, entrants, categories', () => {
  const cur = {
    day: [{ slug: 'a', name: 'A', tokens: 100e9, categories: ['cli-agent'] }],
    week: [
      { slug: 'a', name: 'A', tokens: 700e9, categories: ['cli-agent'] },
      { slug: 'b', name: 'B', tokens: 100e9, categories: ['roleplay'] },
    ],
  };
  const oldWeek = [
    { slug: 'a', name: 'A', tokens: 350e9 },
    { slug: 'b', name: 'B', tokens: 200e9 },
  ];
  const md = buildDigestMarkdown({
    date: '2026-06-15',
    cur,
    oldWeek,
    events: { entrants: [{ date: '2026-06-14', name: 'N', tokens: 2e9 }], overtakes: [], declines: [] },
    indexApps: [],
  });
  assert.ok(md.includes('#1 by weekly tokens: A'));
  assert.ok(md.includes('A: +100%'));
  assert.ok(md.includes('B: -50%'));
  assert.ok(md.includes('New in the top-20'));
  assert.ok(md.includes('cli-agent 88%')); // 700/800
  assert.ok(md.includes('Source: OpenRouter'));
});

test('lastDays filters events to the window', () => {
  const evs = [{ date: '2026-06-01' }, { date: '2026-06-09' }];
  assert.equal(lastDays(evs, '2026-06-10', 7).length, 1);
});

console.log('models layer:');
import { buildTrends, normalizeFrontendModels, normalizeOfficialModels, normSlug } from './lib/models.mjs';
import { APPS_URLS, MODELS_URLS } from './lib/endpoints.mjs';

test('normSlug strips :free and date suffixes', () => {
  assert.equal(normSlug('qwen/qwen3.7-plus-20260602'), 'qwen/qwen3.7-plus');
  assert.equal(normSlug('stepfun/step-3.5-flash:free'), 'stepfun/step-3.5-flash');
});

test('frontend models feed normalized (variants summed per date)', () => {
  const feed = { data: [
    { date: '2026-06-09 00:00:00', model_permaslug: 'a/x', variant: 'standard',
      total_prompt_tokens: 100, total_completion_tokens: 50 },
    { date: '2026-06-09 00:00:00', model_permaslug: 'a/x', variant: 'free',
      total_prompt_tokens: 10, total_completion_tokens: 5 },
    { date: '2026-06-08 00:00:00', model_permaslug: 'b/y', variant: 'standard',
      total_prompt_tokens: 7, total_completion_tokens: 3 },
  ]};
  const out = normalizeFrontendModels(feed);
  assert.equal(out['2026-06-09']['a/x'], 165);
  assert.equal(out['2026-06-08']['b/y'], 10);
  assert.throws(() => normalizeFrontendModels({ data: [{}] }), /no valid rows/);
});

test('official dataset normalized, `other` skipped', () => {
  const out = normalizeOfficialModels({ data: [
    { date: '2026-05-01', model_permaslug: 'a/x', total_tokens: '123' },
    { date: '2026-05-01', model_permaslug: 'other', total_tokens: '999' },
  ]});
  assert.deepEqual(out, { '2026-05-01': { 'a/x': 123 } });
});

test('trends: warming_up below 35 days, pct/risers/fallers after', () => {
  const mk = (days, slugVal) => {
    const d = {};
    for (let i = 0; i < days; i++) {
      const date = new Date(Date.parse('2026-05-01') + i * 86400_000).toISOString().slice(0, 10);
      d[date] = slugVal(i);
    }
    return d;
  };
  const warm = buildTrends(mk(5, () => ({ 'a/x': 2e9 })), 'now');
  assert.equal(warm.warming_up, true);
  assert.equal(warm.models['a/x'].pct_4w, null);

  const full = buildTrends(mk(40, (i) => ({
    'falls/hard': i < 20 ? 10e9 : 3e9,
    'rises/fast': i < 20 ? 2e9 : 8e9,
  })), 'now');
  assert.equal(full.warming_up, false);
  assert.ok(full.models['falls/hard'].pct_4w < -60);
  assert.ok(full.models['rises/fast'].pct_4w > 200);
  assert.equal(full.fallers[0].slug, 'falls/hard');
  assert.equal(full.risers[0].slug, 'rises/fast');
});

test('rankings endpoints: versioned candidate first, legacy kept as fallback', () => {
  // OpenRouter moved /api/frontend/rankings/* to /api/frontend/v1/rankings/*
  // and the collector went quiet for two months. Order matters: the live one
  // must be tried first, and the old one must stay as a fallback.
  assert.ok(APPS_URLS.length >= 2 && MODELS_URLS.length >= 2);
  assert.ok(APPS_URLS[0].includes('/frontend/v1/rankings/apps'), APPS_URLS[0]);
  assert.ok(MODELS_URLS[0].includes('/frontend/v1/rankings/models'), MODELS_URLS[0]);
  assert.ok(APPS_URLS.some((u) => !u.includes('/v1/')));
});

console.log(`\nAll ${passed} tests passed.`);
