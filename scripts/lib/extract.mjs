// Extraction of the apps ranking from openrouter.ai/rankings HTML.
//
// The page is a Next.js app: data is embedded in the HTML as RSC flight
// payload chunks pushed via `self.__next_f.push([1,"…"])`. No JS execution
// is needed — we decode the string chunks, join them and look for the
// `"apps":[…]` array (fallback: any array of objects that look like app
// ranking rows). This targets the structured payload, not the visual DOM,
// so it survives layout redesigns; it breaks only if OpenRouter changes
// the data shape — in which case we throw loudly (the workflow goes red
// instead of silently archiving garbage).

/** Decode all __next_f string chunks and join them into one big string. */
export function decodeNextFChunks(html) {
  const re = /self\.__next_f\.push\(\[1,\s*"((?:[^"\\]|\\.)*)"\s*\]\)/g;
  const parts = [];
  let m;
  while ((m = re.exec(html)) !== null) {
    try {
      parts.push(JSON.parse('"' + m[1] + '"'));
    } catch {
      // malformed chunk — skip, the rest may still contain what we need
    }
  }
  return parts.join('');
}

/**
 * Scan a balanced JSON value ([{…}] / {…}) starting at `start`.
 * Returns the index of the closing bracket, or -1.
 */
function scanBalanced(text, start) {
  const open = text[start];
  if (open !== '[' && open !== '{') return -1;
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === '\\') i++;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === '[' || c === '{') depth++;
    else if (c === ']' || c === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function looksLikeApp(item) {
  return (
    item &&
    typeof item === 'object' &&
    typeof item.name === 'string' &&
    item.name.length > 0 &&
    Number.isFinite(Number(item.tokens))
  );
}

function isValidAppsArray(arr) {
  if (!Array.isArray(arr) || arr.length < 5) return false;
  const ok = arr.filter(looksLikeApp).length;
  return ok >= Math.ceil(arr.length * 0.8);
}

/** Find every parseable `"apps":[…]` array in `text`. */
export function extractAppsArrays(text) {
  const found = [];
  let idx = 0;
  const KEY = '"apps":';
  while ((idx = text.indexOf(KEY, idx)) !== -1) {
    let j = idx + KEY.length;
    while (j < text.length && /\s/.test(text[j])) j++;
    if (text[j] === '[') {
      const end = scanBalanced(text, j);
      if (end > 0) {
        try {
          const arr = JSON.parse(text.slice(j, end + 1));
          if (isValidAppsArray(arr)) found.push(arr);
        } catch {
          /* not valid JSON here — keep looking */
        }
      }
    }
    idx += KEY.length;
  }
  return found;
}

/** Fallback: harvest standalone objects that look like app ranking rows. */
export function fallbackScanApps(text) {
  const out = new Map(); // name -> item (keep the one with max tokens)
  let idx = 0;
  const KEY = '{"rank":';
  while ((idx = text.indexOf(KEY, idx)) !== -1) {
    const end = scanBalanced(text, idx);
    if (end > 0 && end - idx < 4000) {
      try {
        const obj = JSON.parse(text.slice(idx, end + 1));
        if (
          looksLikeApp(obj) &&
          obj.requests !== undefined &&
          obj.model_id === undefined // exclude model rows, which also have rank+tokens
        ) {
          const prev = out.get(obj.name);
          if (!prev || Number(obj.tokens) > Number(prev.tokens)) out.set(obj.name, obj);
        }
      } catch {
        /* skip */
      }
    }
    idx += KEY.length;
  }
  return [...out.values()].sort((a, b) => Number(a.rank) - Number(b.rank));
}

function coerceApp(item, i) {
  return {
    rank: Number.isFinite(Number(item.rank)) ? Number(item.rank) : i + 1,
    name: String(item.name).trim(),
    url: typeof item.url === 'string' ? item.url : null,
    description: typeof item.description === 'string' ? item.description : null,
    categories: Array.isArray(item.categories) ? item.categories : [],
    tokens: Number(item.tokens),
    requests: Number.isFinite(Number(item.requests)) ? Number(item.requests) : null,
  };
}

/**
 * Main entry: HTML of openrouter.ai/rankings → { apps, via }.
 * Throws (loudly, with diagnostics) when nothing extractable is found.
 */
export function extractApps(html) {
  const decoded = decodeNextFChunks(html);
  for (const [via, text] of [
    ['next_f/apps-key', decoded],
    ['raw-html/apps-key', html],
  ]) {
    const arrays = extractAppsArrays(text);
    if (arrays.length > 0) {
      const best = arrays.reduce((a, b) => (b.length > a.length ? b : a));
      return { apps: best.filter(looksLikeApp).map(coerceApp), via };
    }
  }
  for (const [via, text] of [
    ['next_f/fallback-objects', decoded],
    ['raw-html/fallback-objects', html],
  ]) {
    const objs = fallbackScanApps(text);
    if (objs.length >= 5) return { apps: objs.map(coerceApp), via };
  }
  throw new Error(
    `extractApps: no apps ranking found (html: ${html.length} chars, decoded payload: ${decoded.length} chars). ` +
      'OpenRouter likely changed the embedded data shape — inspect the page and update scripts/lib/extract.mjs.'
  );
}
