import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(serverRoot, '..');

/**
 * Vercel / AWS Lambda: read-only filesystem except /tmp, always behind a
 * proxy, and no long-lived process (so in-memory caches live per instance).
 * Only genuine Lambda-style runtimes count; ECS/Fargate containers (which set
 * AWS_EXECUTION_ENV=AWS_ECS_*) run the Docker image normally.
 */
const isServerless = Boolean(
  process.env.VERCEL ||
    process.env.AWS_LAMBDA_FUNCTION_NAME ||
    /^AWS_Lambda_/.test(process.env.AWS_EXECUTION_ENV ?? ''),
);

/**
 * Paths to files that only matter for local / Docker runs. Built through a
 * helper on purpose: serverless bundlers (@vercel/nft) statically evaluate
 * `path.join(<root>, 'literal')` and would otherwise copy `.env` and the local
 * render cache into the function bundle.
 */
const localFile = (...parts) => path.join(repoRoot, ...parts);
const localServerFile = (...parts) => path.join(serverRoot, ...parts);

// .env files configure local and Docker runs. On serverless platforms the
// provider's environment variables are the only source of configuration.
if (!isServerless) {
  dotenv.config({ path: localFile('.env') });
  dotenv.config({ path: localServerFile('.env'), override: true });
}

const env = (key, fallback = '') => {
  const value = process.env[key];
  return value === undefined || value === '' ? fallback : value;
};
const int = (key, fallback) => {
  const parsed = Number.parseInt(env(key, ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const bool = (key, fallback = false) => {
  const value = env(key, '').toLowerCase();
  if (value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value);
};
const warn = (event, fields) =>
  process.stderr.write(`${JSON.stringify({ time: new Date().toISOString(), level: 'warn', event, ...fields })}\n`);

const DEFAULT_CARD_FONT_URLS = [
  'https://raw.githubusercontent.com/googlefonts/noto-emoji/main/fonts/NotoColorEmoji.ttf',
  'https://raw.githubusercontent.com/notofonts/notofonts.github.io/main/fonts/NotoSansArabic/hinted/ttf/NotoSansArabic-Regular.ttf',
  'https://raw.githubusercontent.com/notofonts/notofonts.github.io/main/fonts/NotoSansDevanagari/hinted/ttf/NotoSansDevanagari-Regular.ttf',
].join(',');

const trustProxyRaw = env('TRUST_PROXY', isServerless ? '1' : '0');
let trustProxy;
if (['true', 'false'].includes(trustProxyRaw)) trustProxy = trustProxyRaw === 'true';
else if (/^\d+$/.test(trustProxyRaw)) trustProxy = Number.parseInt(trustProxyRaw, 10);
else trustProxy = trustProxyRaw; // e.g. "loopback, 10.0.0.0/8"

/** True when `target` is `dir` itself or inside it (no `..` escape, separator-aware). */
const isInside = (dir, target) => {
  const rel = path.relative(dir, target);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};

/** Serverless platforms can only write under the OS temp dir. */
const writableOrNull = (setting, configured) => {
  if (!configured) return null;
  const resolved = path.resolve(serverRoot, configured);
  if (!isServerless || isInside(os.tmpdir(), resolved)) return resolved;
  warn('config_path_ignored_on_serverless', { setting, configured, hint: `only ${os.tmpdir()} is writable here` });
  return null;
};

function resolveImageCacheDir() {
  const configured = writableOrNull('IMAGE_CACHE_DIR', env('IMAGE_CACHE_DIR', ''));
  if (configured) return configured;
  return isServerless ? path.join(os.tmpdir(), 'sim-info-images') : localServerFile('cache', 'images');
}

export const config = {
  paths: {
    serverRoot,
    repoRoot,
    // Deliberately a static literal path: this is what makes @vercel/nft bundle
    // the built SPA into the serverless function (needed when the Express app
    // serves the client itself, e.g. Vercel with Root Directory = server).
    clientDist: path.join(repoRoot, 'client', 'dist'),
    imageCacheDir: resolveImageCacheDir(),
  },
  isServerless,
  port: int('PORT', 3000),
  // Serverless deployments are production unless told otherwise.
  nodeEnv: env('NODE_ENV', isServerless ? 'production' : 'development'),
  isProduction: env('NODE_ENV', isServerless ? 'production' : 'development') === 'production',
  trustProxy,
  publicBaseUrl: env('PUBLIC_BASE_URL', '').replace(/\/+$/, ''),
  corsOrigins: env('CORS_ORIGIN', '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  lookup: {
    apiUrl: env('LOOKUP_API_URL', 'https://7u6959.af7u76.workers.dev/'),
    timeoutMs: int('LOOKUP_TIMEOUT_MS', 10_000),
    mock: bool('LOOKUP_MOCK', false),
  },
  cache: {
    ttlSeconds: int('CACHE_TTL_SECONDS', 7 * 24 * 60 * 60),
    redisUrl: env('REDIS_URL', ''),
    imageTtlSeconds: int('IMAGE_CACHE_TTL_SECONDS', 7 * 24 * 60 * 60),
    // Upper bound on cached PNG files on disk (oldest evicted first); 0 disables the cap.
    imageMaxFiles: int('IMAGE_CACHE_MAX_FILES', 200),
  },
  rateLimit: {
    windowMs: int('RATE_LIMIT_WINDOW_MS', 60_000),
    max: int('RATE_LIMIT_MAX', 10),
    imageMax: int('IMAGE_RATE_LIMIT_MAX', 20),
  },
  puppeteer: {
    executablePath: env('PUPPETEER_EXECUTABLE_PATH', ''),
    concurrency: Math.max(1, int('IMAGE_RENDER_CONCURRENCY', 2)),
    // Extra fonts downloaded into /tmp/fonts for the serverless Chromium build,
    // which ships only Open Sans: colour emoji plus Arabic (Urdu) and
    // Devanagari (Hindi) coverage for names. Comma-separated URLs; set
    // CARD_FONT_URLS to an empty string to skip the downloads.
    fontUrls: (process.env.CARD_FONT_URLS === undefined ? DEFAULT_CARD_FONT_URLS : process.env.CARD_FONT_URLS)
      .split(',')
      .map((u) => u.trim())
      .filter(Boolean),
    // How long to wait before retrying a failed font download.
    fontRetryMs: int('CARD_FONT_RETRY_MS', 5 * 60 * 1000),
  },
  /** Absolute path of the analytics log file, or null when disabled / not writable here. */
  logFile: writableOrNull('LOG_FILE', env('LOG_FILE', '')),
};

if (isServerless && (trustProxy === 0 || trustProxy === false)) {
  warn('trust_proxy_disabled_on_serverless', { hint: 'every request arrives via a proxy; rate limiting will see one shared IP' });
}

export default config;
