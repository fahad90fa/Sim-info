import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.LOOKUP_MOCK = 'true';
process.env.RATE_LIMIT_MAX = '5';
process.env.RATE_LIMIT_WINDOW_MS = '60000';
process.env.PUBLIC_BASE_URL = 'https://example.test';

const { createApp } = await import('../src/app.js');
const { createCache } = await import('../src/lib/cache.js');

let server;
let base;
let cache;

before(async () => {
  cache = await createCache({ redisUrl: '' });
  const app = createApp({ cache });
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server?.close();
  await cache?.close();
});

test('GET /api/lookup returns a normalised result and cleans the input', async () => {
  const res = await fetch(`${base}/api/lookup?number=${encodeURIComponent('+0332-040 7479')}`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, 'ok');
  assert.equal(body.number, '03320407479');
  assert.equal(body.names.length, 4);
  assert.equal(body.cached, false);

  const again = await (await fetch(`${base}/api/lookup?number=03320407479`)).json();
  assert.equal(again.cached, true);
});

test('GET /api/lookup rejects invalid numbers', async () => {
  const res = await fetch(`${base}/api/lookup?number=12`);
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.status, 'error');
  assert.equal(body.code, 'invalid_number');
});

test('GET /print/:number renders a printable page', async () => {
  const res = await fetch(`${base}/print/03320407479`);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /<link rel="stylesheet" href="\/print\.css">/);
  assert.match(html, /Fahad Jojo/);
  assert.match(html, /0332 0407479/);
  assert.doesNotMatch(html, /print\.js/);

  const auto = await (await fetch(`${base}/print/03320407479?auto=1`)).text();
  assert.match(auto, /print\.js/);
});

test('GET /share/:number includes Open Graph tags pointing at /image', async () => {
  const html = await (await fetch(`${base}/share/03320407479`)).text();
  assert.match(html, /property="og:image" content="https:\/\/example\.test\/image\/03320407479"/);
  assert.match(html, /twitter:card/);
});

test('GET /print.css is served with print rules', async () => {
  const res = await fetch(`${base}/print.css`);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /@media print/);
});

test('invalid numbers on page routes render an error page', async () => {
  const res = await fetch(`${base}/print/12`);
  assert.equal(res.status, 400);
  assert.match(await res.text(), /Invalid number/);
  const img = await fetch(`${base}/image/abc`);
  assert.equal(img.status, 400);
});

test('unknown API routes return JSON 404', async () => {
  const res = await fetch(`${base}/api/nope`);
  assert.equal(res.status, 404);
  assert.equal((await res.json()).code, 'not_found');
});

test('rate limiter blocks after the configured number of requests', async () => {
  // Earlier tests in this file already consumed some of the 5-request budget.
  let last;
  for (let i = 0; i < 6; i += 1) {
    last = await fetch(`${base}/api/lookup?number=03320407479`);
    if (last.status === 429) break;
  }
  assert.equal(last.status, 429);
  const body = await last.json();
  assert.equal(body.code, 'rate_limited');
  assert.ok(last.headers.get('ratelimit') || last.headers.get('ratelimit-limit'));
});
