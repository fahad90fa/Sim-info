import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(serverRoot, '..');

// Load .env from the repo root first, then allow a server-local override.
dotenv.config({ path: path.join(repoRoot, '.env') });
dotenv.config({ path: path.join(serverRoot, '.env'), override: true });

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

const trustProxyRaw = env('TRUST_PROXY', '0');
let trustProxy;
if (['true', 'false'].includes(trustProxyRaw)) trustProxy = trustProxyRaw === 'true';
else if (/^\d+$/.test(trustProxyRaw)) trustProxy = Number.parseInt(trustProxyRaw, 10);
else trustProxy = trustProxyRaw; // e.g. "loopback, 10.0.0.0/8"

export const config = {
  paths: {
    serverRoot,
    repoRoot,
    views: path.join(serverRoot, 'views'),
    public: path.join(serverRoot, 'public'),
    clientDist: path.join(repoRoot, 'client', 'dist'),
    imageCacheDir: path.resolve(serverRoot, env('IMAGE_CACHE_DIR', './cache/images')),
  },
  port: int('PORT', 3000),
  nodeEnv: env('NODE_ENV', 'development'),
  isProduction: env('NODE_ENV', 'development') === 'production',
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
  },
  rateLimit: {
    windowMs: int('RATE_LIMIT_WINDOW_MS', 60_000),
    max: int('RATE_LIMIT_MAX', 10),
    imageMax: int('IMAGE_RATE_LIMIT_MAX', 20),
  },
  puppeteer: {
    executablePath: env('PUPPETEER_EXECUTABLE_PATH', ''),
    concurrency: Math.max(1, int('IMAGE_RENDER_CONCURRENCY', 2)),
  },
  logFile: env('LOG_FILE', ''),
};

export default config;
