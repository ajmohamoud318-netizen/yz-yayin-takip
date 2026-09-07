import { useEffect, useState } from 'react'

import { VARIANTS, specVariantForStage } from '@/lib/spec-form-variants'
import { fetchServerSnapshot } from '@/lib/spec-form-storage'
import { parcaNames, ozalitDecidable } from '@/domain'

/**
 * The parça list the current approval gate is standing on (migrations
 * 068/069/070).
 *
 * The per-parça ledgers ride on the project row, so the grid reads those
 * straight off `project`. What it CAN'T read from there is the round's parça
 * list: that lives on the latest demo/ozalit/baskı snapshot's
 * `_selectedComponents`, which is a `demos` row. Approvals.jsx pulls the whole
 * table once and indexes it by `${project_id}|${kind}` because it renders a
 * queue; a detail page only ever needs one project's newest row, so this asks
 * for exactly that via the same helper the spec-form dialog loads through.
 *
 * `ledgerKind` is deliberately NOT the same value as the snapshot kind. Both
 * baskı stages store their sheet under kind `baski_onay`, but TR and ÇİN keep
 * SEPARATE ledgers (`baski_parca_*` vs `cin_baski_parca_*`), so a ÇİN project
 * read through the TR key would show every parça as unsigned and invite a
 * second approval the server then refuses. The snapshot lookup goes through
 * `specVariantForStage`; the ledger key is picked here.
 *
 * @param {{ id?: string, stage?: string } | null | undefined} project
 * @returns {{ parcalar: string[], ledgerKind: 'demo'|'ozalit'|'baski_onay'|'cin_baski_onay' }}
 */
export function useParcaSnapshot(project) {
  const projectId = project?.id
  const stage = project?.stage
  const [parcalar, setParcalar] = useState([])

  useEffect(() => {
    const variantName = GATE_STAGES.has(stage) ? specVariantForStage(stage) : null
    const variant = variantName ? VARIANTS[variantName] : null
    if (!projectId || !variant) {
      setParcalar([])
      return undefined
    }
    let cancelled = false
    // orderId null: a sipariş's own ozalit sheet (migration 053) carries the
    // same project_id and kind as the project's, and this grid gates the
    // PROJECT's round — without the filter it would render the sipariş's
    // parçalar against the project's ledger.
    fetchServerSnapshot(variant, projectId, null, null)
      .then((snap) => {
        if (!cancelled) setParcalar(parcaNames(snap?.selectedComponents))
      })
      .catch(() => {
        // The grid is additive: the single whole-round Onayla/Reddet buttons
        // stay on screen either way, so a failed snapshot read hides the grid
        // rather than breaking the page.
        if (!cancelled) setParcalar([])
      })
    return () => { cancelled = true }
  }, [projectId, stage])

  return { parcalar, ledgerKind: ledgerKindForStage(stage) }
}

/** Stages that actually run a per-parça approval gate. */
const GATE_STAGES = new Set([
  'demo_onay', 'cin_demo_onay', 'ozalit_onay', 'baski_onay', 'cin_baski_onay',
])

/**
 * Which per-parça ledger a stage reads. Mirrors the server's own branch in
 * `computeApproval` — notably `cin_baski_onay` → the `cin_*` mirror.
 *
 * @param {string | undefined} stage
 */
export function ledgerKindForStage(stage) {
  if (stage === 'ozalit_onay') return 'ozalit'
  if (stage === 'cin_baski_onay') return 'cin_baski_onay'
  if (stage === 'baski_onay') return 'baski_onay'
  return 'demo'
}

/**
 * Can this round be signed off at all right now?
 *
 * The per-parça grid is an approval surface, so it must answer to the same
 * receipt gates `computeApproval` enforces server-side — otherwise it renders
 * Onayla/Reddet on a round the server refuses, and the leader gets a 400
 * ("Önce ozalit \"Teslim Alındı\" olarak işaretlenmelidir.") from a button that
 * looked live. The whole-round buttons already lead with "Teslim Alın" in that
 * state; the grid has to stay out of the way for the same reason.
 *
 *  • demo_onay / cin_demo_onay — needs `demo_received` (transitions.js#L833).
 *  • ozalit_onay — needs a received physical proof OR a screen round;
 *    `ozalitDecidable` is the client's copy of that rule, and it also
 *    excludes the in-place redo leg, where a rejected proof is parked on the
 *    stage while the designer revizes and nothing is signable.
 *  • baskı onayı — no receipt step at all; the sheet is authored in place.
 *
 * @param {{ stage?: string, demo_received?: boolean } | null | undefined} project
 */
export function parcaRoundDecidable(project) {
  const stage = project?.stage
  if (stage === 'demo_onay' || stage === 'cin_demo_onay') return project?.demo_received === true
  if (stage === 'ozalit_onay') return ozalitDecidable(project)
  if (stage === 'baski_onay' || stage === 'cin_baski_onay') return true
  return false
}
