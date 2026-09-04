/**
 * Vercel serverless entry point.
 *
 * Every non-static request is rewritten here (see vercel.json) and handed to
 * the same Express app that `server/src/index.js` runs locally. The app and its
 * cache are created once per function instance and reused across invocations.
 */
import { createApp } from '../server/src/app.js';
import { createCache } from '../server/src/lib/cache.js';

let appPromise = null;

function getApp() {
  if (!appPromise) {
    appPromise = (async () => {
      const cache = await createCache();
      return createApp({ cache });
    })().catch((err) => {
      appPromise = null; // let the next invocation retry a failed boot
      throw err;
    });
  }
  return appPromise;
}

export default async function handler(req, res) {
  const app = await getApp();
  return app(req, res);
}
