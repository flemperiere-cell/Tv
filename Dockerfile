FROM node:24-alpine AS build

RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build
RUN npm prune --omit=dev

FROM node:24-alpine AS production

RUN apk add --no-cache nginx supervisor libstdc++ libgcc \
  && addgroup -S app \
  && adduser -S -u 10001 -G app app \
  && mkdir -p /data /run/nginx /var/log/supervisor /usr/share/nginx/html/tv \
  && chown -R app:app /data
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/server/migrations ./server/migrations
COPY --from=build /app/dist/ /usr/share/nginx/html/tv/
COPY deploy/nginx.conf /etc/nginx/nginx.conf
COPY deploy/supervisord.conf /etc/supervisord.conf
COPY --chmod=755 deploy/entrypoint.sh /entrypoint.sh

ENV DATABASE_PATH=/data/media.sqlite \
  LISTEN_HOST=127.0.0.1 \
  PORT=3000 \
  TMDB_LANGUAGE=fr-FR \
  LOG_LEVEL=info
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "Promise.all([fetch('http://127.0.0.1/tv/').then(r=>r.ok),fetch('http://127.0.0.1/tv/api/v1/health').then(r=>r.ok)]).then(v=>process.exit(v.every(Boolean)?0:1)).catch(()=>process.exit(1))"
CMD ["/entrypoint.sh"]
