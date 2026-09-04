import rateLimit from 'express-rate-limit';
import { config } from '../config.js';

const windowSeconds = Math.ceil(config.rateLimit.windowMs / 1000);
const message = `Too many requests. Please wait ${windowSeconds}s and try again.`;

const base = {
  windowMs: config.rateLimit.windowMs,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
};

/** 10 requests / minute / IP by default for the JSON lookup endpoint. */
export const lookupLimiter = rateLimit({
  ...base,
  limit: config.rateLimit.max,
  message: { status: 'error', code: 'rate_limited', message },
});

/** Server-rendered pages (/print, /share) get their own budget and an HTML error. */
export const pageLimiter = rateLimit({
  ...base,
  limit: config.rateLimit.imageMax,
  handler: (_req, res) => {
    res.status(429).render('error', { title: 'Too many requests', message });
  },
});

/** Separate, slightly looser limit for the expensive image renderer. */
export const imageLimiter = rateLimit({
  ...base,
  limit: config.rateLimit.imageMax,
  handler: (_req, res) => {
    res.status(429).type('text/plain').send(message);
  },
});
