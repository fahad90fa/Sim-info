/**
 * Config behaviour depends on process.env at import time, so each case runs
 * in a child Node process.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROBE = `
  const { config } = await import('./src/config.js');
  console.log(JSON.stringify({
    isServerless: config.isServerless, trustProxy: config.trustProxy,
    imageCacheDir: config.paths.imageCacheDir, logFile: config.logFile,
    lookupMock: config.lookup.mock, port: config.port,
    nodeEnv: config.nodeEnv, isProduction: config.isProduction, fontUrls: config.puppeteer.fontUrls.length,
  }));
`;

function probe(extraEnv) {
  // Start from a minimal environment so the repo .env / the developer's shell cannot leak in.
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, ...extraEnv };
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', PROBE], { cwd: serverRoot, env, stdio: ['ignore', 'pipe', 'pipe'] });
  return JSON.parse(out.toString().trim().split('\n').pop());
}

test('local runs load the repo .env', () => {
  const c = probe({});
  assert.equal(c.isServerless, false);
  assert.equal(c.trustProxy, 0);
  // NODE_ENV=production is only in .env (the code default is development), so
  // this proves dotenv actually ran.
  assert.equal(c.nodeEnv, 'production');
  assert.equal(c.isProduction, true);
});

test('on Vercel the committed .env is ignored and serverless defaults apply', () => {
  const c = probe({ VERCEL: '1' });
  assert.equal(c.isServerless, true);
  assert.equal(c.trustProxy, 1, 'TRUST_PROXY=0 from .env must not leak into serverless');
  assert.ok(c.imageCacheDir.startsWith(os.tmpdir()), `image cache should live under tmp, got ${c.imageCacheDir}`);
  assert.equal(c.logFile, null);
  assert.equal(c.isProduction, true, 'serverless defaults to production');
  assert.equal(probe({ VERCEL: '1', NODE_ENV: 'development' }).isProduction, false);
});

test('serverless ignores non-/tmp IMAGE_CACHE_DIR and LOG_FILE but honours /tmp paths', () => {
  const bad = probe({ VERCEL: '1', IMAGE_CACHE_DIR: './cache/images', LOG_FILE: './logs/lookups.log' });
  assert.ok(bad.imageCacheDir.startsWith(os.tmpdir()));
  assert.equal(bad.logFile, null);
  const good = probe({ VERCEL: '1', IMAGE_CACHE_DIR: path.join(os.tmpdir(), 'x'), LOG_FILE: path.join(os.tmpdir(), 'y', 'l.log') });
  assert.equal(good.imageCacheDir, path.join(os.tmpdir(), 'x'));
  assert.equal(good.logFile, path.join(os.tmpdir(), 'y', 'l.log'));
  assert.equal(probe({ VERCEL: '1', IMAGE_CACHE_DIR: os.tmpdir() }).imageCacheDir, os.tmpdir(), 'the temp dir itself is writable');
});

test('card font downloads can be disabled', () => {
  assert.ok(probe({}).fontUrls >= 3);
  assert.equal(probe({ CARD_FONT_URLS: '' }).fontUrls, 0);
});

test('AWS Lambda counts as serverless, ECS/Fargate does not', () => {
  assert.equal(probe({ AWS_EXECUTION_ENV: 'AWS_Lambda_nodejs22.x' }).isServerless, true);
  assert.equal(probe({ AWS_LAMBDA_FUNCTION_NAME: 'fn' }).isServerless, true);
  const ecs = probe({ AWS_EXECUTION_ENV: 'AWS_ECS_FARGATE', IMAGE_CACHE_DIR: '/app/server/cache/images' });
  assert.equal(ecs.isServerless, false);
  assert.equal(ecs.imageCacheDir, '/app/server/cache/images');
});

test('an explicit dashboard variable wins over serverless defaults', () => {
  assert.equal(probe({ VERCEL: '1', TRUST_PROXY: '2' }).trustProxy, 2);
});
