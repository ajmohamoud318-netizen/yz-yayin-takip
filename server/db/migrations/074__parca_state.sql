-- 074 — parca_state: whose desk each parça is on, and where in its cycle
--
-- Until now a reject was a WHOLE-PROJECT event. A leader reviewing a
-- three-parça sheet could already approve or reject parçalar individually
-- (migrations 068/069/070), but the reject itself bounced the entire project:
-- demo → tasarim, ozalit → parked on ozalit_onay, matbaa → back to *_teslim.
-- There was no way to say "KUTU is the matbaa's problem, KİTAP is the
-- designer's" and let both work at once.
--
-- This table makes the parça the unit of rework. One row per (project, parça),
-- answering two questions the projects table cannot:
--
--   owner_role — whose desk is this parça on right now?
--   state      — where is it in its cycle?
--
--   pending ──leader approves──────────────► approved
--      │
--      ├──reject(designer)──► with_designer ──revize + request round──┐
--      │                                                              │
--      └──reject(matbaa)────► with_matbaa ──başlat──► in_round ──teslim┤
--                                                                     ▼
--                                                                  pending
--
-- An Ekran round skips the matbaa and returns straight to `pending`.
--
-- Why a table and not more JSONB on `projects`:
--
--   • The matbaa's existing gates — demo_started, demo_delivered_at,
--     ozalit_started — are project-level SCALARS. They cannot express
--     "KUTU started, KİTAP not", which is the whole point of this feature.
--     started_at / delivered_at here are their per-parça counterparts.
--
--   • The matbaa's work queue has to be *queryable by owner* to render one row
--     per parça across projects. idx_parca_state_owner serves exactly that;
--     a JSONB column on projects would mean scanning every project row.
--
--   • It replaces an implicit rule with an explicit one. The per-parça gates
--     currently prune their ledgers to the CURRENT round's snapshot
--     (pruneApprovalsToSnapshot in domain/transitions.js). Once a re-round can
--     carry only the rejected parça, that prune would silently delete the
--     approvals of every parça NOT in the round — destroying the
--     "approved parçalar stay locked" guarantee this feature is built on.
--     Rows here are created/refreshed from the union of what exists and what
--     the round carries, so nothing is dropped by omission.
--
-- `parca` is a plain TEXT name, not a FK. Parçalar are name-keyed strings
-- everywhere else in this codebase (sanitiseParcalar in domain/transitions.js,
-- parcaNames in the client's domain/services/pipeline.js) and there is no parça
-- entity to point at — they live inside product_info.components and inside each
-- round's demos.payload._selectedComponents.
--
-- `gate` is which approval gate the parça is cycling on. Baskı onayı is absent
-- on purpose: it is a leader-to-leader maker-checker (migration 070) with no
-- designer or matbaa leg, so per-party routing has nothing to route.
--
-- The 068/069/070 ledgers are NOT retired here. They keep recording who signed
-- what and when (the signer lists the approval grid renders). This table
-- records whose turn it is.
--
-- Idempotent so re-running on a seeded DB is a no-op.

CREATE TABLE IF NOT EXISTS parca_state (
  project_id       TEXT        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  parca            TEXT        NOT NULL,
  gate             TEXT        NOT NULL
                   CHECK (gate IN ('demo','ozalit')),
  state            TEXT        NOT NULL DEFAULT 'pending'
                   CHECK (state IN ('pending','approved','with_designer','with_matbaa','in_round')),
  -- NULL while the parça sits at the gate waiting on the leader.
  owner_role       TEXT        CHECK (owner_role IN ('designer','printer','team_leader')),
  -- The designer's choice when they send a rejected parça back round:
  -- a physical round via the matbaa, or an Ekran (screen) check.
  route            TEXT        CHECK (route IN ('physical','ekran')),
  attempt          INTEGER     NOT NULL DEFAULT 1,
  -- Per-parça counterparts of the project-level demo_started / demo_delivered_at.
  started_at       TIMESTAMPTZ,
  delivered_at     TIMESTAMPTZ,
  -- Why it was sent back, carried so the owner sees it without digging
  -- through the rejection ledger.
  reason           TEXT,
  rejected_by      TEXT        REFERENCES users(id) ON DELETE SET NULL,
  rejected_by_name TEXT,
  rejected_at      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (project_id, parca)
);

-- The matbaa/designer queues ask "which parçalar are on my desk?" across every
-- project at once. Without this that is a full scan of the table.
CREATE INDEX IF NOT EXISTS idx_parca_state_owner ON parca_state(owner_role, state);

-- The project detail page and every gate ask for one project's parçalar. The
-- PK covers (project_id, parca) left-to-right, so project_id alone is already
-- served by it — no second index needed.
