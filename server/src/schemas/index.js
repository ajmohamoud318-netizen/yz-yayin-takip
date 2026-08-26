/**
 * Fastify JSON schemas for every state-changing route.
 *
 * Centralized so the validation surface is auditable in one place. Each
 * schema mirrors the rules the route used to enforce inline (password ≥ 8
 * chars, role enum, `reason` required on reject, …) — Fastify now
 * short-circuits malformed bodies with a 400 before the handler runs.
 *
 * Fastify's default validation response is
 *   { statusCode: 400, code: 'FST_ERR_VALIDATION', error: 'Bad Request',
 *     message: '<first message>' }
 * which `client/src/infrastructure/http/client.js` already maps to a
 * rejected Error via the response interceptor. No SPA changes needed.
 *
 * Convention:
 *   - `body`/`params`/`querystring` declared only when the route reads them.
 *   - `additionalProperties: false` on POST/PATCH/PUT bodies so unknown
 *     keys are rejected — keeps the contract tight and catches typos in
 *     future SPA code.
 *   - `minLength: 8` for passwords matches the rule the old inline
 *     `badRequest('Şifre en az 8 karakter olmalı.')` enforced.
 *   - IDs are typed as plain `string`; the format check happens in
 *     services that hit the DB.
 */

// ─── shared fragments ──────────────────────────────────────────────────

const userId = { type: 'string', minLength: 1, maxLength: 64 }
const projectId = { type: 'string', minLength: 1, maxLength: 64 }
const password = { type: 'string', minLength: 8, maxLength: 200 }
const role = {
  type: 'string',
  enum: ['team_leader', 'designer', 'printer', 'satis'],
}

const stage = {
  type: 'string',
  enum: [
    'tasarim', 'demo_teslim', 'demo_onay',
    'ozalit_teslim', 'ozalit_onay', 'baski_onay',
    'cin_demo_teslim', 'cin_demo_onay', 'cin_baski_onay',
    'baskida', 'gumruk', 'satista',
  ],
}

const rejectTarget = {
  type: 'string',
  enum: ['matbaa', 'designer', 'reassign'],
}

const subtaskInput = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'kind'],
  properties: {
    title: { type: 'string', minLength: 1, maxLength: 200 },
    kind: { type: 'string', enum: ['check', 'pages', 'sticker-count', 'normal'] },
    total_pages: { type: ['integer', 'null'], minimum: 1, maximum: 100000 },
    total_stickers: { type: ['integer', 'null'], minimum: 1, maximum: 100000 },
  },
}

// ─── auth ──────────────────────────────────────────────────────────────

const authLogin = {
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['email', 'password'],
    properties: {
      email: { type: 'string', format: 'email', maxLength: 320 },
      password: { type: 'string', minLength: 1, maxLength: 200 },
    },
  },
}

const authInvitePreview = {
  querystring: {
    type: 'object',
    additionalProperties: false,
    required: ['token'],
    properties: { token: { type: 'string', minLength: 1, maxLength: 512 } },
  },
}

const authAcceptInvite = {
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['token', 'password'],
    properties: {
      token: { type: 'string', minLength: 1, maxLength: 512 },
      password,
    },
  },
}

const authForgotPassword = {
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['email'],
    properties: {
      email: { type: 'string', format: 'email', maxLength: 320 },
    },
  },
}

const authResetPassword = {
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['token', 'password'],
    properties: {
      token: { type: 'string', minLength: 1, maxLength: 512 },
      password,
    },
  },
}

const authChangePassword = {
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['currentPassword', 'newPassword'],
    properties: {
      currentPassword: { type: 'string', minLength: 1, maxLength: 200 },
      newPassword: password,
    },
  },
}

const authDevLogin = {
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['user_id'],
    properties: { user_id: userId },
  },
}

// ─── users ─────────────────────────────────────────────────────────────

const usersInvite = {
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['name', 'email', 'role'],
    properties: {
      name: { type: 'string', minLength: 1, maxLength: 200 },
      email: { type: 'string', format: 'email', maxLength: 320 },
      role,
    },
  },
}

const userIdParams = {
  params: {
    type: 'object',
    additionalProperties: false,
    required: ['id'],
    properties: { id: userId },
  },
}

