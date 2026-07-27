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
    'ozalit_teslim', 'ozalit_onay',
    'cin_demo_teslim', 'cin_demo_onay',
    'uretime_hazir', 'uretimde', 'gumruk', 'satista',
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

// Same-day status note (see migration 025__daily_status.sql). Empty string
// is how the client clears the status, so no minLength.
const usersSetStatus = {
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['text'],
    properties: { text: { type: 'string', maxLength: 140 } },
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

// ─── projects ──────────────────────────────────────────────────────────

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

const projectsAdvance = {
  ...projectsIdParams,
  body: {
    type: 'object',
    additionalProperties: false,
    properties: { note: { type: 'string', maxLength: 1000 } },
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
            title: { type: 'string', minLength: 1, maxLength: 200 },
            kind: { type: 'string', enum: ['check', 'pages', 'sticker-count', 'normal'] },
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
      kind: { type: 'string', enum: ['demo', 'ozalit'] },
      payload: { type: 'object' },
      attempt: { type: 'integer', minimum: 0, maximum: 100 },
      // Skip the "formu gönderildi" history row (the spec-form dialog's
      // advance already logs the meaningful timeline entry).
      silent: { type: 'boolean' },
    },
  },
}

// ─── product info (ürün bilgileri / parçalar) ──────────────────────────

// A component is { component, date?, fields: [{ k, v }] }. We keep the field
// list loose (additionalProperties allowed) so the form can grow without a
// schema change, but cap sizes so a bad client can't push unbounded JSON.
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
      components: {
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
      },
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
    },
  },
}

const ordersReject = {
  params: {
    type: 'object',
    additionalProperties: false,
    required: ['id'],
    properties: { id: { type: 'string', minLength: 1, maxLength: 64 } },
  },
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['reason'],
    properties: {
      reason: { type: 'string', minLength: 1, maxLength: 2000 },
      rejectTarget,
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
  body: {
    type: 'object',
    additionalProperties: false,
    properties: {}, // no body — accepts any empty/missing object
  },
}

// ─── exports ───────────────────────────────────────────────────────────

export const schemas = {
  authLogin,
  authInvitePreview,
  authAcceptInvite,
  authForgotPassword,
  authResetPassword,
  authChangePassword,
  authDevLogin,
  usersInvite,
  userIdParams,
  usersSetStatus,
  notificationIdParams,
  projectsCreate,
  projectsPatch,
  projectsIdParams,
  projectsAdvance,
  projectsApprove,
  projectsReject,
  subtasksPatch,
  subtasksUpdates,
  subtasksRevize,
  projectsSubtasksPut,
  demosCreate,
  productInfoUpsert,
  ordersCreate,
  ordersAdvance,
  ordersReject,
  handoversCreate,
  handoversConfirm,
}
