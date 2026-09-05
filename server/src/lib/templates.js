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
import { config } from '../config.js';

const read = (url) => fs.readFileSync(url, 'utf8');
const compile = (url) => ejs.compile(read(url), { filename: fileURLToPath(url) });

const viewFiles = {
  print: new URL('../../templates/print.ejs', import.meta.url),
  share: new URL('../../templates/share.ejs', import.meta.url),
  card: new URL('../../templates/card.ejs', import.meta.url),
  error: new URL('../../templates/error.ejs', import.meta.url),
};
const assetFiles = {
  'print.css': { url: new URL('../../public/print.css', import.meta.url), type: 'text/css' },
  'print.js': { url: new URL('../../public/print.js', import.meta.url), type: 'application/javascript' },
};

// Compiled once at startup. Outside production they are re-read on every use
// so template/CSS edits show up without restarting the dev server.
const views = Object.fromEntries(Object.entries(viewFiles).map(([name, url]) => [name, compile(url)]));
const assetBodies = Object.fromEntries(Object.entries(assetFiles).map(([name, a]) => [name, read(a.url)]));

/** Render a named view to an HTML string. */
export function render(name, data = {}) {
  const url = viewFiles[name];
  if (!url) throw new Error(`Unknown view: ${name}`);
  const template = config.isProduction ? views[name] : compile(url);
  return template(data);
}

/** Print-page assets served from memory: { 'print.css': { body, type }, ... } */
export const assets = Object.fromEntries(
  Object.entries(assetFiles).map(([name, a]) => [
    name,
    {
      type: a.type,
      get body() {
        return config.isProduction ? assetBodies[name] : read(a.url);
      },
    },
  ]),
);

/** Express helper: `res.page('print', data)` sends rendered HTML. */
export function pageResponder(req, res, next) {
  res.page = (name, data) => {
    res.type('html').send(render(name, data));
    return res;
  };
  next();
}
