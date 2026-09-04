/**
 * Renders the 1200x630 social card for a lookup result with headless Chrome.
 *
 * - One shared browser instance, launched lazily and relaunched if it dies.
 * - A small semaphore caps concurrent renders (IMAGE_RENDER_CONCURRENCY).
 * - PNGs are cached on disk under IMAGE_CACHE_DIR with a TTL, plus a tiny
 *   in-memory map so hot numbers never touch the disk twice.
 */
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { config } from '../config.js';
import { logger } from './logger.js';

export const CARD_WIDTH = 1200;
export const CARD_HEIGHT = 630;

const CANDIDATE_BINARIES = [
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/opt/pw-browsers/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
];

function findPlaywrightChromium() {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH || path.join(process.env.HOME || '', '.cache', 'ms-playwright');
  try {
    const dirs = fsSync.readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse();
    for (const dir of dirs) {
      const candidate = path.join(root, dir, 'chrome-linux', 'chrome');
      if (fsSync.existsSync(candidate)) return candidate;
    }
  } catch {
    /* no playwright cache */
  }
  return null;
}

/**
 * The Lambda Chromium build ships only Open Sans, and its fontconfig scans
 * /tmp/fonts at launch. Download a colour emoji font there (once per instance)
 * so names such as "Fahad ☠️" render on the card.
 */
async function ensureServerlessEmojiFont() {
  const url = config.puppeteer.emojiFontUrl;
  if (!url) return;
  let file;
  try {
    const name = path.basename(new URL(url).pathname) || 'emoji.ttf';
    file = path.join(os.tmpdir(), 'fonts', name);
  } catch {
    logger.warn('serverless_emoji_font_invalid_url', { url });
    return;
  }
  if (fsSync.existsSync(file)) return;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(`${file}.tmp`, buffer);
    await fs.rename(`${file}.tmp`, file);
    logger.info('serverless_emoji_font_ready', { file, bytes: buffer.length });
  } catch (err) {
    logger.warn('serverless_emoji_font_failed', { message: err.message });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * On Vercel / AWS Lambda use the @sparticuz/chromium build (a Chromium binary
 * packaged for Lambda-like environments). Returns null elsewhere.
 */
async function resolveServerlessChromium() {
  if (!config.isServerless) return null;
  try {
    const { default: chromium } = await import('@sparticuz/chromium');
    await ensureServerlessEmojiFont();
    return { executablePath: await chromium.executablePath(), args: chromium.args };
  } catch (err) {
    logger.warn('serverless_chromium_unavailable', { message: err.message });
    return null;
  }
}

export async function resolveExecutablePath() {
  if (config.puppeteer.executablePath) return config.puppeteer.executablePath;
  for (const candidate of CANDIDATE_BINARIES) {
    if (fsSync.existsSync(candidate)) return candidate;
  }
  const pw = findPlaywrightChromium();
  if (pw) return pw;
  // Last resort: a full `puppeteer` install (optional dependency) bundles its own Chrome.
  try {
    const { default: puppeteer } = await import('puppeteer');
    return puppeteer.executablePath();
  } catch {
    return null;
  }
}

let browserPromise = null;

async function getBrowser() {
  if (browserPromise) {
    const existing = await browserPromise.catch(() => null);
    if (existing && existing.connected) return existing;
    browserPromise = null;
  }
  browserPromise = (async () => {
    const serverless = config.puppeteer.executablePath ? null : await resolveServerlessChromium();
    const executablePath = serverless?.executablePath ?? (await resolveExecutablePath());
    if (!executablePath) {
      throw new Error(
        'No Chrome/Chromium binary found. Set PUPPETEER_EXECUTABLE_PATH or install Chromium.',
      );
    }
    const { default: puppeteer } = await import('puppeteer-core');
    const browser = await puppeteer.launch({
      executablePath,
      headless: true,
      args: [
        ...(serverless?.args ?? []),
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--font-render-hinting=none',
        '--hide-scrollbars',
      ],
    });
    browser.on('disconnected', () => {
      logger.warn('browser_disconnected');
      browserPromise = null;
    });
    logger.info('browser_launched', { executablePath });
    return browser;
  })();
  return browserPromise;
}

// --- tiny semaphore -------------------------------------------------------
let active = 0;
const waiters = [];
const acquire = () =>
  new Promise((resolve) => {
    if (active < config.puppeteer.concurrency) {
      active += 1;
      resolve();
    } else {
      waiters.push(resolve);
    }
  });
const release = () => {
  const next = waiters.shift();
  if (next) next();
  else active -= 1;
};

/** Render an HTML string to a PNG buffer at the card size. */
export async function renderHtmlToPng(html, { timeoutMs = 20_000 } = {}) {
  await acquire();
  let page;
  try {
    const browser = await getBrowser();
    page = await browser.newPage();
    await page.setViewport({ width: CARD_WIDTH, height: CARD_HEIGHT, deviceScaleFactor: 1 });
    // networkidle0 lets remote thumbnails finish loading; the timeout keeps a
    // dead image host from blocking the render forever.
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: timeoutMs }).catch((err) => {
      logger.warn('card_setcontent_timeout', { message: err.message });
    });
    await page.evaluate(() => document.fonts?.ready).catch(() => {});
    return await page.screenshot({
      type: 'png',
      clip: { x: 0, y: 0, width: CARD_WIDTH, height: CARD_HEIGHT },
    });
  } finally {
    if (page) await page.close().catch(() => {});
    release();
  }
}

// --- disk + memory cache --------------------------------------------------
const memory = new Map(); // number -> { buffer, expires }
const MEMORY_MAX_ENTRIES = 100;

function cachePathFor(number) {
  return path.join(config.paths.imageCacheDir, `${number}.png`);
}

export async function getCachedImage(number) {
  const now = Date.now();
  const hit = memory.get(number);
  if (hit && hit.expires > now) return hit.buffer;
  memory.delete(number);

  const file = cachePathFor(number);
  try {
    const stat = await fs.stat(file);
    if (stat.mtimeMs + config.cache.imageTtlSeconds * 1000 < now) {
      await fs.unlink(file).catch(() => {});
      return null;
    }
    const buffer = await fs.readFile(file);
    remember(number, buffer, stat.mtimeMs + config.cache.imageTtlSeconds * 1000);
    return buffer;
  } catch {
    return null;
  }
}

function remember(number, buffer, expires) {
  if (memory.size >= MEMORY_MAX_ENTRIES) {
    const oldest = memory.keys().next().value;
    memory.delete(oldest);
  }
  memory.set(number, { buffer, expires });
}

export async function storeImage(number, buffer) {
  remember(number, buffer, Date.now() + config.cache.imageTtlSeconds * 1000);
  try {
    await fs.mkdir(config.paths.imageCacheDir, { recursive: true });
    const file = cachePathFor(number);
    const tmp = `${file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, buffer);
    await fs.rename(tmp, file);
  } catch (err) {
    logger.warn('image_cache_write_failed', { message: err.message });
  }
}

export async function invalidateImage(number) {
  memory.delete(number);
  await fs.unlink(cachePathFor(number)).catch(() => {});
}

export async function closeBrowser() {
  if (!browserPromise) return;
  const browser = await browserPromise.catch(() => null);
  browserPromise = null;
  if (browser) await browser.close().catch(() => {});
}
