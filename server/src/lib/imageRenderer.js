/**
 * Renders the 1200x630 social card for a lookup result with headless Chrome.
 *
 * - One shared browser instance, launched lazily and relaunched if it dies.
 * - A small semaphore caps concurrent renders (IMAGE_RENDER_CONCURRENCY).
 * - PNGs are cached on disk under IMAGE_CACHE_DIR with a TTL and a file cap,
 *   plus a tiny in-memory map so hot numbers never touch the disk twice.
 */
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { config } from '../config.js';
import { logger } from './logger.js';

export const CARD_WIDTH = 1200;
export const CARD_HEIGHT = 630;

/** Counters exposed for tests and diagnostics. */
export const stats = { launches: 0, relaunchesForFonts: 0 };

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

// --- @sparticuz/chromium (Vercel / AWS Lambda) ----------------------------

/**
 * Everything @sparticuz/chromium extracts into os.tmpdir() (see its
 * build/lambdafs.js): chromium.br -> chromium, fonts.tar.br -> fonts/,
 * al2023.tar.br -> al2023/, and swiftshader.tar.br straight into the temp
 * root as the files listed below. The unit tests check this list against the
 * shipped archives.
 */
export const SERVERLESS_TMP_ARTIFACTS = [
  'chromium',
  'fonts',
  'fonts-cache',
  'al2023',
  'libEGL.so',
  'libGLESv2.so',
  'libvk_swiftshader.so',
  'libvulkan.so.1',
  'vk_swiftshader_icd.json',
];

/**
 * Remove what @sparticuz/chromium extracted so the next launch starts clean.
 * `keepFonts` preserves /tmp/fonts (and the downloaded extra fonts) when the
 * font setup itself is known to be intact.
 */
async function cleanupServerlessChromium({ keepFonts = false } = {}) {
  await Promise.all(
    SERVERLESS_TMP_ARTIFACTS.filter((name) => !(keepFonts && name === 'fonts')).map((name) =>
      fs.rm(path.join(os.tmpdir(), name), { recursive: true, force: true }).catch(() => {}),
    ),
  );
}

/**
 * The Lambda Chromium build ships only Open Sans, and its fontconfig scans
 * /tmp/fonts at launch. Download extra fonts there (colour emoji, Arabic and
 * Devanagari so Urdu / Hindi names render) once per instance.
 *
 * Must run AFTER chromium.executablePath(): that call extracts fonts.tar.br
 * (fonts.conf + Open Sans) into /tmp/fonts and skips extraction if the
 * directory already exists - creating it first would leave Chromium with no
 * fontconfig at all.
 *
 * Fontconfig only scans the directory when Chromium starts, so fonts that
 * arrive after a launch need a relaunch (handled in renderOnce).
 */
let fontRetryAt = 0;
let fontsComplete = !config.isServerless || config.puppeteer.fontUrls.length === 0;
let browserNeedsFontRelaunch = false;

const fontFileFor = (url) => {
  try {
    const name = path.basename(new URL(url).pathname) || 'font.ttf';
    return path.join(os.tmpdir(), 'fonts', name);
  } catch {
    return null;
  }
};

/** @returns {Promise<{ complete: boolean, added: boolean }>} */
async function ensureServerlessFonts() {
  const urls = config.puppeteer.fontUrls;
  if (!urls.length) return { complete: true, added: false };
  const missing = urls.filter((url) => {
    const file = fontFileFor(url);
    return file && !fsSync.existsSync(file);
  });
  if (!missing.length) {
    fontsComplete = true;
    return { complete: true, added: false };
  }
  if (Date.now() < fontRetryAt) return { complete: false, added: false };

  const dir = path.join(os.tmpdir(), 'fonts');
  if (!fsSync.existsSync(path.join(dir, 'fonts.conf'))) {
    // Chromium has not been extracted yet; creating the directory now would
    // make @sparticuz/chromium skip its own font setup.
    return { complete: false, added: false };
  }
  const results = await Promise.all(missing.map((url) => downloadFont(url)));
  const added = results.some((ok) => ok);
  fontsComplete = results.every((ok) => ok);
  if (!fontsComplete) fontRetryAt = Date.now() + config.puppeteer.fontRetryMs; // back off, then try again
  return { complete: fontsComplete, added };
}

