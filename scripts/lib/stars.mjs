// GitHub star snapshots for apps mapped in repos.json (slug → "owner/repo").
// Stars are an ENHANCEMENT layer: any failure here is logged and skipped,
// never fatal — the token archive must not depend on the GitHub API.
// (Forward snapshots only; retroactive curves are possible later via
// stargazer-page sampling, which is why this layer is not time-critical.)

export async function fetchStarsMap(repos, { token, userAgent } = {}) {
  const out = {};
  const entries = Object.entries(repos || {});
  for (const [slug, repo] of entries) {
    if (!/^[\w.-]+\/[\w.-]+$/.test(String(repo))) {
      console.warn(`[stars] skip ${slug}: bad repo spec "${repo}"`);
      continue;
    }
    try {
      const res = await fetch(`https://api.github.com/repos/${repo}`, {
        headers: {
          accept: 'application/vnd.github+json',
          'user-agent': userAgent || 'token-history-bot',
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
      });
      if (!res.ok) {
        console.warn(`[stars] skip ${slug}: ${repo} → HTTP ${res.status}`);
        continue;
      }
      const j = await res.json();
      if (Number.isFinite(j.stargazers_count)) out[slug] = j.stargazers_count;
    } catch (err) {
      console.warn(`[stars] skip ${slug}: ${err.message}`);
    }
  }
  return out;
}
