# Сборка фронтенда и раздача через Caddy.
FROM node:20-slim AS build
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /src
COPY . .
RUN pnpm install --no-frozen-lockfile && pnpm --filter @stats/web build

FROM caddy:2.8-alpine
COPY infra/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /src/apps/web/dist /srv/www
