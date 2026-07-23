# Code Audit — Cleanliness & Dead Code
_Date: 2026-07-23 · Scope: `client/src`, `server/src`, `server/db` (~25,000 lines JS/JSX)_

## Overall verdict

The codebase is in good shape. The layered architecture described in CLAUDE.md is actually followed: business rules live in `domain/` (pure, tested), data access goes through `application/` use-cases and `infrastructure/` repositories, and components don't hardcode stage/role logic. Only 5 `console.log` calls exist, all in server ops scripts (migrate/seed/mail dev mode) where they belong. One TODO in the whole tree. Naming and file organization are consistent. The main issues are a broken server test script, ~10 dead files, and one large near-duplicate component pair.

## 🔴 Critical: server tests never run

`server/package.json` has:

```json
"test": "node --test src/__tests__/**/*.test.js"
```

but `src/__tests__/` **does not exist**. The 5 real server test files live next to their sources (`src/domain/pipeline.test.js`, `src/services/project-repository.test.js`, etc.), so `npm run test:server` exercises none of them. Fix:

```json
"test": "node --test \"src/**/*.test.js\""
```

## Dead code (verified — no imports anywhere, including lazy/dynamic imports)

**Client — safe to delete:**

| File | Notes |
|---|---|
| `client/src/components/DemoSubmitDialog.jsx` (197 lines) | Superseded by `DemoFormDialog.jsx` |
| `client/src/components/MonthTimeline.jsx` | Not rendered by any page |
| `client/src/components/UnreadAssignmentsToast.jsx` | Its logic was moved to `notification-seen.js` (per comment there); the component itself is orphaned |
| `client/src/components/YearPlanSummary.jsx` (274 lines) | Not imported; `YearPlan.jsx` doesn't use it |
| `client/src/hooks/useTheme.js` | Own comment says theming is disabled, app is light-only |
| `client/src/infrastructure/shared/uid.js` | No consumers |
| `client/src/components/ui/popover.jsx`, `ui/separator.jsx`, `ui/switch.jsx` | Unused shadcn primitives |
| `client/src/domain/constants/subtask.js` | Exports `SUBTASK_KIND`, `SUBTASK_KIND_LABEL`; re-exported via `domain/index.js` but no consumer uses them. Also confusingly named next to `subtasks.js` (which IS used) |

**Client — borderline:** `client/src/application/ports/index.js` is JSDoc typedefs only, never imported. Keep if you value it as interface documentation, otherwise delete.

**Server:**

| Item | Notes |
|---|---|
| `server/src/services/redis.js` | Not imported by any route/service — Redis is a next-pass plan. Deleting it also makes the `ioredis` dependency removable (only `redis.js` imports it) |
| Root `package.json` → `"@fastify/multipart"` | Duplicate — already correctly declared in the server workspace; the root copy is redundant |

## Duplication

`DemoFormDialog.jsx` (619 lines) and `OzalitFormDialog.jsx` (599 lines) are **86% line-identical**. Any bug fixed in one must be manually mirrored in the other. Worth extracting a shared form component parameterized by stage.

Client and server both define stages/orders/pipeline constants (`client/src/domain/` vs `server/src/domain/`). This appears intentional (separate deploys), but it's a drift risk worth noting.

## Oversized files (candidates to split, not urgent)

- `client/src/data/productInfo.js` — 1,449 lines; pure data, consider JSON
- `client/src/components/TalepSignDialog.jsx` — 1,385 lines
- `client/src/pages/ProjectDetail.jsx` — 1,319 lines
- `client/src/components/AppShell.jsx` — 1,182 lines (nav + notifications + shell in one file)
- `client/src/pages/SiparisListesi.jsx` — 968 lines

## Repo hygiene

- 7 `.DS_Store` files scattered through the tree (one inside `client/src/`) — add to `.gitignore` and remove.
- Root clutter tracked in git: `Kiss.json`, `Kiss2.json`, `Celebration Giraffe.json` (duplicates of the copies actually used in `client/public/animations/`), and `MATBAA TAKİP.xlsx` (a working spreadsheet). All deletable from the repo root.
- `client/dist/` build output present on disk (not git-tracked — fine, but ensure it stays ignored).
- Test naming is inconsistent on the client: `__create_project_body.test.js`, `__sanity_parse.test.jsx` at `src/` root with a `__` prefix, while others sit next to sources as `*.test.js`.

## What's clean (for the record)

No unused npm dependencies besides `ioredis` (transitively) and the root `@fastify/multipart`. No commented-out code blocks of note. Rejection-reason rule, stage-transition-via-use-case rule, and progress recalculation all enforced where the docs say they are. Route guards and role navigation match the documented role matrix.
