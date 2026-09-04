/**
 * Guards the serverless entrypoint contract: Vercel's Node launcher imports the
 * module, unwraps `default`, and requires a function export (an Express app is
 * one) - otherwise the function fails with "Can't detect way to handle request".
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.LOOKUP_MOCK = 'true';

test('server/src/app.js default-exports an Express app', async () => {
  const mod = await import('../src/app.js');
  assert.equal(typeof mod.default, 'function');
  assert.equal(typeof mod.default.listen, 'function', 'should be an Express app, not a plain handler');
  assert.equal(typeof mod.createApp, 'function');
});

test('api/index.js re-exports the same app for the repo-root layout', async () => {
  const api = await import('../../api/index.js');
  const app = (await import('../src/app.js')).default;
  assert.equal(api.default, app);
});

test('the default app answers requests without any prior async setup', async () => {
  const app = (await import('../src/app.js')).default;
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    const { port } = server.address();
    const res = await fetch(`http://127.0.0.1:${port}/api/lookup?number=03320407479`);
    assert.equal(res.status, 200);
    assert.equal((await res.json()).names.length, 4);
    const page = await fetch(`http://127.0.0.1:${port}/print/03320407479`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Fahad Jojo/);
  } finally {
    server.close();
  }
});
