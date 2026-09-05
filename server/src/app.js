import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';
import { config as settings } from './config.js';
import { createApiRouter } from './routes/api.js';
import { createPagesRouter } from './routes/pages.js';
import { createImageRouter } from './routes/image.js';
import { createLazyCache } from './lib/cache.js';
import { pageResponder, assets } from './lib/templates.js';
import { logger } from './lib/logger.js';

/**
 * Build the Express app. The cache is injected so tests can supply their own.
 */
export function createApp({ cache }) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', settings.trustProxy);
  app.use(pageResponder);

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          'default-src': ["'self'"],
          'script-src': ["'self'"],
          'style-src': ["'self'", "'unsafe-inline'"],
          // Result photos come from arbitrary hosts.
          'img-src': ["'self'", 'data:', 'blob:', 'https:', 'http:'],
          'connect-src': ["'self'"],
          'frame-ancestors': ["'none'"],
          'upgrade-insecure-requests': null,
        },
      },
      crossOriginEmbedderPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );

  if (settings.corsOrigins.length) {
    app.use('/api', cors({ origin: settings.corsOrigins, methods: ['GET'] }));
  }

  app.use('/api', createApiRouter({ cache }));
  app.use(createPagesRouter({ cache }));
  app.use(createImageRouter({ cache }));

  // Assets for the server-rendered pages, served from memory (see lib/templates.js).
  for (const [name, asset] of Object.entries(assets)) {
    app.get(`/${name}`, (_req, res) => {
      res.set('Cache-Control', settings.isProduction ? 'public, max-age=86400' : 'no-cache');
      res.type(asset.type).send(asset.body);
    });
  }

  // Built React client (client/dist) when present; SPA fallback to index.html.
  const indexHtml = path.join(settings.paths.clientDist, 'index.html');
  if (fs.existsSync(indexHtml)) {
    app.use(express.static(settings.paths.clientDist, { maxAge: settings.isProduction ? '1y' : 0, index: false }));
    // SPA fallback for client-side routes; paths that look like files (stale
    // hashed assets, favicons) fall through to the 404 handler instead.
    app.get(/^\/(?!api\/|print\/|share\/|image\/)(?!.*\.[a-z0-9]+$).*/i, (_req, res) => {
      res.set('Cache-Control', 'no-cache');
      res.sendFile(indexHtml, { dotfiles: 'allow' });
    });
  } else {
    app.get('/', (_req, res) => {
      res
        .status(200)
        .type('text/plain')
        .send('SIM Info API is running. Build the client (npm run build) to serve the UI from here, or run the Vite dev server.');
    });
  }

  app.use((_req, res) => {
    res.status(404).page('error', { title: 'Not found', message: 'That page does not exist.' });
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    logger.error('unhandled_error', { message: err.message, stack: err.stack });
    if (res.headersSent) return;
    res.status(500).page('error', { title: 'Server error', message: 'Something went wrong.' });
  });

  return app;
}

/**
 * The application instance used by serverless entrypoints (api/index.js and
 * Vercel's Express preset, which imports this file directly and expects the
 * app as the default export). The cache backend connects on first use.
 */
export const app = createApp({ cache: createLazyCache() });
export default app;

/**
 * Vercel function settings, read statically at build time when this file is
 * the entrypoint (Root Directory = server). A cold image render (Chromium
 * extraction + launch + screenshot) needs well over the legacy 10 s default.
 */
export const config = { maxDuration: 60 };
