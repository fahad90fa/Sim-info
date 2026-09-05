# ---- Stage 1: build the React client -------------------------------------
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci
COPY client client
RUN npm run build --workspace=client

# ---- Stage 2: runtime with Chromium for Puppeteer ------------------------
FROM node:22-bookworm-slim AS runtime
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
       chromium \
       fonts-liberation \
       fonts-noto-core \
       fonts-noto-color-emoji \
       ca-certificates \
       tini \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    PORT=3000 \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    IMAGE_CACHE_DIR=/app/server/cache/images

WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY client/package.json client/
# --omit=optional skips @sparticuz/chromium (only used on Vercel/Lambda); this image uses Debian's Chromium.
RUN npm ci --omit=dev --omit=optional --workspace=server && npm cache clean --force
COPY server server
COPY --from=build /app/client/dist client/dist
RUN mkdir -p /app/server/cache/images && chown -R node:node /app

USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "server/src/index.js"]
