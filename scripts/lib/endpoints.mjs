// Where the rankings actually live.
//
// OpenRouter versioned its frontend API in place: /api/frontend/rankings/*
// began answering 404 in August 2026 and the same payload moved to
// /api/frontend/v1/rankings/*. The collector had no fallback, so it failed
// every run for two months while nobody was looking.
//
// Candidates are tried in order — the next move costs one line here, and an
// old deployment keeps working until the legacy path finally dies. This module
// is import-safe on purpose (no side effects), so tests can assert the order.

export const APPS_URLS = [
  'https://openrouter.ai/api/frontend/v1/rankings/apps',
  'https://openrouter.ai/api/frontend/rankings/apps',
];

export const MODELS_URLS = [
  'https://openrouter.ai/api/frontend/v1/rankings/models',
  'https://openrouter.ai/api/frontend/rankings/models',
];

export const PAGE_URL = 'https://openrouter.ai/rankings';
