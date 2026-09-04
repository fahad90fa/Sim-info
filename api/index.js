/**
 * Vercel serverless entry point (Root Directory = repository root).
 *
 * vercel.json rewrites every non-static request here. Vercel's Node launcher
 * accepts an Express app as the default export and calls it as (req, res).
 * The cache backend connects lazily on the first request.
 */
export { default } from '../server/src/app.js';
