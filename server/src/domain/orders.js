export const ORDER_STEPS = [
  'atama_bekleniyor', 'tasarimciya_atandi', 'kontroller_tamam',
  'matbaa_ozalit_yapiyor', 'ekran_onayinda', 'imza_bekleniyor',
  // `baskida` is the paper being at the matbaa, not the end of the story:
  // migration 081 gave the run its own teslim leg, and satış confirming it is
  // what finally closes the order.
  'baski_onayi_bekleniyor', 'baskida', 'teslim_edildi',
]

export const ORDER_STEP_LABELS = {
  atama_bekleniyor: 'Atama Bekleniyor',
  tasarimciya_atandi: 'Tasarımcıya Atandı',
  kontroller_tamam: 'Kontroller Tamam',
  matbaa_ozalit_yapiyor: 'Matbaa Ozalit Yapıyor',
  ekran_onayinda: 'Ekran Onayında',
  imza_bekleniyor: 'İmza Bekleniyor',
  baski_onayi_bekleniyor: 'Baskı Onayı Bekleniyor',
  baskida: 'Baskıda',
  teslim_edildi: 'Teslim Edildi',
  // Sub-events logged inside order_history while status stays at imza_bekleniyor
  // (never an order.status value themselves) — without these, ProjectDetail's
  // order_step_label lookup falls back to the raw step key.
  matbaa_received: 'Matbaa Teslimi Alındı',
  matbaa_not_received: 'Matbaa Teslimi Alınamadı',
  // A per-parça reject at imza_bekleniyor (migration 080). Logged as
  // matbaa_not_received before, so the history called every one of them a
  // failed delivery.
  parca_rejected: 'Parça Reddedildi',
  matbaa_approve: 'Matbaa Onayı Verildi',
  // The sipariş's own ozalit sheet, written when the designer submits the
  // Ozalit Üretim Formu at kontroller_tamam (migration 053's demos.order_id).
  ozalit_form: 'Ozalit Formu Gönderildi',
  // Sub-events for the order's own ozalit-started/cancel/edit/change-request
  // flow (migration 051, full parity with the main pipeline's demo/ozalit
  // started flow — migrations 048/049), logged while status stays at
  // matbaa_ozalit_yapiyor.
  ozalit_started: 'Matbaa Ozalite Başladı',
  ozalit_cancelled: 'Ozalit Talebi İptal Edildi',
  ozalit_edited: 'Ürün Bilgileri Güncelleri',
  ozalit_change_requested: 'Değişiklik İstendi',
  ozalit_change_accepted: 'Değişiklik Kabul Edildi',
  ozalit_change_declined: 'Değişiklik Reddedildi',
  // The teslim leg (migration 081), logged against the order when the matbaa
  // raises the handover and when satış confirms it. Only the second is also an
  // order.status value.
  handover_request: 'Teslim Talebi Oluşturuldu',
}

// imza_bekleniyor is multi-party, leader-first (every active team leader AND
// every order assignee must approve — see computeMatbaaOnayApproval in
// domain/entities/Order.js), NOT a flat single-owner step. The 'team_leader'
// value below is only documentary here — Order.advance() special-cases
// imza_bekleniyor before ever consulting this map.
//
// ekran_onayinda IS a flat single-owner step (team_leader, one click, no
// receipt gate, no ledger — unlike imza_bekleniyor) and rides the same generic
// advance path every other flat step already uses; no dedicated compute
// function needed.
//
// baski_onayi_bekleniyor's 'team_leader' entry is documentary only: the
// /advance route explicitly refuses to touch this step — it requires the
// dedicated form-fill-then-approve routes instead (POST .../baski-onay-approve).
//
// tasarimciya_atandi and kontroller_tamam are the SAME designer's two steps
// (migration 054): the checks, then the ozalit request. Splitting them gave
// the sipariş an ozalit sheet of its own — the request is now made by
// submitting the Ozalit Üretim Formu, not by a bare advance click.
//
// `baskida` and `teslim_edildi` are deliberately absent: neither owes anybody
// an action inside this FSM. The teslim leg that runs between them is the
// matbaa's and satış's, and it lives in routes/handovers.js — it is not a step
// this map can hand out, which is exactly why it does not appear here.
export const ORDER_STEP_OWNER = {
  atama_bekleniyor: 'team_leader',
  tasarimciya_atandi: 'designer',
  kontroller_tamam: 'designer',
  matbaa_ozalit_yapiyor: 'printer',
  ekran_onayinda: 'team_leader',
  imza_bekleniyor: 'team_leader',
  baski_onayi_bekleniyor: 'team_leader',
}

// kontroller_tamam's entry below is the DEFAULT/first-submission destination
// only. On a resubmit (order.last_reject_type === 'designer') the server
// overrides `next` with the designer's chosen `route` ('matbaa_ozalit_yapiyor'
// | 'ekran_onayinda') instead of consulting this map — see orderStepPath below
// and the Ozalit Üretim Formu's own resubmit choice (SpecFormDialog's
// orderContext), which is where that pick moved with migration 054.
//
// imza_bekleniyor now points at baski_onayi_bekleniyor, NOT baskida — the
// new print-spec gate sits between the physical proof round and production.
// baski_onayi_bekleniyor's entry is documentary only (see ORDER_STEP_OWNER
// comment above — it's never reached via the generic advance path).
//
// `baskida` still has NO entry, on purpose. `teslim_edildi` follows it, but the
// only thing that may write it is satış confirming the teslim (migration 081) —
// so /advance keeps answering "Bu talep zaten tamamlandı." and the transition
// stays reachable through `Order.confirmHandover` alone.
export const ORDER_STEP_NEXT = {
  atama_bekleniyor: 'tasarimciya_atandi',
  tasarimciya_atandi: 'kontroller_tamam',
  kontroller_tamam: 'matbaa_ozalit_yapiyor',
  matbaa_ozalit_yapiyor: 'imza_bekleniyor',
  ekran_onayinda: 'baski_onayi_bekleniyor',
  imza_bekleniyor: 'baski_onayi_bekleniyor',
  baski_onayi_bekleniyor: 'baskida',
}

// ekran_onayinda only offers a 'designer' target — it never touches the
// printer, so there's no 'matbaa' route.
export const ORDER_REJECT_TARGETS = {
  imza_bekleniyor: {
    matbaa: 'matbaa_ozalit_yapiyor',
    designer: 'tasarimciya_atandi',
    reassign: 'atama_bekleniyor',
  },
  ekran_onayinda: {
    designer: 'tasarimciya_atandi',
  },
}

// Default destination per step. Kept so `canReject` checks and any caller
// that doesn't pass a target keep working.
export const ORDER_REJECT_TO = {
  imza_bekleniyor: 'matbaa_ozalit_yapiyor',
  ekran_onayinda: 'tasarimciya_atandi',
}