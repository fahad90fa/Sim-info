/**
 * Upstream lookup client + cache orchestration.
 *
 * `lookupNumber(number)` returns a normalised result:
 *   { status: 'ok', number, names: string[], images: string[], results: [...],
 *     cached: boolean, fetchedAt: ISO string }
 * or throws a LookupError (with a `code`) when the upstream call fails.
 */
import { config } from '../config.js';
import { logger } from './logger.js';
import { MOCK_RESULTS } from './mockData.js';

export class LookupError extends Error {
  constructor(message, code = 'lookup_failed', status = 502) {
    super(message);
    this.name = 'LookupError';
    this.code = code;
    this.status = status;
  }
}

const uniqueStrings = (values) => {
  const seen = new Set();
  const out = [];
  for (const value of values ?? []) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
};

const isSafeImageUrl = (url) => /^https?:\/\/\S+$/i.test(url);

/** Turn the raw upstream payload into our stable shape. Throws on garbage. */
export function normalizeUpstream(number, payload) {
  if (!payload || typeof payload !== 'object') {
    throw new LookupError('Upstream returned an invalid response.', 'invalid_response');
  }
  const rawResults = Array.isArray(payload.results) ? payload.results : [];
  const results = rawResults
    .filter((r) => r && typeof r === 'object')
    .map((r) => ({
      number: typeof r.number === 'string' || typeof r.number === 'number' ? String(r.number) : number,
      names: uniqueStrings(r.names),
      images: uniqueStrings(r.images).filter(isSafeImageUrl),
    }));

  return {
    status: 'ok',
    number,
    upstreamStatus: typeof payload.status === 'string' ? payload.status : String(payload.status ?? ''),
    names: uniqueStrings(results.flatMap((r) => r.names)),
    images: uniqueStrings(results.flatMap((r) => r.images)),
    results,
    fetchedAt: new Date().toISOString(),
  };
}

async function fetchUpstream(number) {
  if (config.lookup.mock) {
    await new Promise((r) => setTimeout(r, 150));
    return MOCK_RESULTS[number] ?? { status: 'success', results: [] };
  }

  const url = new URL(config.lookup.apiUrl);
  url.searchParams.set('num', number);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.lookup.timeoutMs);
  let response;
  try {
    response = await fetch(url, {
      signal: controller.signal,
      headers: { accept: 'application/json', 'user-agent': 'sim-info/1.0 (+lookup proxy)' },
    });
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new LookupError('The lookup service timed out. Please try again.', 'timeout', 504);
    }
    throw new LookupError('Could not reach the lookup service.', 'network', 502);
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 429) {
    throw new LookupError('The lookup service is busy. Please try again shortly.', 'upstream_rate_limited', 503);
  }
  if (!response.ok) {
    throw new LookupError(`The lookup service returned an error (${response.status}).`, 'upstream_error', 502);
  }

  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new LookupError('The lookup service returned an unreadable response.', 'invalid_response', 502);
  }
}

// De-duplicate concurrent lookups for the same number so a burst of identical
// requests results in a single upstream call.
const inFlight = new Map();

/**
 * Look a number up, serving from cache when possible.
 * @param {string} number normalised digits-only number
 * @param {{ get(k): Promise<any>, set(k, v): Promise<void> }} cache
 * @param {{ forceRefresh?: boolean }} [options]
 */
export async function lookupNumber(number, cache, options = {}) {
  if (!options.forceRefresh) {
    const cached = await cache.get(number).catch((err) => {
      logger.warn('cache_get_failed', { message: err.message });
      return null;
    });
    if (cached) return { ...cached, cached: true };
  }

  if (inFlight.has(number)) return inFlight.get(number);

  const task = (async () => {
    const started = Date.now();
    const payload = await fetchUpstream(number);
    const result = normalizeUpstream(number, payload);
    await cache.set(number, result).catch((err) => logger.warn('cache_set_failed', { message: err.message }));
    logger.info('upstream_lookup', { number, ms: Date.now() - started, names: result.names.length, images: result.images.length });
    return { ...result, cached: false };
  })();

  inFlight.set(number, task);
  try {
    return await task;
  } finally {
    inFlight.delete(number);
  }
}