// ─── work log ──────────────────────────────────────────────────────────
//
// See migration 026__work_log.sql. Replaces the single `usersSetStatus`
// note from 025 — entries are typed, optionally timed, and there can be
// many per day.

const workLogKind = {
  type: 'string',
  enum: ['baska_proje', 'toplanti', 'idari', 'egitim', 'diger'],
}
// Nullable so the client can explicitly clear a duration it set earlier.
const workLogMinutes = { type: ['integer', 'null'], minimum: 1, maximum: 1440 }
const workLogBody = { type: 'string', minLength: 1, maxLength: 280 }

const workLogListQuery = {
  querystring: {
    type: 'object',
    additionalProperties: false,
    // coerceTypes is off (see server/src/index.js), so a query string
    // arrives as text — validate the pattern here, cast to Number in the
    // route/service instead of relying on AJV's `integer` type.
    properties: { days: { type: 'string', pattern: '^([1-9]|[1-8][0-9]|90)$' } },
  },
}

const workLogCreate = {
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['body'],
    properties: { kind: workLogKind, body: workLogBody, minutes: workLogMinutes },
  },
}

const workLogIdParams = {
  params: {
    type: 'object',
    additionalProperties: false,
    required: ['id'],
    properties: { id: { type: 'string', minLength: 1, maxLength: 64 } },
  },
}

const workLogUpdate = {
  ...workLogIdParams,
  body: {
    type: 'object',
    additionalProperties: false,
    minProperties: 1,
    properties: { kind: workLogKind, body: workLogBody, minutes: workLogMinutes },
  },
}

// ─── target project ideas (Hedef Projeler) ──────────────────────────────
//
// Lightweight idea board on Baskı Listesi. See migration
// 036__target_project_ideas.sql.

// Plain list of URLs — no per-link label. Shared shape for both Hedef
// Projeler ideas and Toplantı meetings.
const linksList = { type: 'array', maxItems: 10, items: { type: 'string', minLength: 1, maxLength: 2000 } }

const targetProjectIdeaCreate = {
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['name'],
    properties: {
      name: { type: 'string', minLength: 1, maxLength: 200 },
      links: linksList,
    },
  },
}

const targetProjectIdeaIdParams = {
  params: {
    type: 'object',
    additionalProperties: false,
    required: ['id'],
    properties: { id: { type: 'string', minLength: 1, maxLength: 64 } },
  },
}

const targetProjectIdeaUpdate = {
  ...targetProjectIdeaIdParams,
  body: {
    type: 'object',
    additionalProperties: false,
    minProperties: 1,
    properties: {
      name: { type: 'string', minLength: 1, maxLength: 200 },
      links: linksList,
    },
  },
}

const targetProjectIdeaImageIdParams = {
  params: {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'imageId'],
    properties: {
      id: { type: 'string', minLength: 1, maxLength: 64 },
      imageId: { type: 'string', minLength: 1, maxLength: 64 },
    },
  },
}

const targetProjectIdeaNoteCreate = {
  ...targetProjectIdeaIdParams,
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['body'],
    properties: { body: { type: 'string', minLength: 1, maxLength: 2000 } },
  },
}

const targetProjectIdeaNoteIdParams = {
  params: {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'noteId'],
    properties: {
      id: { type: 'string', minLength: 1, maxLength: 64 },
      noteId: { type: 'string', minLength: 1, maxLength: 64 },
    },
  },
}

const targetProjectIdeaNoteUpdate = {
  ...targetProjectIdeaNoteIdParams,
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['body'],
    properties: { body: { type: 'string', minLength: 1, maxLength: 2000 } },
  },
}

// ─── meetings (Toplantılar) ──────────────────────────────────────────────
//
// Meeting log activated in the sidebar alongside Hedef Projeler. See
// migration 040__meetings.sql.

const meetingCreate = {
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['title', 'meeting_at'],
    properties: {
      title: { type: 'string', minLength: 1, maxLength: 200 },
      meeting_at: { type: 'string', minLength: 1, maxLength: 64 },
      links: linksList,
      project_id: projectId,
    },
  },
}

