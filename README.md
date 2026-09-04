# SIM Info · Phone Number Lookup

A full‑stack web app for looking up Pakistani and Indian phone numbers through the
`7u6959.af7u76.workers.dev` lookup API. It shows the names and photos linked to a
number, produces a clean printable report, and generates a shareable
1200×630 social‑card image with Open Graph metadata.

| Search | Result |
| --- | --- |
| ![Home](docs/screenshots/home.png) | ![Result](docs/screenshots/result.png) |

| Share modal | Generated social card (`/image/:number`) |
| --- | --- |
| ![Share](docs/screenshots/share-modal.png) | ![Card](docs/screenshots/social-card.png) |

More screenshots (mobile layout, print page) are in [`docs/screenshots`](docs/screenshots).

## Features

- **Search** – enter a number in any format (`0332-040 7479`, `+92 332 0407479`); the
  app strips everything except digits before calling the API.
- **Result card** – phone number, every name as a badge, image thumbnails with a lightbox.
- **Print** – `/print/:number` is a minimal server‑rendered page with `@media print`
  rules (A4 page setup, large type, no chrome). Add `?auto=1` to open the print dialog
  automatically.
- **Share image** – `/image/:number` renders a branded 1200×630 PNG with headless
  Chrome (Puppeteer). `/share/:number` wraps it in a page with Open Graph / Twitter
  card tags so links unfurl with the image on WhatsApp, Facebook, X, Slack, etc.
- **Caching** – lookup results are cached for 7 days (Redis if `REDIS_URL` is set,
  otherwise in‑memory `node-cache`). Generated images are cached on disk and in memory.
- **Rate limiting** – 10 lookups / minute / IP by default, with a separate budget for
  the page and image routes. Clients receive standard `RateLimit-*` headers.
- **Resilience** – upstream timeouts, 5xx responses and malformed JSON become
  structured `{ status: "error", code, message }` responses; concurrent lookups of the
  same number are coalesced into one upstream call.
- **Security** – strict input validation, Helmet security headers with a CSP,
  EJS auto‑escaping, optional CORS allow‑list, no `x-powered-by`.
- **Logging** – JSON lines on stdout; each lookup (number, timestamp, client IP) can
  also be appended to `LOG_FILE` for analytics.

## Tech stack

| Layer | Choice |
| --- | --- |
| Backend | Node.js 20+, Express 5, EJS templates |
| Frontend | React 19, Vite 7, Tailwind CSS 4 |
| Cache | Redis (ioredis) or in‑memory `node-cache` |
| Images | Puppeteer (`puppeteer-core`) + system Chromium |
| Deployment | Dockerfile (multi‑stage) + `docker-compose.yml` with Redis |

## Project layout

```
.
├── client/                 # React SPA (Vite + Tailwind)
│   └── src/
│       ├── App.jsx         # search flow, state, modals
│       ├── components/     # SearchForm, ResultCard, ShareImageModal, Lightbox, ErrorBanner
│       └── lib/            # api.js (fetch wrapper), phone.js (formatting)
├── server/
│   ├── src/
│   │   ├── index.js        # entry point (boot, graceful shutdown)
│   │   ├── app.js          # Express app factory (helmet, routes, static, SPA fallback)
│   │   ├── config.js       # .env parsing
│   │   ├── routes/         # api.js (/api/lookup), pages.js (/print, /share), image.js (/image)
│   │   ├── lib/            # lookup client, cache, Puppeteer renderer, phone utils, logger
│   │   └── middleware/     # rate limiters
│   ├── views/              # print.ejs, share.ejs, card.ejs (social card), error.ejs
│   ├── public/             # print.css, print.js
│   └── test/               # node:test suites
├── docs/screenshots/
├── Dockerfile
├── docker-compose.yml
└── .env.example
```

## Quick start (local)

Requirements: Node.js 20+ and a Chrome/Chromium binary for image generation
(auto‑detected on Linux/macOS/Windows in the usual locations; otherwise set
`PUPPETEER_EXECUTABLE_PATH`).

```bash
git clone <this repo> && cd sim-info
cp .env.example .env          # adjust if needed
npm install                   # installs server + client workspaces

# Development: Express on :3000 and Vite dev server on :5173 (with API proxy)
npm run dev
# open http://localhost:5173

# Production build: bundle the client, then serve everything from Express
npm run build
npm start
# open http://localhost:3000
```

If you cannot reach the upstream API (or want deterministic data), set
`LOOKUP_MOCK=true` in `.env`. The mock knows `03320407479`, `03001234567` and
`919876543210`; any other number returns an empty result.

### Tests

```bash
npm test                 # unit + HTTP integration tests (mock upstream, no browser needed)
TEST_IMAGE=1 npm test    # also renders a real PNG with Chromium
```

