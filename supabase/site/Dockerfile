# Site container: serves the built site for one configured game system.
#
# Built per stack copy with:
#   docker compose -p <copy> --env-file <copy env> build site
# where the copy's env file sets GAME_SYSTEM (ironsworn|starforged) and the
# gateway URL/anon key the browser uses. Branding and theme follow the game
# system baked in here (see game-ironsworn.env / game-starforged.env).
ARG GAME_SYSTEM=ironsworn

FROM node:24-bookworm-slim AS build
WORKDIR /app

ARG GAME_SYSTEM
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ARG VITE_CHAT_IMAGE_MAX_MB=10

COPY package.json package-lock.json ./
# The root postinstall (scripts/cleanup-dicebox-assets.cjs) runs as part of
# `npm ci`, so the script must exist before installing. Copying only this
# keeps the layer cache for dependencies intact.
COPY scripts/ ./scripts/
RUN npm ci --no-audit --no-fund

COPY . ./
# Per-system branding (title, favicon, opengraph) plus VITE_GAME_SYSTEM.
# Unknown GAME_SYSTEM values fail the build here.
COPY supabase/site/game-${GAME_SYSTEM}.env ./.env.production

ENV VITE_SUPABASE_URL=${VITE_SUPABASE_URL}
ENV VITE_SUPABASE_ANON_KEY=${VITE_SUPABASE_ANON_KEY}
ENV VITE_CHAT_IMAGE_MAX_MB=${VITE_CHAT_IMAGE_MAX_MB}
RUN npm run build

FROM nginx:1.27-alpine
COPY supabase/site/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
