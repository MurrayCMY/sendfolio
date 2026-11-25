# SendFolio — container image for any Docker host (VPS, Railway, Render, Fly.io, Kubernetes ...).
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine AS run
ENV NODE_ENV=production \
    PORT=8787 \
    STORAGE_DIR=/app/data/files \
    PGLITE_DIR=/app/data/pglite
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --omit=optional && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-server ./dist-server
COPY netlify/database/migrations ./netlify/database/migrations
RUN mkdir -p /app/data && chown -R node:node /app/data
USER node
VOLUME ["/app/data"]
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8787/healthz || exit 1
CMD ["node", "dist-server/index.mjs"]
