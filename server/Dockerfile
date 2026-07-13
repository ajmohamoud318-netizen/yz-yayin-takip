# Production image for the Fastify server.
#
# Two-stage build:
#   1. install   — npm ci with dev deps (none required at runtime yet)
#   2. runtime   — node:20-alpine, only prod deps + the source tree
#
# Dokploy can deploy either this image or use nixpacks against the
# server/ folder. Both paths boot through `npm start`.

FROM node:20-alpine AS install
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund || (echo "lockfile missing; running npm install" && npm install --no-audit --no-fund)

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=install /app/node_modules ./node_modules
COPY . .

EXPOSE 4000
CMD ["npm", "start"]
