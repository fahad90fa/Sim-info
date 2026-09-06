/**
 * Renders the 1200x630 social card for a lookup result with headless Chrome.
 *
 * - One shared browser instance, launched lazily and relaunched if it dies.
 * - A small semaphore caps concurrent renders (IMAGE_RENDER_CONCURRENCY).
 * - PNGs are cached on disk under IMAGE_CACHE_DIR with a TTL and a file cap,
 *   plus a tiny in-memory map so hot numbers never touch the disk twice.
 *
 * Lifecycle invariants (see getBrowser / launchBrowser / closeBrowser):
 * - `browserPromise` is the launch of the tracked browser; `currentBrowser`
 *   is set only while that launch is current. Every write to either field
 *   is owner-checked against the promise/browser the writer awaited, so
 *   several renders observing the same failure can never each discard a
 *   replacement another render already started.
 * - A failed launch rejects all of its waiters and is not retried by them;
 *   the next render launches again.
 * - A browser that dies is dropped by whoever notices first; everybody else
 *   joins the single replacement launch.
 *
 * Font invariants (serverless only, see "extra fonts" below):
 * - `fontState.diskVersion` counts successful font downloads; every browser
 *   records the version it launched with. A render is complete only when its
 *   browser's version is current and every configured font is on disk or
 *   given up on. There is no flag to lose: a stale browser is swapped by the
 *   next render that finds it, and a browser launched while a download was
 *   in flight is simply stale afterwards.
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
export const stats = { launches: 0, launchFailures: 0, relaunchesForFonts: 0 };

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

// --- extra fonts for the serverless Chromium -------------------------------

/**
 * The Lambda Chromium build ships only Open Sans, and its fontconfig scans
 * /tmp/fonts when Chromium starts. We download extra fonts there (colour
 * emoji, Arabic and Devanagari so Urdu / Hindi names render).
 *
 * Rules:
 * - Downloads run only after chromium.executablePath() extracted fonts.conf
 *   (creating /tmp/fonts first would make @sparticuz/chromium skip its own
 *   font setup and Chromium would start with no fonts at all).
 * - Only the process's first launch waits for the downloads (bounded by the
 *   per-file timeout). Relaunches use whatever is on disk, and retries run in
 *   the background so they never stall a request; a browser that started
 *   before a font arrived is swapped for a fresh one by the next render.
 * - A URL that answers 404/410, serves something that is not a font, or fails
 *   three times is given up on, so completeness (and caching) is judged on
 *   the fonts that can arrive.
 */
const FONT_MAX_ATTEMPTS = 3;
const FONT_DOWNLOAD_TIMEOUT_MS = 15_000;
const fontState = {
  managing: false, // true once the @sparticuz build is in use for this process
  diskVersion: 0, // bumped whenever a font file lands on disk
  retryAt: 0,
  inFlight: null,
  failures: new Map(), // url -> failed attempts
  givenUp: new Set(),
  warnedInvalid: false,
};

const fontFileFor = (url) => {
  try {
    const name = path.basename(new URL(url).pathname) || 'font.ttf';
    return path.join(os.tmpdir(), 'fonts', name);
  } catch {
    return null;
  }
};

const warnInvalidFontUrls = () => {
  if (fontState.warnedInvalid) return;
  fontState.warnedInvalid = true;
  for (const url of config.puppeteer.fontUrls) {
    if (!fontFileFor(url)) logger.warn('serverless_font_invalid_url', { url, hint: 'check CARD_FONT_URLS' });
  }
};

/** Every configured font is on disk or given up on (invalid URLs are skipped). */
const fontsComplete = () =>
  config.puppeteer.fontUrls.every((url) => {
    const file = fontFileFor(url);
    return !file || fontState.givenUp.has(url) || fsSync.existsSync(file);
  });

/** Accept only real font files: sfnt / OpenType / TrueType collection magic. */
export function looksLikeFont(buffer) {
  if (!buffer || buffer.length < 1024) return false;
  const magic = buffer.toString('latin1', 0, 4);
  return magic === '\u0000\u0001\u0000\u0000' || magic === 'OTTO' || magic === 'true' || magic === 'ttcf';
}