const meetingIdParams = {
  params: {
    type: 'object',
    additionalProperties: false,
    required: ['id'],
    properties: { id: { type: 'string', minLength: 1, maxLength: 64 } },
  },
}

const meetingUpdate = {
  ...meetingIdParams,
  body: {
    type: 'object',
    additionalProperties: false,
    minProperties: 1,
    properties: {
      title: { type: 'string', minLength: 1, maxLength: 200 },
      meeting_at: { type: 'string', minLength: 1, maxLength: 64 },
      links: linksList,
      // Nullable (unlike meetingCreate's project_id) so a client can
      // explicitly clear an existing link, not just omit it.
      project_id: { anyOf: [projectId, { type: 'null' }] },
    },
  },
}

const meetingImageIdParams = {
  params: {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'imageId'],
    properties: {
      id: { type: 'string', minLength: 1, maxLength: 64 },
      imageId: { type: 'string', minLength: 1, maxLength: 64 },
    },
  },
}

const meetingNoteCreate = {
  ...meetingIdParams,
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['body'],
    properties: { body: { type: 'string', minLength: 1, maxLength: 2000 } },
  },
}

const meetingNoteIdParams = {
  params: {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'noteId'],
    properties: {
      id: { type: 'string', minLength: 1, maxLength: 64 },
      noteId: { type: 'string', minLength: 1, maxLength: 64 },
    },
  },
}

const meetingNoteUpdate = {
  ...meetingNoteIdParams,
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['body'],
    properties: { body: { type: 'string', minLength: 1, maxLength: 2000 } },
  },
}

// Notification id path param (e.g. PATCH /notifications/:id/read). Bounds the
// value so a malformed/oversized id is rejected with 400 before the DB query.
const notificationIdParams = {
  params: {
    type: 'object',
    additionalProperties: false,
    required: ['id'],
    properties: { id: { type: 'string', minLength: 1, maxLength: 64 } },
  },
}

// Feed paging. `cursor` is the opaque `<iso>|<id>` string the previous page
// returned — validated for shape here and parsed in the route, which returns
// the first page rather than an error for anything malformed (a stale cursor
// from an old tab should degrade to "top of feed", not to a 400 the SPA has
// no recovery path for). maxLength bounds it well above a real cursor (~60).
//
// Query params arrive as strings, and the server sets coerceTypes:false
// globally — so `limit` is declared as a string with a numeric pattern and
// converted in the route, rather than as an integer that would always 400.
const notificationListQuery = {
  querystring: {
    type: 'object',
    additionalProperties: false,
    properties: {
      limit: { type: 'string', pattern: '^[0-9]{1,3}$' },
      cursor: { type: 'string', maxLength: 128 },
    },
  },
}

// ─── projects ──────────────────────────────────────────────────────────

// A product spec component: { component, date?, fields: [{ k, v }] }. The field
// list stays loose (additionalProperties allowed) so the Ürün Bilgileri form can
// grow without a schema change, but sizes are capped so a bad client can't push
// unbounded JSON. Declared here rather than in the product-info section because
// `projectsImport` (below) references it, and a `const` used before its
// initialiser runs would throw on module evaluation.
const productComponents = {
  type: 'array',
  maxItems: 64,
  items: {
    type: 'object',
    properties: {
      component: { type: 'string', maxLength: 300 },
      date: { type: 'string', maxLength: 60 },
      fields: {
        type: 'array',
        maxItems: 128,
        items: {
          type: 'object',
          properties: {
            k: { type: 'string', maxLength: 200 },
            v: { type: 'string', maxLength: 4000 },
          },
        },
      },
    },
  },
}

