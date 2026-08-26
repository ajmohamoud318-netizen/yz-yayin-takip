-- 054 — Split the tasarımcı's sipariş step in two: önce kontrol, sonra ozalit.
--
-- `goruldu` used to be a single click. The designer opened TalepSignDialog,
-- corrected alt görevler / ürün bilgileri, pressed "İnceleyin ve Gönderin",
-- and the order landed straight on the matbaa's desk (tasarimci_onay) —
-- the ozalit request was implicit, and no ozalit sheet was ever filled in
-- for the round the matbaa was about to cut.
--
-- The designer's work is now two signable steps, each its own status so the
-- pipeline, the project timeline and every queue can say which half is
-- outstanding:
--
--   • goruldu        — "Kontrolleri Yapın": alt görevler + ürün bilgileri,
--                      exactly what the step already did. Advances to…
--   • kontrol_edildi — "Ozalit İsteyin": opens the Ozalit Üretim Formu, and
--                      THAT form's submit is what advances the order to
--                      tasarimci_onay (or, on a resubmit after a
--                      reject-to-designer, to ekran_onay).
--
-- Both belong to the same assigned designer(s) — this splits one role's work
-- into two actions, it hands nothing to a new role. A rejection still routes
-- back to `goruldu` (the checks are what a reject asks to be redone), and
-- so does the leader's pre-start ozalit cancel.
--
-- One knock-on: last_reject_type must now SURVIVE goruldu and be cleared one
-- step later, when the order leaves kontrol_edildi. That is the click which
-- reads it — the ozalit / ekran onayı choice is only offered on a resubmit,
-- and it is no longer made at goruldu.
--
-- Idempotent so re-running on a seeded DB is a no-op.

ALTER TABLE order_requests DROP CONSTRAINT IF EXISTS order_requests_status_check;
ALTER TABLE order_requests ADD CONSTRAINT order_requests_status_check CHECK (status IN (
  'pending','goruldu','kontrol_edildi','tasarimci_onay','ekran_onay','matbaa_onay',
  'siparis_baski_onay','onaylandi','rejected'
));
