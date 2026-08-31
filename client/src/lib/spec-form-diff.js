/**
 * The "Değişiklikler" diff (migration 049) — what a leader changed on an
 * already-sent sheet, computed against the baseline snapshot of what the
 * matbaa currently has.
 *
 * Split out of SpecFormDialog.jsx (slice: client god-components) as pure
 * functions: the dialog owns fetching the baseline and rendering the panel,
 * this owns deciding what counts as a change.
 */

/** Rows changed since baseline, by matching row `id` (stable across a save
 * cycle — new rows only get a fresh id when actually added). Shared by the
 * custom-rows diff and the per-parça-component diff below. */
export function diffRows(baseRows, liveRows, prefix) {
  const entries = []
  const baseById = new Map((baseRows ?? []).map((r) => [String(r.id), r]))
  const liveIds = new Set()
  for (const r of liveRows ?? []) {
    liveIds.add(String(r.id))
    const b = baseById.get(String(r.id))
    const label = r.label || b?.label || 'Satır'
    if (!b) {
      if (r.label || r.value) entries.push({ status: 'added', label: `${prefix}${label}`, newValue: r.value || '—' })
    } else if (b.label !== r.label || b.value !== r.value) {
      entries.push({ status: 'changed', label: `${prefix}${label}`, oldValue: b.value || '—', newValue: r.value || '—' })
    }
  }
  for (const b of baseRows ?? []) {
    if (!liveIds.has(String(b.id)) && (b.label || b.value)) {
      entries.push({ status: 'removed', label: `${prefix}${b.label || 'Satır'}`, oldValue: b.value || '—' })
    }
  }
  return entries
}

/**
 * Every change the live sheet carries over the baseline: the sheet's own
 * added rows, plus each selected parça's rows and the parçalar themselves.
 *
 * Returns null when there is no baseline (the panel only exists on the
 * "Gönderilen Demoyu/Ozaliti Düzenleyin" path), and an empty array when the
 * live sheet still matches what the matbaa has — which is what the footer
 * reads to know there is nothing to send.
 */
export function buildChangeSummary(baseline, { customRows, selectedComponents, catalogComponents }) {
  if (!baseline) return null
  const entries = [...diffRows(baseline.customRows, customRows, '')]

  const baseComponents = baseline.selectedComponents ?? catalogComponents
  const baseCompById = new Map(baseComponents.map((c) => [c.id, c]))
  const liveCompIds = new Set()
  for (const c of selectedComponents) {
    liveCompIds.add(c.id)
    const b = baseCompById.get(c.id)
    if (!b) {
      entries.push({ status: 'added', label: 'Parça eklendi', newValue: c.component })
      continue
    }
    entries.push(...diffRows(b.rows, c.rows, `${c.component} — `))
  }
  for (const b of baseComponents) {
    if (!liveCompIds.has(b.id)) entries.push({ status: 'removed', label: 'Parça kaldırıldı', oldValue: b.component })
  }
  return entries
}