const projectsCreate = {
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['title', 'type'],
    properties: {
      title: { type: 'string', minLength: 1, maxLength: 200 },
      type: { type: 'string', enum: ['TR', 'CIN'] },
      target_month: {
        // YYYY-MM-01 or null. Loose validation: we trust the SPA to
        // send the first-of-month ISO date the date picker produces.
        type: ['string', 'null'],
        pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}$',
      },
      pass_kind: {
        type: 'string',
        // Must match the client's PASS_KIND values and the DB CHECK
        // (migrations 002/008): 'redesign', not 'revize'.
        enum: ['first_edition', 'reprint', 'redesign'],
      },
      assigned_to: { type: ['string', 'null'], maxLength: 64 },
      // The SPA's multi-designer picker sends `assignees` as an array.
      // The route handler picks the first one as the project primary and
      // distributes the rest to per-subtask `assigned_to` columns via
      // `subtaskAssignees`. We accept both shapes for forward-compat.
      assignees: {
        type: 'array',
        maxItems: 8,
        items: { type: 'string', minLength: 1, maxLength: 64 },
      },
      // { [subtaskKeyOrTitle]: userId } — per-subtask designer override.
      subtaskAssignees: {
        type: 'object',
        additionalProperties: { type: 'string', minLength: 1, maxLength: 64 },
      },
      subtasks: {
        type: 'array',
        maxItems: 32,
        items: subtaskInput,
      },
    },
  },
}

// Legacy/backlist import (see AGENTS.md → "Kayıtlı ürünler (legacy)").
//
// `stage` is deliberately NOT the full stage enum: importing straight into a
// pre-production stage is what `POST /projects` is for. The route narrows it
// further to ORDERABLE_STAGES and rejects anything else with a 400.
//
// `id` accepts only the REÇETE.xlsx seed namespace (`p-x1`, `p-x42`). Reusing
// the seed id is what makes the Ürün Bilgileri orphan row convert in place
// instead of appearing twice; allowing arbitrary ids here would let a client
// choose project primary keys, so keep the pattern tight.
const projectsImport = {
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['items'],
    properties: {
      dryRun: { type: 'boolean' },
      items: {
        type: 'array',
        minItems: 1,
        maxItems: 500,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['title', 'type'],
          properties: {
            id: { type: 'string', pattern: '^p-x[0-9]{1,6}$' },
            title: { type: 'string', minLength: 1, maxLength: 200 },
            type: { type: 'string', enum: ['TR', 'CIN'] },
            stage: {
              type: 'string',
              enum: ['baskida', 'gumruk', 'satista'],
            },
            pass_kind: {
              type: 'string',
              enum: ['first_edition', 'reprint', 'redesign'],
            },
            target_month: {
              type: ['string', 'null'],
              pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}$',
            },
            components: productComponents,
          },
        },
      },
    },
  },
}

const projectsPatch = {
  params: {
    type: 'object',
    additionalProperties: false,
    required: ['id'],
    properties: { id: projectId },
  },
  // The SPA's `api.updateProject` sends the full project payload
  // (assignees, subtasks, pageCount, …) for both create and edit.
  // The route handler applies only the four writable columns and
  // drops the rest, so the schema just has to *accept* the shape —
  // additionalProperties:false guarantees typos in unknown keys fail.
  body: {
    type: 'object',
    additionalProperties: false,
    minProperties: 1,
    properties: {
      title: { type: 'string', minLength: 1, maxLength: 200 },
      type: { type: 'string', enum: ['TR', 'CIN'] },
      target_month: {
        type: ['string', 'null'],
        pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}$',
      },
      assigned_to: { type: ['string', 'null'], maxLength: 64 },
      assignees: {
        type: 'array',
        maxItems: 8,
        items: { type: 'string', minLength: 1, maxLength: 64 },
      },
      subtasks: {
        type: 'array',
        maxItems: 64,
        items: { type: 'string', minLength: 1, maxLength: 64 },
      },
      subtaskAssignees: { type: 'object' },
      pageCount: { type: ['integer', 'null'], minimum: 1, maximum: 100000 },
      stickerCount: { type: ['integer', 'null'], minimum: 1, maximum: 100000 },
    },
  },
}

const projectsIdParams = {
  params: {
    type: 'object',
    additionalProperties: false,
    required: ['id'],
    properties: { id: projectId },
  },
}

/**
 * `/demo-edit-notify`, `/ozalit-edit-notify`. `demo_id` is the snapshot the
 * SPA just saved for this correction (migration 052) — optional, since an
 * older client (or a failed snapshot POST) still notifies without one.
 */
