/**
 * Server-rendered pages:
 *   GET /print/:number  – minimal, print-optimised result page
 *   GET /share/:number  – OG/Twitter-card page whose og:image is /image/:number
 */
import { Router } from 'express';
import { parsePhone, formatPhone, guessCountry } from '../lib/phone.js';
import { lookupNumber, LookupError } from '../lib/lookup.js';
import { pageLimiter } from '../middleware/rateLimit.js';
import { config } from '../config.js';

function baseUrl(req) {
  if (config.publicBaseUrl) return config.publicBaseUrl;
  return `${req.protocol}://${req.get('host')}`;
}

export function createPagesRouter({ cache }) {
  const router = Router();

  const loadOrRender = async (req, res, view, extra = {}) => {
    const parsed = parsePhone(req.params.number);
    if (!parsed.ok) {
      return res.status(400).render('error', { title: 'Invalid number', message: parsed.message });
    }
    const { number } = parsed;
    try {
      const result = await lookupNumber(number, cache);
      return res.render(view, {
        number,
        display: formatPhone(number),
        country: guessCountry(number),
        names: result.names,
        images: result.images,
        fetchedAt: result.fetchedAt,
        baseUrl: baseUrl(req),
        ...extra,
      });
    } catch (err) {
      const status = err instanceof LookupError ? err.status : 500;
      const message = err instanceof LookupError ? err.message : 'Lookup failed';
      return res.status(status).render('error', { title: 'Lookup failed', message });
    }
  };

  router.get('/print/:number', pageLimiter, (req, res) =>
    loadOrRender(req, res, 'print', { autoPrint: req.query.auto === '1' }),
  );

  router.get('/share/:number', pageLimiter, (req, res) => loadOrRender(req, res, 'share'));

  return router;
}