/**
 * Download whatever is missing. Memoised so concurrent callers share one
 * batch. @returns {Promise<{ complete: boolean, added: boolean }>}
 */
function ensureServerlessFonts() {
  if (fontState.inFlight) return fontState.inFlight;
  fontState.inFlight = (async () => {
    warnInvalidFontUrls();
    if (fontsComplete()) return { complete: true, added: false };
    if (Date.now() < fontState.retryAt) return { complete: false, added: false };
    if (!fsSync.existsSync(path.join(os.tmpdir(), 'fonts', 'fonts.conf'))) {
      // Chromium has not been extracted yet (see the rules above).
      return { complete: false, added: false };
    }
    const missing = config.puppeteer.fontUrls.filter((url) => {
      const file = fontFileFor(url);
      return file && !fontState.givenUp.has(url) && !fsSync.existsSync(file);
    });
    const results = await Promise.all(missing.map((url) => downloadFont(url)));
    let added = false;
    for (const r of results) {
      if (r.ok) {
        added = true;
        continue;
      }
      const attempts = (fontState.failures.get(r.url) ?? 0) + 1;
      fontState.failures.set(r.url, attempts);
      if (r.permanent || attempts >= FONT_MAX_ATTEMPTS) {
        fontState.givenUp.add(r.url);
        logger.warn('serverless_font_given_up', { url: r.url, attempts, reason: r.message });
      }
    }
    if (added) fontState.diskVersion += 1;
    const complete = fontsComplete();
    if (!complete) fontState.retryAt = Date.now() + config.puppeteer.fontRetryMs;
    return { complete, added };
  })().finally(() => {
    fontState.inFlight = null;
  });
  return fontState.inFlight;
}

