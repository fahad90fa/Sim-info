import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

let fileStream = null;
if (config.logFile) {
  try {
    fs.mkdirSync(path.dirname(config.logFile), { recursive: true });
    fileStream = fs.createWriteStream(config.logFile, { flags: 'a' });
    fileStream.on('error', (err) => {
      process.stderr.write(`${JSON.stringify({ level: 'warn', event: 'log_file_error', message: err.message })}\n`);
      fileStream = null;
    });
  } catch (err) {
    process.stderr.write(`${JSON.stringify({ level: 'warn', event: 'log_file_unavailable', file: config.logFile, message: err.message })}\n`);
    fileStream = null;
  }
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