// The corrected sheet travels WITH the notify call so the route can write it
// inside the same transaction that authorizes it — see the route comment in
// routes/projects.js. `demo_id` stays for older clients that still pre-wrote
// the snapshot through POST /demos and only sent its id here.
const projectsFormEditNotify = {
  ...projectsIdParams,
  body: {
    type: 'object',
    additionalProperties: false,
    properties: {
      demo_id: { type: ['string', 'null'], maxLength: 64 },
      attempt: { type: 'integer', minimum: 0, maximum: 100 },
      payload: { type: 'object' },
    },
  },
}

const projectsAdvance = {
  ...projectsIdParams,
  body: {
    type: 'object',
    additionalProperties: false,
    properties: { note: { type: 'string', maxLength: 1000 } },
  },
}

// "Kaldır" / "Geri Al" — delist a product from the Ürünler catalog or put it
// back. `hidden` is required and explicit rather than a toggle so a double
// click (or a retried request) can't flip the product back into the catalog.
const projectsCatalog = {
  ...projectsIdParams,
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['hidden'],
    properties: {
      hidden: { type: 'boolean' },
      note: { type: 'string', maxLength: 1000 },
    },
  },
}

const projectsApprove = {
  ...projectsIdParams,
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['stage'],
    properties: {
      stage,
      note: { type: 'string', maxLength: 1000 },
    },
  },
}

const projectsReject = {
  ...projectsIdParams,
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['stage', 'reason'],
    properties: {
      stage,
      reason: { type: 'string', minLength: 1, maxLength: 2000 },
      reject_target: rejectTarget,
      // IDs of the subtasks the leader marked for revision. The SPA always
      // sends this key (empty array when routing to matbaa or when nothing is
      // selected); without it here the strict additionalProperties:false guard
      // rejected every reject request with a 400.
      revizeIds: { type: 'array', items: { type: 'string' }, default: [] },
      note: { type: 'string', maxLength: 1000 },
    },
  },
}

// POST /ekran-demo-reject — team leader declining a pending Ekran Demo Onayı
// request. Always falls back to the designer's normal physical demo path, so
// unlike projectsReject there's no stage/reject_target/revizeIds to pick.
const projectsEkranDemoReject = {
  ...projectsIdParams,
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['reason'],
    properties: {
      reason: { type: 'string', minLength: 1, maxLength: 2000 },
    },
  },
}

// POST /demo-change-request, /ozalit-change-request — leader/assigned designer
// asking Matbaa to accept a cancel or edit once they've started work.
const projectsChangeRequest = {
  ...projectsIdParams,
  body: {
    type: 'object',
    additionalProperties: false,
    properties: { note: { type: 'string', maxLength: 500 } },
  },
}

// ─── subtasks ──────────────────────────────────────────────────────────

const subtasksPatch = {
  params: {
    type: 'object',
    additionalProperties: false,
    required: ['id'],
    properties: { id: { type: 'string', minLength: 1, maxLength: 64 } },
  },
  body: {
    type: 'object',
    additionalProperties: false,
    minProperties: 1,
    properties: {
      is_done: { type: 'boolean' },
      pages_done: { type: 'integer', minimum: 0, maximum: 100000 },
      stickers_done: { type: 'integer', minimum: 0, maximum: 100000 },
      // Designer-set rework flag. Setting it is the reprint (sipariş) check:
      // the work is already complete, and the designer marks which subtasks
      // they had to redo for this run. Clearing it is also what
      // `POST /subtasks/:id/revize` does — that route stays as the explicit
      // "revize edildi" acknowledgment with its own timeline entry.
      // Guarded in the handler: assigned designer only.
      needs_revize: { type: 'boolean' },
    },
  },
}

const subtasksUpdates = {
  params: {
    type: 'object',
    additionalProperties: false,
    required: ['id'],
    properties: { id: { type: 'string', minLength: 1, maxLength: 64 } },
  },
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['note'],
    properties: { note: { type: 'string', minLength: 1, maxLength: 5000 } },
  },
}

const subtasksRevize = {
  params: {
    type: 'object',
    additionalProperties: false,
    required: ['id'],
    properties: { id: { type: 'string', minLength: 1, maxLength: 64 } },
  },
}

