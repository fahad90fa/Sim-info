import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

let fileStream = null;
if (config.logFile) {
  const target = path.resolve(config.paths.serverRoot, config.logFile);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fileStream = fs.createWriteStream(target, { flags: 'a' });
}

function write(level, event, fields = {}) {
  const line = JSON.stringify({ time: new Date().toISOString(), level, event, ...fields });
  if (level === 'error') process.stderr.write(`${line}\n`);
  else process.stdout.write(`${line}\n`);
  if (fileStream && event === 'lookup') fileStream.write(`${line}\n`);
}

export const logger = {
  info: (event, fields) => write('info', event, fields),
  warn: (event, fields) => write('warn', event, fields),
  error: (event, fields) => write('error', event, fields),
  /** Analytics record for each lookup (number, timestamp, client IP). */
  lookup: (fields) => write('info', 'lookup', fields),
};

export default logger;
