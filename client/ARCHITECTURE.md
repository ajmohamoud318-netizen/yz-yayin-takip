# Clean Architecture

YZ Yayın Takip follows [Clean Architecture](https://blog.cleancoder.com/uncle-bob/2012/08/13/the-clean-architecture.html): dependencies point inward. Inner layers know nothing about React, Axios, or localStorage.

## Layer diagram

```
┌─────────────────────────────────────────────────────────────┐
│  Presentation (outer)                                       │
│  pages/ · components/ · hooks/                              │
│  Imports: api.js facade only                                │
└───────────────────────────┬─────────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────┐
│  api.js — composition-root facade                           │
└───────────────────────────┬─────────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────┐
│  Application                                                │
│  create-api.js · use-cases/ · mappers/ · ports/             │
└───────────────────────────┬─────────────────────────────────┘
                            │
          ┌─────────────────┴─────────────────┐
          ▼                                   ▼
┌─────────────────────┐           ┌─────────────────────┐
│  Domain (inner)     │           │  Infrastructure     │
│  domain/            │           │  infrastructure/    │
│  Pure rules & types │◄──────────│  mock/ · http/        │
│  Zero framework deps│  implements│  Axios, localStorage │
└─────────────────────┘           └─────────────────────┘
```

## Folder map

| Path | Layer | Responsibility |
|------|-------|----------------|
| `domain/constants/` | Domain | Stages, pipelines, labels, status colors |
| `domain/services/` | Domain | `subtaskProgress`, `statusKeyForProject`, pipeline rules |
| `application/ports/` | Application | Repository interfaces (JSDoc) |
| `application/mappers/` | Application | `createProjectMapper` — payload/detail transforms |
| `application/use-cases/` | Application | Cross-aggregate orchestration (e.g. `advance-order-request`) |
| `application/create-api.js` | Application | Wires repos + use cases into the `api` object |
| `infrastructure/config.js` | Infrastructure | `USE_MOCK` flag |
| `infrastructure/http/client.js` | Infrastructure | Axios instance + auth header |
| `infrastructure/mock/store.js` | Infrastructure | In-memory state + localStorage |
| `infrastructure/mock/seed/` | Infrastructure | Demo seed data |
| `infrastructure/mock/repositories/` | Infrastructure | Per-aggregate mock (+ HTTP fallback) repos |
| `infrastructure/mock/helpers/` | Infrastructure | `mockOrHttp`, errors, form hydration |
| `api.js` | Facade | Single import point for the UI |
| `pages/`, `components/`, `hooks/` | Presentation | React UI |

## Repositories

| Repository | Methods |
|------------|---------|
| `mock-auth.repository` | `login`, `logout` |
| `mock-user.repository` | `listUsers`, `inviteUser`, `setUserActive`, `findById` |
| `mock-project.repository` | CRUD, stage transitions, `recordOrderHistory` |
| `mock-subtask.repository` | toggle, pages, updates, save list |
| `mock-demo.repository` | `listDemos`, `createDemo` |
| `mock-order.repository` | `list`, `create`, `update`, store helpers |

## Use cases

| Use case | Why separate from repo |
|----------|------------------------|
| `advance-order-request` | Updates order **and** linked project history/stage |

## Dependency rule

- **Domain** imports nothing from other layers.
- **Application** imports domain; use cases receive repos via constructor injection.
- **Infrastructure** implements repositories; knows about Axios and localStorage.
- **Presentation** imports `api.js` only.

## Switching to the real backend

1. Set `USE_MOCK = false` in `infrastructure/config.js`.
2. Add `infrastructure/http/*-repository.js` (HTTP-only, no mock branch).
3. Branch in `application/create-api.js` to wire HTTP repos instead of mock repos.
4. Drop mock `localStorage` auth in `useAuth.js` when httpOnly cookies land.

## Migration status

- [x] Domain constants and pure services extracted
- [x] Mock store + seed data separated
- [x] HTTP client isolated
- [x] Per-aggregate mock repositories
- [x] Project mapper in application layer
- [x] Cross-aggregate use case (`advance-order-request`)
- [x] Composition root (`create-api.js`)
- [ ] HTTP-only repositories (when backend ships)
- [ ] More use cases for complex project flows
- [ ] Backend (Fastify + PostgreSQL + Redis) per `CLAUDE.md`

## Adding a feature (example: new approval step)

1. Add stage constant in `domain/constants/stages.js`.
2. Add transition rule in `domain/services/pipeline.js`.
3. Add method to `mock-project.repository.js` (+ HTTP fallback).
4. Expose via `application/create-api.js`.
5. Call through `api.js` from a hook or page.
