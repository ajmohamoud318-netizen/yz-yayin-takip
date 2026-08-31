/**
 * Printing a spec sheet — split out of SpecFormDialog.jsx (slice: client
 * god-components). The dialog renders the sheet on screen; this puts the same
 * sheet(s) on paper through the shared specPrint helper.
 */

import { toast } from 'sonner'

import { printSpecSheets, buildFormSheet } from '@/lib/specPrint'

/**
 * Print every selected parça in ONE job (one classic sheet per parça, page
 * break between). If nothing is selected, prints the single custom-row sheet.
 * Uses the shared specPrint helper so Dökümanlar and this dialog stay in sync.
 */
export function openMultiPrint({ form, customRows, project, attemptNo, kind, selectedComponents }) {
  const attemptLabel = `${attemptNo}. ${kind === 'ozalit' ? 'OZALİT' : kind === 'baski_onay' ? 'BASKI ONAY' : 'DEMO'}`
  const selected = (selectedComponents ?? []).filter(Boolean)
  const comps = selected.length > 0
    ? selected
    : [{ component: form.isinAdi || project?.title || '', rows: (customRows ?? []).filter((r) => r.label) }]
  // Each sheet is headed by the job and names its own parça as İŞİN ADI —
  // otherwise the KUTU sheet would read as the book itself.
  const sheets = comps.map((c) => buildFormSheet({ component: c, form, kind, title: project?.title || '', attemptLabel }))
  const ok = printSpecSheets(sheets, { docTitle: `${attemptLabel} — ${project?.title ?? ''}` })
  if (!ok) toast.error('Pop-up engelleyiciyi kontrol edin.')
}

