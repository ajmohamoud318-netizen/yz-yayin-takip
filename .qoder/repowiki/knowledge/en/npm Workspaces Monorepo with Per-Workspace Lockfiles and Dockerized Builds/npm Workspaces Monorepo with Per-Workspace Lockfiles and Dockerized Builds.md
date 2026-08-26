---
kind: dependency_management
name: npm Workspaces Monorepo with Per-Workspace Lockfiles and Dockerized Builds
category: dependency_management
scope:
    - '**'
source_files:
    - package.json
    - package-lock.json
    - client/package.json
    - client/package-lock.json
    - server/package.json
    - server/package-lock.json
    - yz-logo-animation/package.json
    - Dockerfile
    - docker-compose.yml
---

## System / Approach

The repository is an **npm workspaces monorepo** that groups the Vite/React SPA (`client/`) and the Fastify API server (`server/`) under a single root `package.json`. A third workspace, `yz-logo-animation/`, exists as an independent npm package (Remotion-based) but is **not** registered in the root workspaces list — it maintains its own `package.json` and `package-lock.json`.

Dependency resolution uses the standard npm registry; no private registries, `.npmrc` overrides, or vendoring are present. Deterministic installs are enforced via lockfiles at both the root (`package-lock.json`, lockfileVersion 3) and each workspace (`client/package-lock.json`, `server/package-lock.json`).

## Key Files

- `package.json` (root): declares `workspaces: ["client", "server"]` and top-level scripts that delegate to `npm --workspace <name> run ...` for dev, build, test, migrate, seed.
- `client/package.json`: client dependencies (React, Radix UI, Tailwind, Vite, Vitest, Playwright, etc.) plus an `optionalDependencies` entry for `@rollup/rollup-linux-x64-gnu` pinned to avoid a known Nixpacks issue.
- `server/package.json`: server runtime dependencies (Fastify, pg, ioredis, bcryptjs, nodemailer, web-push, etc.) with an `engines.node >= 20` constraint.
- `yz-logo-animation/package.json`: standalone Remotion package with its own dependency set.
- `package-lock.json` (root): workspace-aware lockfile that records the resolved versions for both `client` and `server` packages.
- `server/package-lock.json`: separate lockfile for the server workspace.
- `Dockerfile` (root): two-stage production build — `node:20-alpine` build stage runs `npm install --no-audit --no-fund --include=dev` across workspaces then `npm run build`; runtime stage copies only `client/dist` and `serve.cjs`.
- `docker-compose.yml`: local dev stack that boots Postgres, the Fastify server, and the Vite dev server; the client container runs `npm ci --no-audit --no-fund && npm run dev -- --host` inside a mounted `./client` volume.

## Architecture & Conventions

1. **Workspace scoping**: Each subproject owns its own `package.json` and `package-lock.json`. The root only orchestrates via workspaces and shared scripts; it has no direct dependencies of its own.
2. **Version ranges**: All declared dependencies use caret ranges (`^x.y.z`), allowing minor/patch updates within the major version. There are no exact pinning conventions in `package.json` files.
3. **Node engine pinning**: The server workspace declares `engines.node >= 20`, which is mirrored by the Docker images (`node:20-alpine`) used in both the root `Dockerfile` and `docker-compose.yml`.
4. **Dev vs runtime separation**: The client separates tooling into `devDependencies` (Vite, Vitest, Tailwind, Playwright, PostCSS, jsdom). The server keeps only runtime deps in `dependencies`; tests run via Node's built-in `--test` runner against `src/**/*.test.js` without a test framework dependency.
5. **Optional native binaries**: The client pins `@rollup/rollup-linux-x64-gnu` under `optionalDependencies` with a comment explaining this avoids `npm/cli#4828` where `npm ci` drops platform-specific rollup binaries in workspaces. The root `Dockerfile` intentionally uses `npm install` instead of `npm ci` for the same reason.
6. **Build-time env isolation**: The root `Dockerfile` sets `NODE_ENV=development` during `npm install` so devDeps are installed, then overrides to `NODE_ENV=production` only for `npm run build` to prevent Vite from inlining the development React bundle into the shipped assets.
7. **No vendoring**: There is no `vendor/`, `lib/`, or checked-in `node_modules/` beyond the workspace roots' generated trees. Dependencies are always fetched from the public npm registry.
8. **Separate deployment surfaces**: The root `Dockerfile` builds only the SPA and serves it statically via `serve.cjs`; the server has its own `server/Dockerfile` (referenced by `docker-compose.yml`) and is deployed separately on Dokploy. This means dependency installation and runtime environments are split per service.

## Constraints & Rules Observed

- **Lockfiles are committed**: Both `package-lock.json` files are tracked, ensuring reproducible installs across environments.
- **Workspace-only orchestration**: New packages must be added as a sibling directory and explicitly listed in the root `package.json` `workspaces` array to participate in the monorepo script surface.
- **Node version gate**: The server enforces `>= 20` via `engines`; all containers target `node:20-alpine`, so any change requires updating both `server/package.json` and the Docker images.
- **No private registry configuration**: No `.npmrc` file exists at the root or in any workspace; all packages resolve from the default npm registry.
- **Dev-only tools stay in devDependencies**: Testing frameworks, bundlers, and CSS tooling are never promoted to runtime dependencies, keeping production images minimal.
- **Migrations and seeding are npm scripts**: Database schema changes live in `server/db/migrations/*.sql` and are applied via `npm --workspace server run migrate`, not through a separate CLI tool.