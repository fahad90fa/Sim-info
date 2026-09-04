/**
 * GET /image/:number – 1200x630 PNG social card for a lookup result.
 */
import { Router } from 'express';
import ejs from 'ejs';
import path from 'node:path';
import { parsePhone, formatPhone, guessCountry } from '../lib/phone.js';
import { lookupNumber, LookupError } from '../lib/lookup.js';
import { imageLimiter } from '../middleware/rateLimit.js';
import { renderHtmlToPng, getCachedImage, storeImage, CARD_WIDTH, CARD_HEIGHT } from '../lib/imageRenderer.js';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';

const MAX_NAMES_ON_CARD = 8;

export async function buildCardHtml(number, result) {
  const template = path.join(config.paths.views, 'card.ejs');
  const names = result.names.slice(0, MAX_NAMES_ON_CARD);
  return ejs.renderFile(template, {
    number,
    display: formatPhone(number),
    country: guessCountry(number),
    names,
    extraNames: Math.max(0, result.names.length - names.length),
    thumbnail: result.images[0] ?? null,
    initial: (result.names[0] ?? '#').trim().charAt(0).toUpperCase(),
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
  });
}

// Coalesce concurrent renders of the same number.
const rendering = new Map();

export function createImageRouter({ cache }) {
  const router = Router();

  router.get('/image/:number', imageLimiter, async (req, res) => {
    const parsed = parsePhone(req.params.number);
    if (!parsed.ok) return res.status(400).type('text/plain').send(parsed.message);
    const { number } = parsed;
    const download = req.query.download === '1';

    const send = (buffer, source) => {
      res.set({
        'Content-Type': 'image/png',
        'Content-Length': buffer.length,
        'Cache-Control': `public, max-age=${Math.min(config.cache.imageTtlSeconds, 3600)}`,
        'X-Image-Cache': source,
      });
      if (download) res.set('Content-Disposition', `attachment; filename="sim-info-${number}.png"`);
      res.end(buffer);
    };

    try {
      const cached = await getCachedImage(number);
      if (cached) return send(cached, 'hit');

      if (!rendering.has(number)) {
        rendering.set(
          number,
          (async () => {
            const started = Date.now();
            const result = await lookupNumber(number, cache);
            const html = await buildCardHtml(number, result);
            const png = await renderHtmlToPng(html);
            await storeImage(number, png);
            logger.info('card_rendered', { number, ms: Date.now() - started, bytes: png.length });
            return png;
          })().finally(() => rendering.delete(number)),
        );
      }
      const png = await rendering.get(number);
      return send(png, 'miss');
    } catch (err) {
      if (err instanceof LookupError) {
        return res.status(err.status).type('text/plain').send(err.message);
      }
      logger.error('card_render_failed', { number, message: err.message, stack: err.stack });
      return res.status(500).type('text/plain').send('Could not generate the image right now. Please try again later.');
    }
  });

  return router;
}
