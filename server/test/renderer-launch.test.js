/**
 * Browser lifecycle under launch failures and shutdown races, driven through
 * a flaky Chromium test double. Runs only with TEST_IMAGE=1 (needs a real
 * Chromium behind the double). Lives in its own file because
 * PUPPETEER_EXECUTABLE_PATH is read once at import time.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const withChromium = process.env.TEST_IMAGE === '1';
const realChromium = ['/opt/pw-browsers/chromium', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'].find((p) =>
  fs.existsSync(p),
);
const enabled = withChromium && Boolean(realChromium);
const skip = !enabled && (withChromium ? 'no Chromium binary found' : 'set TEST_IMAGE=1 to run');

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'sim-info-launch-'));
process.env.LOOKUP_MOCK = 'true';
process.env.IMAGE_RENDER_CONCURRENCY = '3';
process.env.IMAGE_CACHE_DIR = path.join(scratch, 'cache');
process.env.IMAGE_CACHE_MAX_FILES = '3';
process.env.FLAKY_LOG = path.join(scratch, 'launches.log');
process.env.FLAKY_REAL_CHROMIUM = realChromium ?? '/bin/false';
process.env.FLAKY_FAIL_FIRST = '1';
process.env.PUPPETEER_EXECUTABLE_PATH = path.join(here, 'fixtures', 'flaky-chromium.sh');

const renderer = await import('../src/lib/imageRenderer.js');
const html = '<html><body><p style="font-size:40px">hello</p></body></html>';
const launchAttempts = () => (fs.existsSync(process.env.FLAKY_LOG) ? fs.readFileSync(process.env.FLAKY_LOG, 'utf8').trim().split('\n').filter(Boolean).length : 0);

after(async () => {
  await renderer.closeBrowser();
  fs.rmSync(scratch, { recursive: true, force: true });
});

test('a failed launch rejects every waiting render once and spawns exactly one process', { skip }, async () => {
  const results = await Promise.allSettled([1, 2, 3].map(() => renderer.renderHtmlToPng(html)));
  assert.deepEqual(results.map((r) => r.status), ['rejected', 'rejected', 'rejected']);
  for (const r of results) assert.match(r.reason.message, /Failed to launch/);
  assert.equal(launchAttempts(), 1, 'the three waiters must not each start a launch');
  assert.equal(renderer.stats.launches, 0);

  // The next render simply launches again (the double now succeeds).
  const png = await renderer.renderHtmlToPng(html);
  assert.equal(png.toString('hex', 0, 8), '89504e470d0a1a0a');
  assert.equal(launchAttempts(), 2);
  assert.equal(renderer.stats.launches, 1);
});

test('closeBrowser() during a launch leaves no untracked browser behind', { skip }, async () => {
  await renderer.closeBrowser();
  const racing = renderer.getBrowser(); // launch in progress
  await new Promise((resolve) => setTimeout(resolve, 50));
  await renderer.closeBrowser();
  // The cancelled launch is closed by its own tail; the racing caller then
  // either gets the replacement (getBrowser relaunches after a cancellation)
  // or an error - but never an untracked browser.
  const raced = await racing.catch(() => null);
  const b1 = await renderer.getBrowser();
  assert.equal(b1.connected, true);
  if (raced) assert.equal(raced, b1, 'a browser handed out after the race must be the tracked one');
  assert.equal(renderer.stats.launches, 2, 'one launch before the race, one tracked launch after it');
  const pid = b1.process()?.pid;
  const before = renderer.stats.launches;
  process.kill(pid, 'SIGKILL');
  await new Promise((resolve) => setTimeout(resolve, 300));
  const b2 = await renderer.getBrowser();
  assert.equal(b2.connected, true);
  assert.notEqual(b2.process()?.pid, pid);
  assert.equal(renderer.stats.launches, before + 1);
});

test('stale temp files are swept even when the cap is disabled', async () => {
  const dir = path.join(scratch, 'nocap');
  fs.mkdirSync(dir, { recursive: true });
  const stale = path.join(dir, '1111.png.42.tmp');
  fs.writeFileSync(stale, 'x');
  const old = new Date(Date.now() - 10 * 60 * 1000);
  fs.utimesSync(stale, old, old);
  const { config } = await import('../src/config.js');
  const saved = { dir: config.paths.imageCacheDir, max: config.cache.imageMaxFiles };
  config.paths.imageCacheDir = dir;
  config.cache.imageMaxFiles = 0;
  try {
    for (let i = 0; i < 4; i += 1) await renderer.storeImage(`0300000010${i}`, Buffer.from(`png-${i}`));
    await renderer.pruneDiskCache();
    const names = fs.readdirSync(dir);
    assert.equal(names.filter((n) => n.endsWith('.png')).length, 4, 'no cap: nothing evicted');
    assert.ok(!names.includes('1111.png.42.tmp'), 'stale temp file swept');
  } finally {
    config.paths.imageCacheDir = saved.dir;
    config.cache.imageMaxFiles = saved.max;
  }
});

test('the disk cache honours its file cap and sweeps stale temp files', async () => {
  const dir = process.env.IMAGE_CACHE_DIR;
  fs.mkdirSync(dir, { recursive: true });
  const stale = path.join(dir, '0000.png.999.tmp');
  fs.writeFileSync(stale, 'x');
  const old = new Date(Date.now() - 10 * 60 * 1000);
  fs.utimesSync(stale, old, old);
  for (let i = 0; i < 6; i += 1) {
    await renderer.storeImage(`0300000000${i}`, Buffer.from(`png-${i}`));
  }
  await renderer.pruneDiskCache();
  const names = fs.readdirSync(dir).sort();
  assert.equal(names.filter((n) => n.endsWith('.png')).length, 3, names.join(','));
  assert.ok(!names.includes('0000.png.999.tmp'), 'stale temp file should be swept');
  assert.ok(names.includes('03000000005.png'), 'the newest files are kept');
});
