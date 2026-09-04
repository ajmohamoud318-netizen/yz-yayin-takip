-- 066 — order_requests status rename + CHECK constraint repair
--
-- Background:
--   The 8-step sipariş workflow grew over several migrations (005 original,
--   046 ekran_onay + siparis_baski_onay, 054 kontrol_edildi split from
--   goruldu), but the CHECK constraint on order_requests.status was never
--   updated past the original 005 values. The constraint quietly accepts
--   'kontrol_edildi', 'ekran_onay', 'siparis_baski_onay' because Postgres
--   doesn't know to reject them — it's a stale contract.
--
-- The step names also read poorly: 'tasarimci_onay' was the designer's
-- approval in the OLD pipeline, but since 054 it labels the printer's
-- turn to print the ozalit; 'matbaa_onay' says "printer approval" but
-- is the multi-party sign-off the printer has nothing to do with;
-- 'onaylandi' means "approved" but the UI calls it "Baskıda" (in print).
-- New names are state-named, owner-implicit, and Turkish to match the
-- UI labels so badges and code agree.
--
-- Mapping (old → new):
--   pending              → atama_bekleniyor       ("Atama Bekleniyor")
--   goruldu              → tasarimciya_atandi     ("Tasarımcıya Atandı")
--   kontrol_edildi       → kontroller_tamam       ("Kontroller Tamam")
--   tasarimci_onay       → matbaa_ozalit_yapiyor  ("Matbaa Ozalit Yapıyor")
--   ekran_onay           → ekran_onayinda         ("Ekran Onayında")
--   matbaa_onay          → imza_bekleniyor        ("İmza Bekleniyor")
--   siparis_baski_onay   → baski_onayi_bekleniyor ("Baskı Onayı Bekleniyor")
--   onaylandi            → baskida                ("Baskıda")
--
-- 'rejected' is kept (legacy, never removed from the constraint) and
-- gains no new name — it's a tombstone state, never re-entered from.

BEGIN;

-- 0) DROP the legacy CHECK constraint BEFORE any backfill. The constraint
--    was tightened to legacy names ('pending', 'goruldu', …) by
--    migrations 005 / 046 / 054, and the new names ('atama_bekleniyor',
--    …) are NOT in that allow-list, so the first UPDATE below would
--    itself be a CHECK violation and abort the transaction. The original
--    shape of this file did UPDATEs first then DROP/ADD, which blew up
--    on first apply with "new row for relation order_requests violates
--    check constraint order_requests_status_check". Forcing the DROP to
--    here removes that trap without losing the migration's intent.
ALTER TABLE order_requests DROP CONSTRAINT IF EXISTS order_requests_status_check;

-- 1) Backfill order_history.step first — it's referenced by
--    orderStepPath's ekran branch detection, and we want the history
--    rows to read consistently with current status under the new labels.
UPDATE order_history SET step = 'atama_bekleniyor'       WHERE step = 'pending';
UPDATE order_history SET step = 'tasarimciya_atandi'     WHERE step = 'goruldu';
UPDATE order_history SET step = 'kontroller_tamam'       WHERE step = 'kontrol_edildi';
UPDATE order_history SET step = 'matbaa_ozalit_yapiyor'  WHERE step = 'tasarimci_onay';
UPDATE order_history SET step = 'ekran_onayinda'         WHERE step = 'ekran_onay';
UPDATE order_history SET step = 'imza_bekleniyor'        WHERE step = 'matbaa_onay';
UPDATE order_history SET step = 'baski_onayi_bekleniyor' WHERE step = 'siparis_baski_onay';
UPDATE order_history SET step = 'baskida'                WHERE step = 'onaylandi';

-- 2) Backfill order_requests.status — the live column the app reads.
--    Safe now: the constraint was dropped in step 0 above, so each new
--    value passes the (currently absent) check freely.
UPDATE order_requests SET status = 'atama_bekleniyor'       WHERE status = 'pending';
UPDATE order_requests SET status = 'tasarimciya_atandi'     WHERE status = 'goruldu';
UPDATE order_requests SET status = 'kontroller_tamam'       WHERE status = 'kontrol_edildi';
UPDATE order_requests SET status = 'matbaa_ozalit_yapiyor'  WHERE status = 'tasarimci_onay';
UPDATE order_requests SET status = 'ekran_onayinda'         WHERE status = 'ekran_onay';
UPDATE order_requests SET status = 'imza_bekleniyor'        WHERE status = 'matbaa_onay';
UPDATE order_requests SET status = 'baski_onayi_bekleniyor' WHERE status = 'siparis_baski_onay';
UPDATE order_requests SET status = 'baskida'                WHERE status = 'onaylandi';

-- 3) Repair the stale CHECK constraint. The 005 constraint only knew
--    five values; subsequent migrations added three more without
--    updating it, so it hasn't actually been enforcing anything since
--    migration 046. Drop + re-add with the full set.
ALTER TABLE order_requests
  ADD CONSTRAINT order_requests_status_check
  CHECK (status IN (
    'atama_bekleniyor',
    'tasarimciya_atandi',
    'kontroller_tamam',
    'matbaa_ozalit_yapiyor',
    'ekran_onayinda',
    'imza_bekleniyor',
    'baski_onayi_bekleniyor',
    'baskida',
    'rejected'
  ));

-- 4) The default value 'pending' is the legacy name — no row will ever
--    be inserted without an explicit status (createOrder sets it), but
--    keep the default consistent so a hand-crafted INSERT doesn't 400.
ALTER TABLE order_requests ALTER COLUMN status SET DEFAULT 'atama_bekleniyor';

COMMIT;