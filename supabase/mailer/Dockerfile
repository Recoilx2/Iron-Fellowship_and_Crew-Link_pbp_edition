# Chat-post email worker: one container per stack copy, no host port.
# Node 22 matches the note server; dependencies are installed from the
# checked-in lockfile so a build is reproducible.
FROM node:22-bookworm-slim
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

COPY render.js worker.js ./

CMD ["node", "worker.js"]
