export class ApiError extends Error {
  constructor(message, { code = 'unknown', status = 0, retryAfter = null } = {}) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

/**
 * Call the backend lookup proxy. Resolves with the normalised result object or
 * rejects with an ApiError carrying a user-friendly message.
 */
export async function lookupNumber(number, { signal } = {}) {
  let response;
  try {
    response = await fetch(`/api/lookup?number=${encodeURIComponent(number)}`, {
      headers: { accept: 'application/json' },
      signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new ApiError('Network error. Check your connection and try again.', { code: 'network' });
  }

  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (response.status === 429) {
    const retryAfter = Number.parseInt(response.headers.get('retry-after') ?? '', 10) || null;
    throw new ApiError(
      body?.message || 'You are searching too quickly. Please wait a minute and try again.',
      { code: 'rate_limited', status: 429, retryAfter },
    );
  }
  if (!response.ok || !body || body.status !== 'ok') {
    throw new ApiError(body?.message || 'Lookup failed. Please try again later.', {
      code: body?.code || 'lookup_failed',
      status: response.status,
    });
  }
  return body;
}
