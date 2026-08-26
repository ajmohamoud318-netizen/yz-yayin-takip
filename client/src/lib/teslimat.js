/**
 * The three künye rows nobody types: who handed the round over, when, and who
 * signed for it.
 *
 * TESLİM TARİHİ / TESLİM EDEN KİŞİ were stamped into the sheet's SNAPSHOT and
 * nowhere else, which made them exactly as durable as the slot they happened
 * to land in. A round that was corrected after it was sent lives in two slots
 * (see `liveAttempts` in SpecFormDialog), the stamp goes to whichever one the
 * matbaa's form was read from, and every other reader of that round printed a
 * delivered demo with an empty TESLİM TARİHİ.
 *
 * The pipeline already records the same facts on the project / order row,
 * where the SERVER owns them and no browser can lose them:
 *
 *   demo_delivered_at / _by_name   migration 027   the matbaa's teslim
 *   demo_received / _by            migration 021   the "Teslim Alındı" ack
 *   ozalit_received / _by          migration 035   the same, one leg later
 *   matbaa_received / _by          migration 038   a sipariş's own ozalit round
 *
 * So the künye resolves from those, with the snapshot underneath as the
 * fallback. The columns describe the round the project is on RIGHT NOW —
 * every transition that starts a fresh round nulls them (computeDemoTeslim-
 * Advance, computeDemoNotReceived, computeRejection, the cancels) — so they
 * may only be layered onto a sheet that IS the current round. A history
 * snapshot keeps whatever it was stamped with; see `showsLiveTeslimat`.
 *
 * The ozalit leg has no delivery columns of its own (only the demo one was
 * ever given them), so an ozalit sheet's TESLİM EDEN KİŞİ / TESLİM TARİHİ
 * still come from the snapshot the matbaa stamped at delivery.
 */

/** ISO → `14 Ağustos 2026`. '' — not '—' — for a stamp that hasn't happened:
 *  a künye row is blank until its event occurs, never dashed. */
function sheetDate(iso) {
  if (!iso) return ''
  const d = iso instanceof Date ? iso : new Date(iso)
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' })
}

/**
 * What the server knows about the teslimat of the round currently open on
 * `project` — or on `order`, when the round belongs to a sipariş (migration
 * 053) rather than to the project's own pipeline.
 *
 * Every field is '' when its event hasn't happened, so an undelivered sheet
 * stays blank and `withTeslimat` leaves the snapshot's own value in place.
 */
export function liveTeslimat({ project, order = null, kind }) {
  const blank = { teslimTarihi: '', teslimEdenKisi: '', teslimAlanKisi: '' }
  // A sipariş's ozalit round: the matbaa's delivery is an order step with no
  // columns behind it, but the receipt gate has its own ledger.
  if (order) {
    return { ...blank, teslimAlanKisi: order.matbaa_received ? (order.matbaa_received_by ?? '') : '' }
  }
  if (kind === 'demo') {
    return {
      teslimTarihi: sheetDate(project?.demo_delivered_at),
      teslimEdenKisi: project?.demo_delivered_by_name ?? '',
      teslimAlanKisi: project?.demo_received ? (project?.demo_received_by ?? '') : '',
    }
  }
  if (kind === 'ozalit') {
    return { ...blank, teslimAlanKisi: project?.ozalit_received ? (project?.ozalit_received_by ?? '') : '' }
  }
  // baski_onay never leaves the building — it has no teslimat of its own.
  return blank
}

/**
 * Layer resolved stamps over a sheet's form. A blank stamp never overwrites
 * what the snapshot carries: "the server has nothing to say about this" is
 * not the same as "this was delivered by nobody", and it is the only thing
 * standing between a legacy ozalit sheet and a wiped TESLİM EDEN KİŞİ.
 */
export function withTeslimat(form, stamps) {
  const out = { ...(form ?? {}) }
  for (const [key, value] of Object.entries(stamps ?? {})) if (value) out[key] = value
  return out
}
