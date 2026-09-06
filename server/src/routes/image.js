/**
 * GET /image/:number – 1200x630 PNG social card for a lookup result.
 */
import { Router } from 'express';
import { parsePhone, formatPhone, guessCountry } from '../lib/phone.js';
import { render } from '../lib/templates.js';
import { lookupNumber, LookupError } from '../lib/lookup.js';
import { imageLimiter } from '../middleware/rateLimit.js';
import { renderCard, getCachedImage, storeImage, isDeadBrowserError, CARD_WIDTH, CARD_HEIGHT } from '../lib/imageRenderer.js';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';

const MAX_NAMES_ON_CARD = 8;

export async function buildCardHtml(number, result) {
  const names = result.names.slice(0, MAX_NAMES_ON_CARD);
  return render('card', {
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

    const send = (buffer, source, { cacheable = true } = {}) => {
      res.set({
        'Content-Type': 'image/png',
        'Content-Length': buffer.length,
        'Cache-Control': cacheable ? `public, max-age=${Math.min(config.cache.imageTtlSeconds, 3600)}` : 'no-store',
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
            // A card rendered by a browser that lacked a font (a failed download
            // at cold start) may miss emoji or Urdu/Hindi glyphs; serve it, but
            // do not cache it anywhere.
            const { png, complete } = await renderCard(html);
            if (complete) await storeImage(number, png);
            logger.info('card_rendered', { number, ms: Date.now() - started, bytes: png.length, fontsComplete: complete });
            return { png, complete };
          })().finally(() => rendering.delete(number)),
        );
      }
      const { png, complete } = await rendering.get(number);
      return send(png, complete ? 'miss' : 'miss-degraded', { cacheable: complete });
    } catch (err) {
      if (err instanceof LookupError) {
        return res.status(err.status).type('text/plain').send(err.message);
      }
      if (isDeadBrowserError(err)) {
        // The browser crashed repeatedly under this request; it is relaunched
        // for the next one, so ask clients (and link unfurlers) to retry.
        logger.warn('card_render_browser_unavailable', { number, message: err.message });
        return res.status(503).set('Retry-After', '3').type('text/plain').send('The image renderer is restarting. Please retry in a few seconds.');
      }
      logger.error('card_render_failed', { number, message: err.message, stack: err.stack });
      return res.status(500).type('text/plain').send('Could not generate the image right now. Please try again later.');
    }
  });

  return router;
}
