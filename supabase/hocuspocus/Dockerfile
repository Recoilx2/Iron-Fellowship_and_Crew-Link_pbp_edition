# Hocuspocus note server: live Yjs documents for shared note editing.
#
# Built per stack copy from this directory (no registry publish, no host
# port): browsers reach it only through the API gateway at /hocuspocus/.
# Needs Node 22 or newer (Hocuspocus v4).
FROM node:22-bookworm-slim
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

COPY server.js note-access.js ./

ENV PORT=1234
EXPOSE 1234
CMD ["node", "server.js"]
