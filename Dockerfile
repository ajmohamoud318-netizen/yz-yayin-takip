# Production image for the YZ Yayın Takip SPA (Dokploy frontend app).
#
# Mirrors the Nixpacks flow (root nixpacks.toml): build the Vite SPA from
# client/, then serve client/dist with the zero-dep serve.cjs shim.
#
# Two-stage build:
#   1. build   — install all workspace deps (incl. devDeps) and run vite build
#   2. runtime — node:20-alpine with just the built dist + serve.cjs
#
# The API is a separate Dokploy app rooted at /server (see server/Dockerfile).

FROM node:20-alpine AS build
WORKDIR /app

# NODE_ENV=production would make npm skip devDeps (rollup is a devDep and vite
# needs it) — keep it unset during install so the build has everything.
ENV NODE_ENV=development

# Root manifests + workspace manifests first for better layer caching.
COPY package.json package-lock.json* ./
COPY client/package.json ./client/package.json
COPY server/package.json ./server/package.json

# npm install (not ci) is intentional: npm's optional-dep handling (npm/cli#4828)
# can drop the platform-specific rollup binary on `npm ci` in workspaces.
RUN npm install --no-audit --no-fund --include=dev

# Now the rest of the source and build the SPA (outputs to client/dist).
COPY . .
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

# Only what the runtime needs: the built assets and the static server shim.
COPY --from=build /app/client/dist ./client/dist
COPY --from=build /app/serve.cjs ./serve.cjs

EXPOSE 3000
CMD ["node", "serve.cjs"]
