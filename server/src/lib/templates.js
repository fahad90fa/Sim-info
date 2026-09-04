/**
 * Server-rendered templates and print assets, loaded once at startup.
 *
 * The files are read with explicit `new URL(..., import.meta.url)` paths so
 * bundlers and serverless tracers (Vercel's @vercel/nft) include them in the
 * function automatically - no `includeFiles` configuration or Express view
 * lookup needed at runtime. (The directory is deliberately not called
 * `views/`: Vercel's Express preset treats `views/**` specially and the files
 * then never reach the function bundle.)
 */
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import ejs from 'ejs';

const read = (url) => fs.readFileSync(url, 'utf8');
const compile = (url) => ejs.compile(read(url), { filename: fileURLToPath(url) });

const views = {
  print: compile(new URL('../../templates/print.ejs', import.meta.url)),
  share: compile(new URL('../../templates/share.ejs', import.meta.url)),
  card: compile(new URL('../../templates/card.ejs', import.meta.url)),
  error: compile(new URL('../../templates/error.ejs', import.meta.url)),
};

export const assets = {
  'print.css': { body: read(new URL('../../public/print.css', import.meta.url)), type: 'text/css' },
  'print.js': { body: read(new URL('../../public/print.js', import.meta.url)), type: 'application/javascript' },
};

/** Render a named view to an HTML string. */
export function render(name, data = {}) {
  const template = views[name];
  if (!template) throw new Error(`Unknown view: ${name}`);
  return template(data);
}

/** Express helper: `res.page('print', data)` sends rendered HTML. */
export function pageResponder(req, res, next) {
  res.page = (name, data) => {
    res.type('html').send(render(name, data));
    return res;
  };
  next();
}