async function downloadFont(url) {
  const file = fontFileFor(url);
  if (!file) {
    logger.warn('serverless_font_invalid_url', { url });
    return true; // nothing to retry
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    await fs.writeFile(`${file}.tmp`, buffer);
    await fs.rename(`${file}.tmp`, file);
    logger.info('serverless_font_ready', { file, bytes: buffer.length });
    return true;
  } catch (err) {
    logger.warn('serverless_font_failed', { url, message: err.message });
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * True when every configured card font is available to the browser (always
 * true off serverless). Callers use it to avoid caching degraded renders.
 */
export function cardFontsReady() {
  return fontsComplete && !browserNeedsFontRelaunch;
}

/**
 * On Vercel / AWS Lambda use the @sparticuz/chromium build (a Chromium binary
 * packaged for Lambda-like environments). Returns null elsewhere.
 */
async function resolveServerlessChromium() {
  if (!config.isServerless) return null;
  try {
    const { default: chromium } = await import('@sparticuz/chromium');
    let executablePath = await chromium.executablePath();
    // A /tmp/fonts left behind without fonts.conf (e.g. by an interrupted first
    // start) would make Chromium launch without any font; re-extract everything.
    if (!fsSync.existsSync(path.join(os.tmpdir(), 'fonts', 'fonts.conf'))) {
      logger.warn('serverless_chromium_reextract', { reason: 'fonts.conf missing' });
      await cleanupServerlessChromium();
      executablePath = await chromium.executablePath();
    }
    await ensureServerlessFonts();
    browserNeedsFontRelaunch = false; // whatever is on disk now is what this launch will see
    return { executablePath, args: chromium.args };
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

// --- shared browser --------------------------------------------------------
let browserPromise = null;
let currentBrowser = null;

/**
 * Forget `browser` if it is still the tracked instance. Owner-checked so that
 * several renders failing on the same dead browser cannot each discard a
 * replacement that another render already launched.
 */
function invalidateBrowser(browser) {
  if (currentBrowser !== browser) return;
  currentBrowser = null;
  browserPromise = null;
  browser.close().catch(() => {});
}

export async function getBrowser() {
  if (browserPromise) {
    const existing = await browserPromise.catch(() => null);
    if (existing && existing.connected) return existing;
    if (existing) invalidateBrowser(existing);
    else browserPromise = null;
    if (browserPromise) return browserPromise; // someone else already relaunched
  }
  const launch = (async () => {
    const serverless = config.puppeteer.executablePath ? null : await resolveServerlessChromium();
    const executablePath = serverless?.executablePath ?? (await resolveExecutablePath());
    if (!executablePath) {
      throw new Error(
        'No Chrome/Chromium binary found. Set PUPPETEER_EXECUTABLE_PATH or install Chromium.',
      );
    }
    const { default: puppeteer } = await import('puppeteer-core');
    let browser;
    try {
      browser = await puppeteer.launch({
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
    } catch (err) {
      if (serverless) {
        // A truncated extraction (e.g. the first render was killed mid-way)
        // would otherwise be reused forever; start from scratch next time.
        // The fonts directory is kept: its integrity is checked separately.
        logger.warn('serverless_chromium_launch_failed_cleaning_tmp', { message: err.message });
        await cleanupServerlessChromium({ keepFonts: true });
      }
      throw err;
    }
    if (browserPromise !== launch) {
      // closeBrowser() ran while we were launching; nobody tracks this instance.
      await browser.close().catch(() => {});
      throw new Error('Browser launch was cancelled');
    }
    currentBrowser = browser;
    stats.launches += 1;
    browser.on('disconnected', () => {
      if (currentBrowser !== browser) return; // an old instance we already replaced
      logger.warn('browser_disconnected');
      currentBrowser = null;
      browserPromise = null;
    });
    logger.info('browser_launched', { executablePath });
    return browser;
  })();
  browserPromise = launch;
  return launch;
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

const isDeadBrowserError = (err) =>
  /Target closed|Protocol error|Connection closed|browser has disconnected|Session closed/i.test(err?.message ?? '');

/** Render an HTML string to a PNG buffer at the card size. */
export async function renderHtmlToPng(html, options = {}) {
  try {
    return await renderOnce(html, options);
  } catch (err) {
    if (!isDeadBrowserError(err)) throw err;
    // The shared browser died while we were using it (renderOnce already
    // dropped it); the next getBrowser() relaunches once for everybody.
    logger.warn('card_render_retry_after_browser_crash', { message: err.message });
    return renderOnce(html, options);
  }
}

async function renderOnce(html, { timeoutMs = 20_000 } = {}) {
  await acquire();
  let browser;
  let page;
  try {
    if (config.isServerless && currentBrowser && !fontsComplete && Date.now() >= fontRetryAt) {
      // A font download failed at an earlier launch; try again, and if
      // something new arrived relaunch the browser so fontconfig sees it.
      // (The first launch downloads fonts itself, after Chromium's extraction.)
      const { added } = await ensureServerlessFonts();
      if (added) browserNeedsFontRelaunch = true;
    }
    if (browserNeedsFontRelaunch && active === 1) {
      // We hold the only render slot, so nobody is using the browser right now.
      stats.relaunchesForFonts += 1;
      await closeBrowser();
      browserNeedsFontRelaunch = false;
    }
    browser = await getBrowser();
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
  } catch (err) {
    if (browser && isDeadBrowserError(err)) invalidateBrowser(browser);
    throw err;
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
    await pruneDiskCache();
  } catch (err) {
    logger.warn('image_cache_write_failed', { message: err.message });
  }
}

/**
 * Keep the on-disk cache bounded (IMAGE_CACHE_MAX_FILES): expired files are
 * otherwise only removed when the same number is requested again, which on a
 * long-lived serverless instance could slowly fill /tmp.
 */
let pruning = null;
async function pruneDiskCache() {
  const max = config.cache.imageMaxFiles;
  if (!max || pruning) return pruning;
  pruning = (async () => {
    const dir = config.paths.imageCacheDir;
    const names = (await fs.readdir(dir)).filter((n) => n.endsWith('.png'));
    if (names.length <= max) return;
    const entries = await Promise.all(
      names.map(async (name) => ({ name, mtime: (await fs.stat(path.join(dir, name)).catch(() => ({ mtimeMs: 0 }))).mtimeMs })),
    );
    entries.sort((a, b) => a.mtime - b.mtime);
    const victims = entries.slice(0, entries.length - max);
    await Promise.all(victims.map((v) => fs.unlink(path.join(dir, v.name)).catch(() => {})));
    logger.info('image_cache_pruned', { removed: victims.length, kept: max });
  })().catch((err) => logger.warn('image_cache_prune_failed', { message: err.message })).finally(() => {
    pruning = null;
  });
  return pruning;
}

export async function invalidateImage(number) {
  memory.delete(number);
  await fs.unlink(cachePathFor(number)).catch(() => {});
}

export async function closeBrowser() {
  const pending = browserPromise;
  browserPromise = null;
  const browser = currentBrowser ?? (pending ? await pending.catch(() => null) : null);
  currentBrowser = null;
  if (browser) await browser.close().catch(() => {});
}
