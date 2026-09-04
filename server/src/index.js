import { config } from './config.js';
import { createApp } from './app.js';
import { createCache } from './lib/cache.js';
import { closeBrowser } from './lib/imageRenderer.js';
import { logger } from './lib/logger.js';

const cache = await createCache();
const app = createApp({ cache });

const server = app.listen(config.port, () => {
  logger.info('server_listening', {
    port: config.port,
    env: config.nodeEnv,
    mock: config.lookup.mock,
    cache: cache.kind,
  });
});

async function shutdown(signal) {
  logger.info('shutting_down', { signal });
  server.close();
  await Promise.allSettled([closeBrowser(), cache.close()]);
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
