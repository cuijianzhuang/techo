# techo on a VPS: the Worker (src/) under Node, its data in /data (docs/deploy-vps.md).
# Cloudflare doesn't use this file: it deploys with wrangler (docs/deploy.md).
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY src ./src
COPY server ./server
RUN npm run build:server

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production DATA_DIR=/data PORT=8787 HOST=0.0.0.0
# the server is one file with everything it needs bundled in; public/ is built and checked in
COPY --from=build /app/dist ./dist
COPY public ./public
COPY schema.sql ./
COPY migrations ./migrations
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 8787
HEALTHCHECK --interval=60s --timeout=5s --start-period=10s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/api/settings').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "--disable-warning=ExperimentalWarning", "dist/server.mjs"]
