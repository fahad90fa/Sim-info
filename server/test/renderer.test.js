/**
 * Renderer guards. The crash-recovery test needs a real Chromium and only
 * runs with TEST_IMAGE=1; the artifact-list test needs @sparticuz/chromium
 * (an optional dependency) and skips when it is not installed.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';

process.env.LOOKUP_MOCK = 'true';
process.env.IMAGE_RENDER_CONCURRENCY = '3';
process.env.IMAGE_CACHE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sim-info-render-'));

const renderer = await import('../src/lib/imageRenderer.js');
const withChromium = process.env.TEST_IMAGE === '1';

after(async () => {
  await renderer.closeBrowser();
  fs.rmSync(process.env.IMAGE_CACHE_DIR, { recursive: true, force: true });
});

/** Top-level names a tar archive extracts (POSIX ustar headers, 512-byte blocks). */
function tarTopLevelNames(buffer) {
  const names = new Set();
  let offset = 0;
  while (offset + 512 <= buffer.length) {
    const name = buffer.toString('utf8', offset, offset + 100).replace(/\0.*$/s, '');
    if (!name) break;
    const size = Number.parseInt(buffer.toString('utf8', offset + 124, offset + 136).replace(/\0.*$/s, '').trim() || '0', 8);
    names.add(name.split('/')[0]);
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return names;
}

test('cleanup list covers everything @sparticuz/chromium extracts into the temp dir', (t) => {
  let binDir;
  try {
    binDir = path.join(path.dirname(createRequire(import.meta.url).resolve('@sparticuz/chromium')), '..', 'bin');
  } catch {
    t.skip('@sparticuz/chromium is not installed');
    return;
  }
  const covered = new Set(renderer.SERVERLESS_TMP_ARTIFACTS);
  // swiftshader.tar.br is extracted straight into the temp root; the others into
  // a directory named after the archive (chromium.br -> chromium).
  const swiftshader = tarTopLevelNames(zlib.brotliDecompressSync(fs.readFileSync(path.join(binDir, 'swiftshader.tar.br'))));
  for (const name of swiftshader) assert.ok(covered.has(name), `swiftshader extracts ${name} into the temp root`);
  for (const archive of fs.readdirSync(binDir)) {
    if (archive.startsWith('swiftshader')) continue;
    const dirName = archive.replace(/\.tar\.br$|\.br$/, '');
    assert.ok(covered.has(dirName), `${archive} extracts to ${dirName}`);
  }
});

test('a crashed browser is relaunched exactly once for several in-flight renders', { skip: !withChromium && 'set TEST_IMAGE=1 to run' }, async () => {
  // A slow image keeps renders in flight (networkidle0) while we kill Chromium.
  const slow = http.createServer((_req, res) => {
    setTimeout(() => {
      res.writeHead(200, { 'Content-Type': 'image/svg+xml' });
      res.end('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>');
    }, 2500);
  });
  await new Promise((resolve) => slow.listen(0, '127.0.0.1', resolve));
  const html = `<html><body><img src="http://127.0.0.1:${slow.address().port}/slow.svg"><p>hello</p></body></html>`;

  try {
    const first = await renderer.getBrowser();
    const pid = first.process()?.pid;
    assert.ok(pid, 'browser should expose its process');
    const launchesBefore = renderer.stats.launches;

    const renders = [1, 2, 3].map(() => renderer.renderHtmlToPng(html, { timeoutMs: 10_000 }));
    await new Promise((resolve) => setTimeout(resolve, 800));
    process.kill(pid, 'SIGKILL');

    const results = await Promise.all(renders);
    for (const png of results) assert.equal(png.toString('hex', 0, 8), '89504e470d0a1a0a');
    assert.equal(renderer.stats.launches - launchesBefore, 1, 'exactly one relaunch after the crash');
    const second = await renderer.getBrowser();
    assert.notEqual(second.process()?.pid, pid);
    assert.equal(second.connected, true);
  } finally {
    slow.close();
  }
});
