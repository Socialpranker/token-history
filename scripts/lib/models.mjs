// Models layer: world model-usage trends that power `agentburn drift`.
//
// Two sources, merged (official wins on overlapping dates):
// 1. No-key frontend feed GET /api/frontend/rankings/models — rows
//    { date: "YYYY-MM-DD hh:mm:ss", model_permaslug, variant,
//      total_prompt_tokens, total_completion_tokens, … } covering the last
//    couple of days. Archived daily → history accumulates from day one.
// 2. Optional official dataset GET /api/v1/datasets/rankings-daily
//    (env OPENROUTER_API_KEY) — top-50 models/day back to 2025-01-01:
//    rows { date, model_permaslug, total_tokens }. Instant deep history.
//
// Output: data/models/daily/<date>.json  ({ permaslug: tokens })
//         data/models/trends.json        (see buildTrends)

const DATE_SUFFIX = /[-:]\d{8}$|[-:]\d{4}$|[-:]20\d{2}-?\d{2}-?\d{2}$/;

export function normSlug(slug) {
  let s = String(slug || "").trim().toLowerCase();
  s = s.split(":free")[0];
  s = s.replace(DATE_SUFFIX, "");
  return s;
}

/** frontend feed rows → { "YYYY-MM-DD": { permaslug: tokens } } */
export function normalizeFrontendModels(json) {
  const rows = Array.isArray(json) ? json : json?.data;
  if (!Array.isArray(rows)) {
    throw new Error("models feed: unrecognized shape (no rows array)");
  }
  const out = {};
  let ok = 0;
  for (const r of rows) {
    const slug = r?.model_permaslug;
    const date = String(r?.date || "").slice(0, 10);
    if (!slug || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const tokens =
      Number(r.total_prompt_tokens || 0) + Number(r.total_completion_tokens || 0);
    if (!Number.isFinite(tokens) || tokens <= 0) continue;
    (out[date] ??= {});
    out[date][slug] = (out[date][slug] || 0) + tokens; // sum variants
    ok++;
  }
  if (ok === 0) throw new Error("models feed: no valid rows — shape changed?");
  return out;
}

/** official dataset rows → same shape (skips the aggregated `other` row) */
export function normalizeOfficialModels(json) {
  const rows = json?.data;
  if (!Array.isArray(rows)) throw new Error("official dataset: no data array");
  const out = {};
  for (const r of rows) {
    const slug = r?.model_permaslug;
    const date = String(r?.date || "").slice(0, 10);
    if (!slug || slug === "other" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const tokens = Number(r.total_tokens);
    if (!Number.isFinite(tokens) || tokens <= 0) continue;
    (out[date] ??= {});
    out[date][slug] = (out[date][slug] || 0) + tokens;
  }
  return out;
}

function sumWindow(series, dates) {
  let s = 0;
  let n = 0;
  for (const d of dates) {
    if (series[d] != null) {
      s += series[d];
      n++;
    }
  }
  return n > 0 ? s : null;
}

/**
 * daily maps ({date → {slug → tokens}}) → trends.json payload.
 * pct_4w compares the most recent 7 covered days against the 7-day window
 * four weeks earlier; null until enough history exists (warming_up).
 */
export function buildTrends(daily, asOf) {
  const dates = Object.keys(daily).sort();
  const bySlug = {};
  for (const d of dates) {
    for (const [slug, tokens] of Object.entries(daily[d])) {
      (bySlug[slug] ??= {})[d] = tokens;
    }
  }
  const last7 = dates.slice(-7);
  const prev4w = dates.slice(-35, -28); // the 7-day window ~4 weeks back
  const enough = dates.length >= 35;

  const models = {};
  for (const [slug, series] of Object.entries(bySlug)) {
    const t7 = sumWindow(series, last7);
    const t7p = enough ? sumWindow(series, prev4w) : null;
    const pct =
      t7 != null && t7p != null && t7p > 0
        ? Math.round(((t7 - t7p) / t7p) * 1000) / 10
        : null;
    models[slug] = {
      t7,
      pct_4w: pct,
      last: series[dates[dates.length - 1]] ?? null,
      days: Object.keys(series).length,
    };
  }
  const ranked = Object.entries(models).filter(([, m]) => m.pct_4w != null && (m.t7 || 0) > 1e9);
  const risers = ranked
    .sort((a, b) => b[1].pct_4w - a[1].pct_4w)
    .slice(0, 10)
    .map(([slug, m]) => ({ slug, pct_4w: m.pct_4w, t7: m.t7 }));
  const fallers = ranked
    .sort((a, b) => a[1].pct_4w - b[1].pct_4w)
    .slice(0, 10)
    .map(([slug, m]) => ({ slug, pct_4w: m.pct_4w, t7: m.t7 }));

  return {
    as_of: asOf,
    days_covered: dates.length,
    first_date: dates[0] ?? null,
    last_date: dates[dates.length - 1] ?? null,
    warming_up: !enough,
    citation: "Source: OpenRouter (openrouter.ai/rankings).",
    note:
      "World usage = tokens routed through OpenRouter; provider tokenizers differ; trends, not absolutes.",
    models,
    risers,
    fallers,
  };
}
