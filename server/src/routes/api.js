import { Router } from 'express';
import { parsePhone } from '../lib/phone.js';
import { lookupNumber, LookupError } from '../lib/lookup.js';
import { lookupLimiter } from '../middleware/rateLimit.js';
import { logger } from '../lib/logger.js';

export function createApiRouter({ cache }) {
  const router = Router();

  router.get('/lookup', lookupLimiter, async (req, res) => {
    const raw = typeof req.query.number === 'string' ? req.query.number : '';
    const parsed = parsePhone(raw);
    if (!parsed.ok) {
      return res.status(400).json({ status: 'error', code: 'invalid_number', message: parsed.message });
    }
    const { number } = parsed;

    try {
      const result = await lookupNumber(number, cache);
      logger.lookup({ number, ip: req.ip, cached: result.cached, ua: req.get('user-agent') });
      res.set('Cache-Control', 'private, max-age=300');
      return res.json(result);
    } catch (err) {
      if (err instanceof LookupError) {
        logger.warn('lookup_failed', { number, code: err.code, message: err.message });
        return res.status(err.status).json({ status: 'error', code: err.code, message: err.message });
      }
      logger.error('lookup_unexpected', { number, message: err.message, stack: err.stack });
      return res.status(500).json({ status: 'error', code: 'lookup_failed', message: 'Lookup failed' });
    }
  });

  router.get('/health', (_req, res) => {
    res.json({ status: 'ok', cache: cache.kind, time: new Date().toISOString() });
  });

  router.use((_req, res) => {
    res.status(404).json({ status: 'error', code: 'not_found', message: 'Unknown API route' });
  });

  return router;
}
