-- 005 — order_requests (sipariş talep workflow)
--
-- Satış Ekibi raises one of these for any project currently in
-- satista. The status walks pending → goruldu → tasarimci_onay →
-- matbaa_onay → onaylandi. `version` powers optimistic concurrency
-- for the "only one leader may sign" rule.

CREATE TABLE order_requests (
  id              TEXT PRIMARY KEY,
  project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','goruldu','tasarimci_onay','matbaa_onay','onaylandi','rejected')),
  requested_by    TEXT REFERENCES users(id) ON DELETE SET NULL,
  payload         JSONB NOT NULL DEFAULT '{}'::jsonb,
  assignee_ids    JSONB NOT NULL DEFAULT '[]'::jsonb,  -- snapshot of current-pass designers
  version         INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_orders_status  ON order_requests(status);
CREATE INDEX idx_orders_project ON order_requests(project_id);

-- Each "sign" of an order step = one row here. Append-only.
CREATE TABLE order_history (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  order_id        TEXT NOT NULL REFERENCES order_requests(id) ON DELETE CASCADE,
  step            TEXT NOT NULL,
  signed_by_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
  notes           TEXT NOT NULL DEFAULT '',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_order_history_order ON order_history(order_id);
