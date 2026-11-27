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
# Any ruleset id is valid: built-ins get their shipped env file, and an
# operator-supplied id gets a generic fallback whose branding is replaced
# at runtime by the mounted ruleset package.
COPY supabase/site/game-*.env ./site-config/
RUN if [ -f "./site-config/game-${GAME_SYSTEM}.env" ]; then \
      cp "./site-config/game-${GAME_SYSTEM}.env" ./.env.production; \
    else \
      cp ./site-config/game-default.env ./.env.production; \
    fi

ENV VITE_GAME_SYSTEM=${GAME_SYSTEM}
ENV VITE_SUPABASE_URL=${VITE_SUPABASE_URL}
ENV VITE_SUPABASE_ANON_KEY=${VITE_SUPABASE_ANON_KEY}
ENV VITE_CHAT_IMAGE_MAX_MB=${VITE_CHAT_IMAGE_MAX_MB}
RUN npm run build
# Record the baked client cap for the start-time agreement check: the site
# entrypoint compares this against the runtime CHAT_IMAGE_MAX_MB (which the
# bucket follows) and fails the start when they disagree.
RUN echo -n "${VITE_CHAT_IMAGE_MAX_MB:-10}" > ./dist/chat-image-max-mb.txt

FROM nginx:1.27-alpine
COPY supabase/site/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
# Fail the container start when the built client's cap disagrees with the
# deployment setting the bucket follows (ticket #118).
COPY supabase/site/check-image-cap.sh /check-image-cap.sh
RUN chmod +x /check-image-cap.sh
ENTRYPOINT ["/check-image-cap.sh"]
CMD ["nginx", "-g", "daemon off;"]
