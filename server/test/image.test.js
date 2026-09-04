/**
 * End-to-end check of the Puppeteer card renderer. Needs a Chromium binary,
 * so it only runs when TEST_IMAGE=1 (e.g. `TEST_IMAGE=1 npm test`).
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const enabled = process.env.TEST_IMAGE === '1';

process.env.LOOKUP_MOCK = 'true';
process.env.IMAGE_CACHE_DIR = await fs.mkdtemp(path.join(os.tmpdir(), 'sim-info-img-'));

const { createApp } = await import('../src/app.js');
const { createCache } = await import('../src/lib/cache.js');
const { closeBrowser } = await import('../src/lib/imageRenderer.js');

let server;
let base;
let cache;

before(async () => {
  if (!enabled) return;
  cache = await createCache({ redisUrl: '' });
  await new Promise((resolve) => {
    server = createApp({ cache }).listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server?.close();
  await closeBrowser();
  await cache?.close();
  await fs.rm(process.env.IMAGE_CACHE_DIR, { recursive: true, force: true });
});

test('GET /image/:number renders a 1200x630 PNG and caches it', { skip: !enabled && 'set TEST_IMAGE=1 to run' }, async () => {
  const first = await fetch(`${base}/image/03320407479`);
  assert.equal(first.status, 200);
  assert.equal(first.headers.get('content-type'), 'image/png');
  assert.equal(first.headers.get('x-image-cache'), 'miss');
  const png = Buffer.from(await first.arrayBuffer());
  // PNG signature + IHDR width/height
  assert.equal(png.toString('hex', 0, 8), '89504e470d0a1a0a');
  assert.equal(png.readUInt32BE(16), 1200);
  assert.equal(png.readUInt32BE(20), 630);

  const second = await fetch(`${base}/image/03320407479`);
  assert.equal(second.headers.get('x-image-cache'), 'hit');

  const download = await fetch(`${base}/image/03320407479?download=1`);
  assert.match(download.headers.get('content-disposition'), /attachment; filename="sim-info-03320407479\.png"/);
});