// migration 055 — flip a single page's status inside an "İç Sayfalar" subtask.
// path param `pageIndex` is the 1-based page number (matches the chip grid),
// body `status` is one of pending/done/rework. Returns the same project shape
// every other subtask route returns so the client can drop it straight into
// state without a follow-up GET.
const subtasksPagePatch = {
  params: {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'pageIndex'],
    properties: {
      id: { type: 'string', minLength: 1, maxLength: 64 },
      pageIndex: { type: 'integer', minimum: 1, maximum: 100000 },
    },
  },
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['status'],
    properties: {
      status: { type: 'string', enum: ['pending', 'done', 'rework'] },
    },
  },
}

// migration 056 — assign (or un-assign) a single page's owner. The team
// leader calls this to pre-allocate pages between designers ("Aylin does
// 1-24, Rahşan does 25-48") or to reassign during a revision ("move 5, 8,
// 12 to Rahşan because Aylin is stretched"). Body `assigned_to` is the
// designer id, or null to un-assign. The route checks that the actor is
// a team_leader before touching the row.
const subtasksPageAssign = {
  params: subtasksPagePatch.params,
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['assigned_to'],
    properties: {
      assigned_to: { type: ['string', 'null'], minLength: 1, maxLength: 64 },
    },
  },
}

// A sipariş's own per-order copy of the checklist (order_subtasks) — same
// fields as subtasksPatch, scoped by orderId+id instead of just id. See
// server/db/migrations/039__order_subtasks.sql.
const orderSubtasksPatch = {
  params: {
    type: 'object',
    additionalProperties: false,
    required: ['orderId', 'id'],
    properties: {
      orderId: { type: 'string', minLength: 1, maxLength: 64 },
      id: { type: 'string', minLength: 1, maxLength: 64 },
    },
  },
  body: {
    type: 'object',
    additionalProperties: false,
    minProperties: 1,
    properties: {
      is_done: { type: 'boolean' },
      pages_done: { type: 'integer', minimum: 0, maximum: 100000 },
      stickers_done: { type: 'integer', minimum: 0, maximum: 100000 },
      needs_revize: { type: 'boolean' },
    },
  },
}

const projectsSubtasksPut = {
  params: projectsIdParams.params,
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['subtasks'],
    properties: {
      subtasks: {
        type: 'array',
        maxItems: 64,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['title', 'kind'],
          properties: {
            // Identity of an existing row. Renaming a subtask must keep its
            // id — the row carries the designer's counters and its
            // subtask_updates notes cascade on delete, so a title-only match
            // would silently destroy both on every rename. Omitted for rows
            // the leader is adding.
            id: { type: 'string', minLength: 1, maxLength: 64 },
            title: { type: 'string', minLength: 1, maxLength: 200 },
            // Must stay in step with the DB: migration 003 constrains this to
            // CHECK (kind IN ('check','pages','sticker-count')). 'normal' was
            // accepted here but rejected there, turning a would-be 400 into a
            // 500 on insert. No caller ever sent it.
            kind: { type: 'string', enum: ['check', 'pages', 'sticker-count'] },
            total_pages: { type: ['integer', 'null'], minimum: 1, maximum: 100000 },
            total_stickers: { type: ['integer', 'null'], minimum: 1, maximum: 100000 },
            is_done: { type: 'boolean' },
            // Per-subtask designer assignment. Optional; null/omitted means
            // "inherit from the project". The PUT handler passes it through
            // to the subtasks.assigned_to column.
            assigned_to: { type: ['string', 'null'], maxLength: 64 },
          },
        },
      },
    },
  },
}

// ─── demos ─────────────────────────────────────────────────────────────

const demosCreate = {
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['project_id'],
    properties: {
      project_id: projectId,
      // Set for a sipariş's own ozalit round (migration 053); NULL/absent for
      // a project's. Both carry project_id, so this is what tells the two
      // apart on read.
      order_id: { type: ['string', 'null'], minLength: 1, maxLength: 64 },
      kind: { type: 'string', enum: ['demo', 'ozalit', 'baski_onay'] },
      payload: { type: 'object' },
      attempt: { type: 'integer', minimum: 0, maximum: 100 },
      // Skip the "formu gönderildi" history row (the spec-form dialog's
      // advance already logs the meaningful timeline entry).
      silent: { type: 'boolean' },
    },
  },
}