async function downloadFont(url) {
  const file = fontFileFor(url);
  if (!file) return { url, ok: false, permanent: true, message: 'invalid URL' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FONT_DOWNLOAD_TIMEOUT_MS);
  const tmp = `${file}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      const permanent = res.status === 404 || res.status === 410;
      throw Object.assign(new Error(`HTTP ${res.status}`), { permanent });
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    if (!looksLikeFont(buffer)) throw new Error(`response is not a font (${buffer.length} bytes)`);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(tmp, buffer);
    await fs.rename(tmp, file);
    logger.info('serverless_font_ready', { file, bytes: buffer.length });
    return { url, ok: true };
  } catch (err) {
    await fs.rm(tmp, { force: true }).catch(() => {});
    logger.warn('serverless_font_failed', { url, message: err.message });
    return { url, ok: false, permanent: Boolean(err.permanent), message: err.message };
  } finally {
    clearTimeout(timer);
  }
}

/** Kick off a background retry when the back-off has expired. Never awaited by renders. */
function refreshFontsInBackground() {
  if (!fontState.managing || fontState.inFlight || Date.now() < fontState.retryAt || fontsComplete()) return;
  ensureServerlessFonts().catch((err) => logger.warn('serverless_font_refresh_failed', { message: err.message }));
}

/**
 * True when the tracked browser has every configured card font (always true
 * when the system Chromium is used). Diagnostic; renders report their own
 * completeness (see renderCard).
 */
export function cardFontsReady() {
  if (!fontState.managing) return true;
  return fontsComplete() && (!currentBrowser || browserFontVersion.get(currentBrowser) === fontState.diskVersion);
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
    if (!fontState.managing) {
      // First launch of this process: worth waiting for the fonts so the
      // very first cards are complete. Relaunches must not wait (a hanging
      // download would stall every render behind them).
      fontState.managing = true;
      await ensureServerlessFonts();
    } else {
      refreshFontsInBackground();
    }
    return { executablePath, args: chromium.args };
  } catch (err) {
    logger.warn('serverless_chromium_unavailable', { message: err.message });
    return null;
  }
}

// --- shared browser --------------------------------------------------------
let browserPromise = null; // launch (pending or settled) of the tracked browser
let currentBrowser = null; // the tracked browser once its launch resolved
const inFlight = new Map(); // browser -> renders currently using it
const retired = new Set(); // browsers replaced while still serving renders
const browserFontVersion = new WeakMap(); // browser -> fontState.diskVersion when it started

class LaunchCancelledError extends Error {
  constructor() {
    super('Browser launch was cancelled');
    this.name = 'LaunchCancelledError';
  }
}

function launchBrowser() {
  const launch = (async () => {
    const serverless = config.puppeteer.executablePath ? null : await resolveServerlessChromium();
    const executablePath = serverless?.executablePath ?? (await resolveExecutablePath());
    if (!executablePath) {
      throw new Error('No Chrome/Chromium binary found. Set PUPPETEER_EXECUTABLE_PATH or install Chromium.');
    }
    // Fontconfig scans /tmp/fonts once at startup: what is on disk now is all
    // this browser will ever see. A download finishing during the launch just
    // makes the browser stale, and the next render swaps it.
    const fontVersionAtLaunch = fontState.diskVersion;
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
      stats.launchFailures += 1;
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
      // closeBrowser() (or a font swap) ran while we were launching.
      await browser.close().catch(() => {});
      throw new LaunchCancelledError();
    }
    currentBrowser = browser;
    browserFontVersion.set(browser, fontVersionAtLaunch);
    stats.launches += 1;
    browser.on('disconnected', () => {
      inFlight.delete(browser);
      retired.delete(browser);
      if (currentBrowser !== browser) return; // an instance we already replaced
      logger.warn('browser_disconnected');
      currentBrowser = null;
      if (browserPromise === launch) browserPromise = null;
    });
    logger.info('browser_launched', { executablePath });
    return browser;
  })();
  return launch;
}

/** Forget `browser` if it is still the tracked instance (owner-checked). */
function dropBrowser(browser) {
  if (currentBrowser !== browser) return;
  currentBrowser = null;
  browserPromise = null;
  browser.close().catch(() => {});
}

/**
 * Resolve the shared browser, launching or relaunching when needed. A launch
 * failure rejects every render waiting on it; the next render tries again.
 */
export async function getBrowser() {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let awaited = browserPromise;
    if (!awaited) {
      awaited = launchBrowser();
      browserPromise = awaited;
    }
    let browser;
    try {
      browser = await awaited;
    } catch (err) {
      if (browserPromise === awaited) browserPromise = null;
      if (err instanceof LaunchCancelledError) continue; // join or start the replacement
      throw err;
    }
    if (browser.connected) return browser;
    dropBrowser(browser); // died between launch and use; the loop relaunches once
  }
  throw new Error('Could not obtain a browser');
}

/**
 * Swap the tracked browser for a fresh one when fonts arrived after it
 * started. Renders still using the old instance finish first; it is closed
 * when the last of them releases it. Returns true when a swap happened.
 */
function replaceStaleBrowser() {
  const old = currentBrowser;
  if (!old || browserFontVersion.get(old) === fontState.diskVersion) return false;
  currentBrowser = null;
  browserPromise = null;
  if ((inFlight.get(old) ?? 0) > 0) retired.add(old);
  else old.close().catch(() => {});
  stats.relaunchesForFonts += 1;
  logger.info('browser_replaced', { reason: 'fonts arrived' });
  return true;
}

const useBrowser = (browser) => inFlight.set(browser, (inFlight.get(browser) ?? 0) + 1);
const releaseBrowser = (browser) => {
  const left = (inFlight.get(browser) ?? 1) - 1;
  if (left > 0) {
    inFlight.set(browser, left);
    return;
  }
  inFlight.delete(browser);
  if (retired.delete(browser)) browser.close().catch(() => {});
};

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

export const isDeadBrowserError = (err) =>
  /Target closed|Protocol error|Connection closed|browser has disconnected|Session closed/i.test(err?.message ?? '');

const RENDER_ATTEMPTS = 3;

/**
 * Render an HTML string to a PNG at the card size.
 * @returns {Promise<{ png: Buffer, complete: boolean }>} `complete` is false
 * when the browser that rendered lacked some configured font (serverless
 * only); callers should serve such a card but not cache it.
 */
export async function renderCard(html, options = {}) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await renderOnce(html, options);
    } catch (err) {
      if (!isDeadBrowserError(err) || attempt >= RENDER_ATTEMPTS) throw err;
      // The shared browser died while we were using it (renderOnce already
      // dropped it); the next getBrowser() relaunches once for everybody.
      logger.warn('card_render_retry_after_browser_crash', { attempt, message: err.message });
    }
  }
}

/** Convenience wrapper returning only the PNG buffer. */
export async function renderHtmlToPng(html, options = {}) {
  return (await renderCard(html, options)).png;
}

async function renderOnce(html, { timeoutMs = 20_000 } = {}) {
  await acquire();
  let browser;
  let page;
  try {
    if (fontState.managing) {
      refreshFontsInBackground();
      replaceStaleBrowser();
    }
    browser = await getBrowser();
    useBrowser(browser);
    page = await browser.newPage();
    await page.setViewport({ width: CARD_WIDTH, height: CARD_HEIGHT, deviceScaleFactor: 1 });
    // networkidle0 lets remote thumbnails finish loading; the timeout keeps a
    // dead image host from blocking the render forever.
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: timeoutMs }).catch((err) => {
      logger.warn('card_setcontent_timeout', { message: err.message });
    });
    await page.evaluate(() => document.fonts?.ready).catch(() => {});
    const png = await page.screenshot({
      type: 'png',
      clip: { x: 0, y: 0, width: CARD_WIDTH, height: CARD_HEIGHT },
    });
    const complete =
      !fontState.managing || (browserFontVersion.get(browser) === fontState.diskVersion && fontsComplete());
    return { png, complete };
  } catch (err) {
    if (browser && isDeadBrowserError(err)) dropBrowser(browser);
    throw err;
  } finally {
    if (page) await page.close().catch(() => {});
    if (browser) releaseBrowser(browser);
    release();
  }
}

// --- disk + memory cache --------------------------------------------------
const memory = new Map(); // number -> { buffer, expires }
const MEMORY_MAX_ENTRIES = 100;
const STALE_TMP_MS = 60_000;

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
 * Keep the on-disk cache bounded (IMAGE_CACHE_MAX_FILES; 0 disables the cap)
 * and sweep temp files left by interrupted writes. Expired files are otherwise
 * only removed when the same number is requested again, which on a long-lived
 * serverless instance could slowly fill /tmp.
 */
let pruning = null;
export async function pruneDiskCache() {
  if (pruning) return pruning;
  pruning = (async () => {
    const max = config.cache.imageMaxFiles;
    const dir = config.paths.imageCacheDir;
    const now = Date.now();
    const names = await fs.readdir(dir);
    const entries = await Promise.all(
      names.map(async (name) => ({ name, mtime: (await fs.stat(path.join(dir, name)).catch(() => ({ mtimeMs: 0 }))).mtimeMs })),
    );
    const staleTmp = entries.filter((e) => e.name.endsWith('.tmp') && now - e.mtime > STALE_TMP_MS);
    const pngs = entries.filter((e) => e.name.endsWith('.png')).sort((a, b) => a.mtime - b.mtime);
    const overflow = max > 0 ? pngs.slice(0, Math.max(0, pngs.length - max)) : [];
    const victims = [...staleTmp, ...overflow];
    if (!victims.length) return;
    await Promise.all(victims.map((v) => fs.unlink(path.join(dir, v.name)).catch(() => {})));
    logger.info('image_cache_pruned', { removed: victims.length, staleTmp: staleTmp.length, kept: pngs.length - overflow.length });
  })()
    .catch((err) => logger.warn('image_cache_prune_failed', { message: err.message }))
    .finally(() => {
      pruning = null;
    });
  return pruning;
}

export async function invalidateImage(number) {
  memory.delete(number);
  await fs.unlink(cachePathFor(number)).catch(() => {});
}

/**
 * Close every browser this module owns. Meant for shutdown and tests: renders
 * still in flight will fail and relaunch a browser on their retry.
 */
export async function closeBrowser() {
  const pending = browserPromise;
  const current = currentBrowser;
  browserPromise = null;
  currentBrowser = null;
  const toClose = [...retired];
  retired.clear();
  if (current) toClose.push(current);
  else if (pending) {
    // A launch in progress: its tail closes the browser itself and rejects
    // with LaunchCancelledError, but close it here too if it already resolved.
    const browser = await pending.catch(() => null);
    if (browser && browser !== currentBrowser) toClose.push(browser);
  }
  await Promise.all(toClose.map((b) => b.close().catch(() => {})));
}
