// Flat-file store: everything lives as JSON inside the git repo.
// data/apps/YYYY-MM-DD.json   — full daily snapshot (all ranking windows)
// data/series/<slug>.json     — per-app time series, points (fixed 7 slots):
//                               [date, day_tokens, day_rank, day_requests,
//                                stars, week_tokens, week_rank]
// data/index.json             — latest ranking + app list for the site
// data/latest.json            — pointer to the newest snapshot
// data/overtakes.json         — cumulative overtake events
// data/declines.json          — cumulative decline events
// badges/<slug>.json          — shields.io endpoint JSON per app

import fs from 'node:fs';
import path from 'node:path';
import { slugify, shortHash, humanizeTokens } from './util.mjs';

export class Store {
  constructor(root) {
    this.root = root;
    this.dataDir = path.join(root, 'data');
    this.appsDir = path.join(this.dataDir, 'apps');
    this.seriesDir = path.join(this.dataDir, 'series');
    this.badgesDir = path.join(root, 'badges');
    for (const d of [this.dataDir, this.appsDir, this.seriesDir, this.badgesDir]) {
      fs.mkdirSync(d, { recursive: true });
    }
  }

  #read(file, fallback = null) {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      return fallback;
    }
  }

  #write(file, obj) {
    fs.writeFileSync(file, JSON.stringify(obj, null, 1) + '\n');
  }

  /** slug, stable per (name,url); suffix on collision with a different url */
  resolveSlug(name, url, preferred = null) {
    let slug = preferred && /^[a-z0-9-]+$/.test(preferred) ? preferred : slugify(name);
    const file = path.join(this.seriesDir, slug + '.json');
    const existing = this.#read(file);
    if (existing && existing.url && url && existing.url !== url) {
      slug = `${slug}-${shortHash(url)}`;
    }
    return slug;
  }

  snapshotDates() {
    try {
      return fs
        .readdirSync(this.appsDir)
        .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
        .map((f) => f.slice(0, 10))
        .sort();
    } catch {
      return [];
    }
  }

  readSnapshot(date) {
    return this.#read(path.join(this.appsDir, date + '.json'));
  }

  /** Most recent snapshot strictly before `date` (for overtake detection). */
  readPrevSnapshot(date) {
    const prevDate = this.snapshotDates().filter((d) => d < date).pop();
    return prevDate ? this.readSnapshot(prevDate) : null;
  }

  readSeries(slug) {
    return this.#read(path.join(this.seriesDir, slug + '.json'));
  }

  writeSnapshot(date, meta, windows) {
    this.#write(path.join(this.appsDir, date + '.json'), { meta, windows });
  }

  /** Append/replace the point for `date` in every app's series. Idempotent. */
  updateSeries(date, apps) {
    for (const app of apps) {
      const slug = app.slug;
      const file = path.join(this.seriesDir, slug + '.json');
      const series = this.#read(file, { slug, name: app.name, url: app.url, points: [] });
      series.name = app.name;
      series.url = app.url ?? series.url;
      const point = [
        date,
        app.tokens ?? null,
        app.rank ?? null,
        app.requests ?? null,
        app.stars ?? null,
        app.week_tokens ?? null,
        app.week_rank ?? null,
      ];
      const i = series.points.findIndex((p) => p[0] === date);
      if (i >= 0) series.points[i] = point;
      else series.points.push(point);
      series.points.sort((a, b) => (a[0] < b[0] ? -1 : 1));
      this.#write(file, series);
    }
  }

  writeIndex(date, meta, apps) {
    this.#write(path.join(this.dataDir, 'index.json'), {
      updated: meta.fetched_at,
      date,
      window: meta.window,
      citation: meta.citation,
      apps: apps.map((a) => ({
        slug: a.slug,
        name: a.name,
        url: a.url,
        rank: a.rank,
        tokens: a.tokens,
        tokens_display: humanizeTokens(a.tokens),
        requests: a.requests,
        tokens_per_request:
          a.requests > 0 && Number.isFinite(a.tokens) ? Math.round(a.tokens / a.requests) : null,
        stars: a.stars ?? null,
        repo: a.repo ?? null,
        week_tokens: a.week_tokens ?? null,
        week_rank: a.week_rank ?? null,
        momentum:
          a.week_tokens > 0 && Number.isFinite(a.tokens)
            ? Number(((a.tokens * 7) / a.week_tokens).toFixed(2))
            : null,
        categories: a.categories,
      })),
    });
  }

  writeLatest(date) {
    this.#write(path.join(this.dataDir, 'latest.json'), {
      date,
      path: `apps/${date}.json`,
    });
  }

  writeBadges(apps) {
    for (const a of apps) {
      this.#write(path.join(this.badgesDir, a.slug + '.json'), {
        schemaVersion: 1,
        label: 'tokens · day',
        message: humanizeTokens(a.tokens),
        color: 'blue',
        cacheSeconds: 3600,
      });
    }
  }

  appendOvertakes(events) {
    this.#appendEvents('overtakes.json', events);
  }

  readDeclines() {
    return this.#read(path.join(this.dataDir, 'declines.json'), []);
  }

  appendDeclines(events) {
    this.#appendEvents('declines.json', events);
  }

  #appendEvents(name, events) {
    const file = path.join(this.dataDir, name);
    const all = this.#read(file, []);
    all.push(...events);
    this.#write(file, all.slice(-500)); // keep the file bounded
  }

  /** generic data/<name>.json accessors (entrants, digests, misc state) */
  readData(name, fallback = null) {
    return this.#read(path.join(this.dataDir, name + '.json'), fallback);
  }

  writeData(name, obj) {
    this.#write(path.join(this.dataDir, name + '.json'), obj);
  }

  appendData(name, events) {
    this.#appendEvents(name + '.json', events);
  }

  readOvertakes() {
    return this.#read(path.join(this.dataDir, 'overtakes.json'), []);
  }

  listSeriesSlugs() {
    try {
      return fs
        .readdirSync(this.seriesDir)
        .filter((f) => f.endsWith('.json'))
        .map((f) => f.slice(0, -5));
    } catch {
      return [];
    }
  }
}
