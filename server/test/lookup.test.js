import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.LOOKUP_MOCK = 'true';
const { normalizeUpstream, lookupNumber, LookupError } = await import('../src/lib/lookup.js');

const fakeCache = () => {
  const store = new Map();
  return {
    kind: 'fake',
    sets: 0,
    async get(k) { return store.get(k) ?? null; },
    async set(k, v) { this.sets += 1; store.set(k, v); },
    async del(k) { store.delete(k); },
    async close() {},
  };
};

test('normalizeUpstream flattens, de-duplicates and filters unsafe image urls', () => {
  const out = normalizeUpstream('03320407479', {
    status: 'success',
    results: [
      { number: '03320407479', names: ['A', ' A ', 'B', 42, ''], images: ['https://x/1.png', 'javascript:alert(1)', 'https://x/1.png'] },
      { number: '03320407479', names: ['C'], images: ['http://y/2.jpg'] },
      null,
    ],
  });
  assert.equal(out.status, 'ok');
  assert.deepEqual(out.names, ['A', 'B', 'C']);
  assert.deepEqual(out.images, ['https://x/1.png', 'http://y/2.jpg']);
  assert.equal(out.results.length, 2);
  assert.ok(out.fetchedAt);
});

test('normalizeUpstream tolerates a missing results array', () => {
  const out = normalizeUpstream('1234567', { status: 'error' });
  assert.deepEqual(out.names, []);
  assert.deepEqual(out.images, []);
});

test('normalizeUpstream rejects non-object payloads', () => {
  assert.throws(() => normalizeUpstream('1234567', 'nope'), LookupError);
});

test('lookupNumber caches results and de-duplicates concurrent calls', async () => {
  const cache = fakeCache();
  const [a, b] = await Promise.all([lookupNumber('03320407479', cache), lookupNumber('03320407479', cache)]);
  assert.equal(a.cached, false);
  assert.equal(b.cached, false);
  assert.equal(cache.sets, 1, 'concurrent lookups should hit upstream once');
  assert.deepEqual(a.names, ['Fahad Jojo', 'Fahad Jojo Pgc', 'Fahad ☠️', 'Fahad colony']);

  const c = await lookupNumber('03320407479', cache);
  assert.equal(c.cached, true);
  assert.equal(cache.sets, 1);
});