// ─── product info (ürün bilgileri / parçalar) ──────────────────────────

const productInfoUpsert = {
  params: {
    type: 'object',
    additionalProperties: false,
    required: ['projectId'],
    properties: { projectId: projectId },
  },
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['components'],
    properties: {
      components: productComponents,
    },
  },
}

// ─── orders ────────────────────────────────────────────────────────────

const ordersCreate = {
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['projectId'],
    properties: {
      projectId: projectId,
      quantity: { type: 'integer', minimum: 1, maximum: 1_000_000 },
      notes: { type: 'string', maxLength: 2000 },
      payload: { type: 'object' },
      items: { type: 'array', maxItems: 64, items: { type: 'object' } },
    },
  },
}

const ordersAdvance = {
  params: {
    type: 'object',
    additionalProperties: false,
    required: ['id'],
    properties: { id: { type: 'string', minLength: 1, maxLength: 64 } },
  },
  body: {
    type: 'object',
    additionalProperties: false,
    properties: {
      notes: { type: 'string', maxLength: 2000 },
      assignees: {
        type: ['array', 'null'],
        maxItems: 8,
        items: { type: 'string', minLength: 1, maxLength: 64 },
      },
      expectedVersion: { type: ['integer', 'null'], minimum: 0 },
      // Only meaningful when the order is at 'kontrol_edildi' — the
      // designer's ozalit-request step (migration 054) — on a RESUBMIT
      // (order.last_reject_type === 'designer'). The route 400s if this is
      // sent on a first submission, at any other step, or omitted on a
      // resubmit.
      route: { type: 'string', enum: ['tasarimci_onay', 'ekran_onay'] },
    },
  },
}

const ordersIdParams = {
  params: {
    type: 'object',
    additionalProperties: false,
    required: ['id'],
    properties: { id: { type: 'string', minLength: 1, maxLength: 64 } },
  },
}

const ordersReject = {
  ...ordersIdParams,
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['reason'],
    properties: {
      reason: { type: 'string', minLength: 1, maxLength: 2000 },
      rejectTarget,
      // Which alt görevler have to be redone for this reprint. Mirrors the
      // main pipeline's demo/ozalit rejection (`projectsReject.revizeIds`) so
      // a sipariş rejection can name the guilty part, not just the guilty
      // role. Only meaningful when rejectTarget is 'designer'.
      revizeIds: {
        type: 'array',
        maxItems: 64,
        items: { type: 'string', minLength: 1, maxLength: 64 },
      },
    },
  },
}

// Body for POST .../ozalit-edit-notify — the sipariş twin of
// projectsFormEditNotify. Carries the corrected sheet so the route can write
// the snapshot inside the same transaction that authorizes the edit; without
// it a refused edit would still have landed via a prior POST /demos.
const ordersOzalitEditNotify = {
  ...ordersIdParams,
  body: {
    type: 'object',
    additionalProperties: false,
    properties: {
      attempt: { type: 'integer', minimum: 0, maximum: 100 },
      payload: { type: 'object' },
    },
  },
}

// Body for POST .../ozalit-change-request — mirrors the main pipeline's
// demo/ozalit change-request note (migration 048), optional free text.
const ordersOzalitChangeRequest = {
  ...ordersIdParams,
  body: {
    type: 'object',
    additionalProperties: false,
    properties: {
      note: { type: 'string', maxLength: 2000 },
    },
  },
}

// Save-draft (PATCH) and approve (POST) for the siparis_baski_onay
// print-spec form share this shape — approve additionally requires
// adet/tarih/basimYeri/hazirlayan to be non-empty, enforced by the route (not
// `required` here) so a draft save can be partial.
const ordersBaskiOnayForm = {
  params: {
    type: 'object',
    additionalProperties: false,
    required: ['id'],
    properties: { id: { type: 'string', minLength: 1, maxLength: 64 } },
  },
  body: {
    type: 'object',
    additionalProperties: false,
    properties: {
      components: { type: 'array', maxItems: 32, items: { type: 'object' } },
      adet: { type: 'string', maxLength: 200 },
      tarih: { type: 'string', maxLength: 100 },
      basimYeri: { type: 'string', maxLength: 200 },
      hazirlayan: { type: 'string', maxLength: 200 },
      notes: { type: 'string', maxLength: 1000 },
    },
  },
}

