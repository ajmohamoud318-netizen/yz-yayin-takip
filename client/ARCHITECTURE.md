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
                            ▼
┌─────────────────────┐   ┌──────────────────────────────────┐
│  Domain (inner)     │   │  Infrastructure                  │
│  domain/            │   │  infrastructure/                 │
│  Pure rules & types │◄──│    http/   (Axios + repos)       │
│  Zero framework deps│   │    shared/ (errors, uid)         │
└─────────────────────┘   └──────────────────────────────────┘
```

## Folder map

| Path | Layer | Responsibility |
|------|-------|----------------|
| `domain/constants/` | Domain | Stages, pipelines, labels, status colors |
| `domain/services/` | Domain | `subtaskProgress`, `statusKeyForProject`, pipeline rules |
| `application/ports/` | Application | Repository interfaces (JSDoc) |
| `application/mappers/` | Application | `createProjectMapper` — payload/detail transforms |
| `application/use-cases/` | Application | Cross-aggregate orchestration (orders, handovers) |
| `application/create-api.js` | Application | Wires HTTP repos + use cases into the `api` object |
| `infrastructure/http/client.js` | Infrastructure | Axios instance + auth header |
| `infrastructure/http/repositories/` | Infrastructure | One HTTP repo per aggregate (auth, users, projects, …) |
| `infrastructure/shared/` | Infrastructure | `errors.js`, `uid.js` — used by repos and use cases |
| `api.js` | Facade | Single import point for the UI |
| `pages/`, `components/`, `hooks/` | Presentation | React UI |

## Repositories

| Repository | Methods |
|------------|---------|
| `http-auth.repository` | login, logout, invite preview/accept, forgot/reset, avatar |
| `http-user.repository` | list, invite, activate/deactivate, capabilities, delete |
| `http-project.repository` | CRUD, advance/approve/reject, `recordOrderHistory` |
| `http-subtask.repository` | toggle, pages, updates, save list |
| `http-demo.repository` | `listDemos`, `createDemo` |
| `http-order.repository` | list, create, update, store helpers |
| `http-handover.repository` | list, create, confirm |

## Use cases

| Use case | Why separate from repo |
|----------|------------------------|
| `advance-order-request` | HTTP wrapper around `/order-requests/:id/advance` |
| `reject-order-request` | HTTP wrapper around `/order-requests/:id/reject` |
| `create-order-request` | HTTP wrapper around `POST /order-requests` |
| `create-handover` / `confirm-handover` | HTTP wrappers for the teslim flow |

The cross-aggregate state-machine guards (assignee validation, progress
gate, role ownership) live server-side in `server/src/domain/transitions.js`.

## Dependency rule

- **Domain** imports nothing from other layers.
- **Application** imports domain; use cases wire repos + the HTTP client.
- **Infrastructure** implements repositories; knows about Axios.
- **Presentation** imports `api.js` only.

## Adding a feature (example: new approval step)

1. Add the stage constant in `domain/constants/stages.js`.
2. Add the transition rule in `domain/services/pipeline.js`.
3. Add the endpoint on the server (`server/src/routes/projects.js`) +
   corresponding repo method (`http-project.repository.js`).
4. Expose via `application/create-api.js`.
5. Call through `api.js` from a hook or page.
