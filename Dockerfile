# Production image for the YZ Yayın Takip SPA (Dokploy frontend app).
#
# Build the Vite SPA from client/, then serve client/dist with the zero-dep
# serve.cjs shim. This is the only build path for the SPA — the old
# Nixpacks configs were dropped once Dokploy moved to Dockerfile builds.
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
#
# This applies to `npm install` ONLY. `vite build` must NOT inherit it: Vite
# inlines process.env.NODE_ENV into the bundle from this variable (not from
# the build mode), so NODE_ENV=development ships React's *development* build
# — dev warnings, no prod optimisations, ~280 kB of extra JS, and StrictMode
# double-invoking every mount effect (which fired GET /auth/me twice on load).
# The build step below overrides it back to production.
ENV NODE_ENV=development

# Vite only inlines env vars that are explicitly exposed at build time.
# Dokploy passes this as a build-time arg (see "Build-time Arguments" in
# the service config). Without this ARG, the bundle is built with the
# empty/default value of VITE_API_BASE_URL and the SPA can never reach
# the API.
ARG VITE_API_BASE_URL
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}

# Root manifests + workspace manifests first for better layer caching.
COPY package.json package-lock.json* ./
COPY client/package.json ./client/package.json
COPY server/package.json ./server/package.json

# npm install (not ci) is intentional: npm's optional-dep handling (npm/cli#4828)
# can drop the platform-specific rollup binary on `npm ci` in workspaces.
RUN npm install --no-audit --no-fund --include=dev

# Now the rest of the source and build the SPA (outputs to client/dist).
# NODE_ENV=production is set per-command (not via ENV) so it only affects the
# build, leaving the install layer above — and its devDeps — untouched.
COPY . .
RUN NODE_ENV=production npm run build

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