// ─── handovers ─────────────────────────────────────────────────────────

const handoversCreate = {
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['projectId'],
    properties: { projectId: projectId },
  },
}

const handoversConfirm = {
  params: {
    type: 'object',
    additionalProperties: false,
    required: ['id'],
    properties: { id: { type: 'string', minLength: 1, maxLength: 64 } },
  },
  // Deliberately NO body schema. The confirm carries no payload — who
  // confirmed comes from the session user, never the client. Declaring
  // `body: { type: 'object' }` here does NOT mean "an empty body is fine":
  // Fastify runs the validator against `request.body`, which is undefined
  // when the client sends no body at all, and `undefined` fails
  // `type: 'object'` with a 400 "body must be object". That 400 fired on
  // every single "Alındı" click, since the SPA sends a bodyless PATCH.
}

// ─── web push ──────────────────────────────────────────────────────────

// Shape handed back by PushSubscription.toJSON() in the browser. `endpoint`
// is a push-service URL and can be long (FCM's run ~200 chars, Apple's more),
// so the cap is generous — but bounded, since it lands in a UNIQUE index.
const pushSubscribe = {
  body: {
    type: 'object',
    required: ['subscription'],
    additionalProperties: false,
    properties: {
      subscription: {
        type: 'object',
        required: ['endpoint', 'keys'],
        // The browser also includes `expirationTime` (almost always null).
        // Allowed through rather than rejected so a spec-compliant
        // `subscription.toJSON()` can be posted verbatim.
        additionalProperties: true,
        properties: {
          endpoint: { type: 'string', minLength: 1, maxLength: 2000 },
          keys: {
            type: 'object',
            required: ['p256dh', 'auth'],
            additionalProperties: false,
            properties: {
              p256dh: { type: 'string', minLength: 1, maxLength: 200 },
              auth: { type: 'string', minLength: 1, maxLength: 200 },
            },
          },
        },
      },
    },
  },
}

const pushUnsubscribe = {
  body: {
    type: 'object',
    required: ['endpoint'],
    additionalProperties: false,
    properties: {
      endpoint: { type: 'string', minLength: 1, maxLength: 2000 },
    },
  },
}

// ─── exports ───────────────────────────────────────────────────────────

export const schemas = {
  pushSubscribe,
  pushUnsubscribe,
  authLogin,
  authInvitePreview,
  authAcceptInvite,
  authForgotPassword,
  authResetPassword,
  authChangePassword,
  authDevLogin,
  usersInvite,
  userIdParams,
  workLogListQuery,
  workLogCreate,
  workLogUpdate,
  workLogIdParams,
  notificationIdParams,
  notificationListQuery,
  projectsCreate,
  projectsImport,
  projectsPatch,
  projectsIdParams,
  projectsFormEditNotify,
  projectsCatalog,
  projectsAdvance,
  projectsApprove,
  projectsReject,
  projectsEkranDemoReject,
  projectsChangeRequest,
  subtasksPatch,
  subtasksUpdates,
  subtasksRevize,
  subtasksPagePatch,
  subtasksPageAssign,
  projectsSubtasksPut,
  demosCreate,
  productInfoUpsert,
  ordersCreate,
  ordersAdvance,
  ordersReject,
  ordersIdParams,
  ordersOzalitChangeRequest,
  ordersOzalitEditNotify,
  ordersBaskiOnayForm,
  orderSubtasksPatch,
  handoversCreate,
  handoversConfirm,
  targetProjectIdeaCreate,
  targetProjectIdeaIdParams,
  targetProjectIdeaUpdate,
  targetProjectIdeaImageIdParams,
  targetProjectIdeaNoteCreate,
  targetProjectIdeaNoteIdParams,
  targetProjectIdeaNoteUpdate,
  meetingCreate,
  meetingIdParams,
  meetingUpdate,
  meetingImageIdParams,
  meetingNoteCreate,
  meetingNoteIdParams,
  meetingNoteUpdate,
}
