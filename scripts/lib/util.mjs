/** Shared helpers: slugs, number formatting, tiny hash. */

export function slugify(name) {
  const s = String(name)
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s || 'app';
}

/** 894267675606 → "894B", 1631041198302 → "1.63T", 7021170891 → "7.02B" */
export function humanizeTokens(n) {
  if (!Number.isFinite(n)) return '–';
  const units = [
    ['T', 1e12],
    ['B', 1e9],
    ['M', 1e6],
    ['K', 1e3],
  ];
  for (const [suffix, div] of units) {
    if (Math.abs(n) >= div) {
      const v = n / div;
      const s = v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2);
      return s.replace(/\.0+$/, '').replace(/(\.\d*[1-9])0+$/, '$1') + suffix;
    }
  }
  return String(n);
}

/** Tiny stable hash for slug collision suffixes. */
export function shortHash(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  return h.toString(36).slice(0, 4);
}

export function todayUTC() {
  return new Date().toISOString().slice(0, 10);
}