## Docker

```bash
cp .env.example .env
docker compose up --build -d
# open http://localhost:3000
```

The compose file starts the app plus a Redis container (`REDIS_URL` is set for you)
and persists generated images and Redis data in named volumes. The image bundles
Debian's Chromium and Noto fonts (including colour emoji, which appear in names such
as `Fahad ☠️`).

Run without Redis:

```bash
docker build -t sim-info .
docker run --rm -p 3000:3000 --shm-size=512m --env-file .env sim-info
```

Behind a reverse proxy (nginx, Caddy, Cloudflare), set `TRUST_PROXY=1` so the rate
limiter and logs see the real client IP, and set `PUBLIC_BASE_URL` to your public
origin so `og:image` URLs are absolute.

## Configuration

All settings live in `.env` (see [`.env.example`](.env.example)).

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port |
| `NODE_ENV` | `development` | `production` enables view caching and long static cache headers |
| `TRUST_PROXY` | `0` | Express `trust proxy` setting (`1`, `true`, or a list like `loopback, 10.0.0.0/8`) |
| `PUBLIC_BASE_URL` | request origin | Absolute origin used in Open Graph tags |
| `CORS_ORIGIN` | empty | Comma‑separated origins allowed to call `/api` cross‑origin |
| `LOOKUP_API_URL` | `https://7u6959.af7u76.workers.dev/` | Upstream API |
| `LOOKUP_TIMEOUT_MS` | `10000` | Upstream request timeout |
| `LOOKUP_MOCK` | `false` | Serve fixture data instead of calling upstream |
| `CACHE_TTL_SECONDS` | `604800` (7 days) | Lookup result TTL |
| `REDIS_URL` | empty | e.g. `redis://redis:6379`; empty = in‑memory cache |
| `IMAGE_CACHE_DIR` | `./cache/images` | Where PNG cards are stored |
| `IMAGE_CACHE_TTL_SECONDS` | `604800` | Image TTL |
| `RATE_LIMIT_WINDOW_MS` | `60000` | Rate‑limit window |
| `RATE_LIMIT_MAX` | `10` | Lookups per window per IP |
| `IMAGE_RATE_LIMIT_MAX` | `20` | `/image`, `/print`, `/share` requests per window per IP |
| `PUPPETEER_EXECUTABLE_PATH` | auto‑detect | Chrome/Chromium binary |
| `IMAGE_RENDER_CONCURRENCY` | `2` | Max simultaneous headless renders |
| `LOG_FILE` | empty | Append lookup analytics as JSON lines to this file |

## HTTP API

### `GET /api/lookup?number=<phone>`

Cleans the input (digits only, 7–15 digits), serves from cache when possible, otherwise
calls the upstream API and caches the normalised result.

```json
{
  "status": "ok",
  "number": "03320407479",
  "names": ["Fahad Jojo", "Fahad Jojo Pgc", "Fahad ☠️", "Fahad colony"],
  "images": [],
  "results": [{ "number": "03320407479", "names": ["..."], "images": [] }],
  "upstreamStatus": "success",
  "fetchedAt": "2026-09-04T19:07:38.441Z",
  "cached": false
}
```

Errors are always JSON:

| HTTP | `code` | When |
| --- | --- | --- |
| 400 | `invalid_number` | Not 7–15 digits after cleaning |
| 429 | `rate_limited` | Too many requests from this IP |
| 502 | `network` / `upstream_error` / `invalid_response` | Upstream unreachable, 5xx, or bad JSON |
| 503 | `upstream_rate_limited` | Upstream returned 429 |
| 504 | `timeout` | Upstream did not answer within `LOOKUP_TIMEOUT_MS` |

### `GET /print/:number`

Print‑optimised HTML (links `/print.css`). `?auto=1` triggers `window.print()` on load.

### `GET /image/:number`

1200×630 PNG social card. `?download=1` adds a `Content-Disposition: attachment`
header. The `X-Image-Cache: hit|miss` header tells you whether it was rendered fresh.

### `GET /share/:number`

HTML page with `og:*` and `twitter:*` tags whose image is `/image/:number`; links back
to the app with the number pre‑filled (`/?number=…`).

### `GET /api/health`

`{ "status": "ok", "cache": "memory" | "redis", "time": "…" }`

## Notes

- Numbers are looked up exactly as typed (after removing non‑digits). `03320407479` and
  `923320407479` are different cache keys because the upstream API treats them as
  different queries.
- Image rendering opens one shared Chromium instance lazily and reuses it; if it
  crashes it is relaunched on the next request.
- Out of scope, as specified: accounts, batch lookups, analytics dashboards.
