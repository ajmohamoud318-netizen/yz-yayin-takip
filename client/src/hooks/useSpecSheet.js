import { useEffect, useMemo, useRef, useState } from 'react'

import api from '@/api'
import { getComponentsForProject, getComponentRows, primeProductInfoCache } from '@/data/productCatalog'
import { buildAdetRows, buildOrderAdetRows, loadOrderAdet } from '@/data/orderAdet'
import { hasSpecContent, specWithDemoFallback } from '@/lib/spec-seed'
import { resolveSayfaSayisiRows } from '@/lib/spec-form-resolve'
import { hydrateComponent, inCatalogOrder } from '@/lib/spec-form-selection'
import { liveTeslimat, withTeslimat } from '@/lib/teslimat'
import { formatNumber } from '@/lib/utils'
import { VARIANTS } from '@/lib/spec-form-variants'
import {
  emptyForm,
  fetchServerSnapshot,
  fetchServerSnapshotById,
  loadSaved,
  loadSnapshot,
  moveById,
  stripStamps,
  withRoundStamps,
  withoutBlankStamps,
} from '@/lib/spec-form-storage'

/**
 * The CONTENT of a spec sheet: which sheet is on screen, where its values were
 * loaded from, and every edit made to them.
 *
 * Split out of SpecFormDialog.jsx (slice: client god-components). The dialog
 * keeps the decisions — who may edit, which slot a save goes to, what each
 * button does — and this hook keeps the sheet itself: the catalog of parçalar,
 * the three pieces of state that make up a sheet (form fields, added rows,
 * selected parçalar), the load that fills them, and the row editors.
 *
 * Every flag it takes is derived by the dialog, deliberately: they answer
 * questions about the ROUND (is this a fresh compose, is it read-only, does
 * the project's teslimat describe this sheet) that only the dialog's props can
 * answer, and passing them in keeps that reasoning in one place instead of
 * being re-derived here from a second copy of the same props.
 */
export function useSpecSheet({
  open,
  variant,
  project,
  order,
  user,
  mode,
  scopeId,
  orderId,
  orderScoped,
  viewAttempt,
  viewDemoId,
  notifyOnSave,
  rejectContext,
  readOnly,
  viewingSentSheet,
  showsLiveTeslimat,
  attemptNo,
  liveAttempts,
}) {
  const [form, setForm] = useState(() => emptyForm(variant, project, user))
  const [customRows, setCustomRows] = useState([])
  const [selectedComponents, setSelectedComponents] = useState([]) // [{ id, component, rows }]
  // Slot the sheet on screen was actually loaded from — null until the load
  // effect resolves it. See liveAttempts / writeAttempt in the dialog.
  const [liveAttemptNo, setLiveAttemptNo] = useState(null)
  // Bumped once the server spec has been fetched for this project, so the
  // catalog memo below recomputes with fresh data even on a cold cache.
  const [catalogVersion, setCatalogVersion] = useState(0)
  // Whether the parça selection on screen was decided by anything other than
  // the catalog default — a snapshot that recorded one, or the user touching
  // the picker. While this is false the selection is still the catalog's to
  // make, which is what lets a catalog that only arrives AFTER the load has
  // resolved still fill it in (see the adopt effect below).
  const selectionExplicit = useRef(false)
  // Rows of parçalar taken OFF the sheet, kept so re-ticking one restores
  // what the sheet knew rather than the catalog's usually-empty shell. See
  // lib/spec-form-selection.js for why that matters (it is a save away from
  // wiping the reçete). Reset on every load so one project's — or one
  // round's — rows can never reappear on another's sheet.
  const detachedRows = useRef(new Map())

  // Pull the authoritative spec from the server when the dialog opens. The
  // in-memory cache is normally primed at boot, but a project created on
  // another browser (or just created moments ago) may not be there yet — this
  // guarantees the matbaa/designer/leader all see the same, correct parçalar.
  useEffect(() => {
    if (!open || !project?.id) return
    let cancelled = false
    api.getProductInfo(project.id)
      .then((comps) => {
        if (cancelled) return
        primeProductInfoCache([{ project_id: project.id, components: comps }])
        setCatalogVersion((v) => v + 1)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [open, project?.id])

  // Catalog of all components defined for this project (from Ürün Bilgileri).
  const catalogComponents = useMemo(
    () => getComponentsForProject(project?.id).map((c) => ({
      id: c.component,                 // component name is the stable id
      component: c.component,
      rows: getComponentRows(c),
    })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [project?.id, catalogVersion]
  )

  useEffect(() => {
    if (!open || !project) return
    let cancelled = false
    detachedRows.current = new Map()

    async function load() {
      setLiveAttemptNo(null)
      if (viewAttempt != null) {
        // History: show the snapshot exactly as it was saved — no auto-fills.
        // Server snapshot first (works on any computer), localStorage fallback.
        // The one exception is the teslimat, and only while this snapshot is
        // still the open round's: those three rows are resolved from the
        // project, not from the slot the stamp landed in (see showsLiveTeslimat).
        const snap =
          (viewDemoId ? await fetchServerSnapshotById(variant, viewDemoId) : null) ??
          (await fetchServerSnapshot(variant, project.id, viewAttempt, orderId)) ??
          loadSnapshot(variant, scopeId, viewAttempt) ??
          loadSaved(variant, scopeId)
        if (cancelled) return
        setForm(snap
          ? withTeslimat(
            snap.form,
            showsLiveTeslimat ? liveTeslimat({ project, order, kind: variant.kind }) : null,
          )
          : emptyForm(variant, project, user))
        setCustomRows(snap?.customRows ?? [])
        // History shows the sheet as it was saved: whatever parçalar that
        // snapshot carried, and no others. Never the catalog's default.
        selectionExplicit.current = true
        setSelectedComponents(snap?.selectedComponents ?? [])
        return
      }

      // Attempt-scoped snapshot first: the stamps recorded on THIS attempt are
      // the only ones this sheet may show. Only if there's no snapshot for the
      // current attempt do we fall back to the project-level blob — and then
      // strictly for the spec, with the event stamps stripped (see
      // STAMP_FIELDS). Without that strip, a previously approved attempt's
      // ONAYLAYAN KİŞİ reappeared on the next, unapproved attempt.
      const current =
        (await fetchServerSnapshot(variant, project.id, liveAttempts, orderId)) ??
        loadSnapshot(variant, scopeId, attemptNo)
      if (cancelled) return
      // localStorage snapshots are keyed by attemptNo already, so only a
      // server hit can report a different slot.
      setLiveAttemptNo(current?.attempt ?? null)
      const carried =
        loadSaved(variant, scopeId) ??
        (await fetchServerSnapshot(variant, project.id, null, orderId))
      if (cancelled) return
      // Plain viewer (mode='view' && !notifyOnSave) is a personal draft —
      // localStorage is the source of truth so the user's edits show on
      // reopen and the printer is unaffected. Compose / notify / approve
      // still let the server's attempt-scoped snapshot win, because that IS
      // the shared state those flows mutate.
      const draft = (mode === 'view' && !notifyOnSave)
        ? (stripStamps(carried) ?? current)
        : (current ?? stripStamps(carried))
      // A sheet that has already been sent has to reopen as it was sent AND
      // signed — see withRoundStamps for what the stripped blob costs it.
      const data = viewingSentSheet ? withRoundStamps(draft, current) : draft
      const fresh = emptyForm(variant, project, user)
      if (readOnly || variant.restoreSavedOnEdit || rejectContext || viewingSentSheet) {
        // Read-only viewers (printer, leader) — and the plain viewer of an
        // already-sent round (viewingSentSheet) — must see the values that
        // were actually saved at submission time; otherwise the form would
        // show today's date and the matbaa's own name as the requester. Layer
        // the saved form back on top so İŞİN ADI, İSTEM TARİHİ and İSTEYEN
        // KİŞİ reflect what was stamped. The teslim/onay stamps come through only
        // when `current` supplied them, i.e. they really happened — blank ones
        // are dropped so they can't overwrite a legitimately pre-filled
        // signature (see withoutBlankStamps).
        // …and the teslimat over the top of that, from the project's own
        // columns rather than from whichever snapshot slot the stamp happened
        // to land in. See lib/teslimat.js and `showsLiveTeslimat`.
        setForm(withTeslimat(
          { ...fresh, ...withoutBlankStamps(data?.form) },
          showsLiveTeslimat ? liveTeslimat({ project, order, kind: variant.kind }) : null,
        ))
      } else {
        // Active editing: start from fresh, then keep only the printer-signed
        // field (matbaaYetkilisi). The system-driven fields auto-recompute.
        setForm({
          ...fresh,
          ...(data?.form?.matbaaYetkilisi ? { matbaaYetkilisi: data.form.matbaaYetkilisi } : {}),
        })
      }
      // First ozalit round on a project whose ozalit sheet is still empty:
      // borrow the spec the designer already filled in on the demo sheet.
      // See specWithDemoFallback.
      let spec = data
      if (variant.kind === 'ozalit' && !hasSpecContent(data)) {
        // A sipariş's first round borrows from how this product was last
        // printed — the project's own latest ozalit sheet — before falling
        // back to the demo sheet the project pipeline uses. Both are read
        // project-scoped (orderId omitted) on purpose: that IS the point of
        // the fallback. The parça rows come from Baskı Reçeteleri either way;
        // this only carries over the custom rows and İŞİN ADI.
        const fromPrevious = orderScoped
          ? (await fetchServerSnapshot(variant, project.id, null))
          : null
        if (cancelled) return
        const fromDemo = fromPrevious ??
          loadSaved(VARIANTS.demo, scopeId) ??
          (await fetchServerSnapshot(VARIANTS.demo, project.id, null))
        if (cancelled) return
        spec = specWithDemoFallback(data, fromDemo)
      }
      // Baskı Onay Formu always opens pre-filled with the LAST ozalit sheet's
      // information (per the feature ask) until a team leader edits and saves
      // their own — same borrow-once-then-keep-your-own-edits shape as the
      // ozalit-from-demo fallback above. ÇİN has no ozalit sheet (its mirror
      // gate, cin_baski_onay, sits right after cin_demo_onay), so it borrows
      // from the demo sheet instead — same fallback source TR's own ozalit
      // form uses on its first round.
      if (variant.kind === 'baski_onay' && !hasSpecContent(data)) {
        const fallbackVariant = project.type === 'CIN' ? VARIANTS.demo : VARIANTS.ozalit
        const fromFallback =
          loadSaved(fallbackVariant, scopeId) ??
          (await fetchServerSnapshot(fallbackVariant, project.id, null))
        if (cancelled) return
        spec = specWithDemoFallback(data, fromFallback)
      }
      // Resolve the SAYFA SAYISI row to the project's live total_pages. The
      // page count is owned by project düzenleme (the "Toplam iç sayfa"
      // input under the İç Sayfalar subtask) and the spec form displays it
      // read-only, so the resolver always honours the subtask whenever it
      // carries a positive total — replacing 'auto', any stale value, and
      // any accidental override alike. Without a live count, the row is
      // user-owned and passes through verbatim. See
      // lib/spec-form-resolve.js for the pure helper and its tests.
      const savedRows = resolveSayfaSayisiRows(spec?.customRows ?? [], project)
      if (variant.kind === 'baski_onay') {
        // ADET gets its own top-of-sheet field here instead of living as a
        // buried custom row — that row never actually rendered or printed
        // once a project had a catalog (buildSpecRows / the parça cards both
        // skip customRows once parçalar are selected). Prefer a live sipariş
        // order's quantity; on a project's first pass (no order placed yet)
        // fall back to whatever ADET the borrowed ozalit sheet carried, then
        // drop that row so it isn't shown twice.
        let adetValue = data?.form?.[variant.adetField]
        let rowsForCustom = savedRows
        if (!adetValue) {
          // Renamed off `order` — that's the sipariş prop now.
          const lastOrder = loadOrderAdet(project.id)
          adetValue = lastOrder?.quantity ? formatNumber(lastOrder.quantity) : ''
          if (!adetValue) {
            const idx = savedRows.findIndex((r) => r.label?.toUpperCase().startsWith('ADET'))
            if (idx !== -1) {
              adetValue = savedRows[idx].value
              rowsForCustom = savedRows.filter((_, i) => i !== idx)
            }
          }
        }
        if (adetValue) setForm((f) => ({ ...f, [variant.adetField]: adetValue }))
        // BASIM YERİ has no live source to fall back on — no press is recorded
        // anywhere on the project — but the borrowed ozalit/demo sheet can
        // still carry one as a leftover custom row (pre-restructure forms had
        // it as a real field, see OLD_FIELD_LABELS). Lift it into the
        // dedicated row so a required field arrives filled instead of making
        // the leader retype what the previous sheet already said, and drop the
        // duplicate row. 'BASIM YER' as the prefix sidesteps the İ/I casing.
        let basimValue = data?.form?.[variant.locationField]
        if (!basimValue) {
          const idx = rowsForCustom.findIndex((r) => r.label?.toUpperCase().startsWith('BASIM YER'))
          if (idx !== -1) {
            basimValue = rowsForCustom[idx].value
            rowsForCustom = rowsForCustom.filter((_, i) => i !== idx)
          }
        }
        if (basimValue) setForm((f) => ({ ...f, [variant.locationField]: basimValue }))
        setCustomRows(rowsForCustom)
      } else {
        const hasAdet = savedRows.some((r) => r.label?.toUpperCase().startsWith('ADET'))
        // A sipariş carries the ordered quantity on the order itself, so its
        // sheet reads it straight off the row. buildAdetRows is the project
        // pipeline's fallback: localStorage, keyed by project, most recent
        // order only — invisible on every other browser, and silently
        // clobbered by the next order on the same title.
        const adetRows = orderScoped ? buildOrderAdetRows(order) : buildAdetRows(project.id)
        setCustomRows(hasAdet ? savedRows : [...adetRows, ...savedRows])
      }
      // null means never explicitly set — default to all catalog components checked.
      // [] means the user intentionally cleared them — respect that.
      const savedComponents = spec?.selectedComponents ?? null
      selectionExplicit.current = savedComponents !== null
      const baseComponents = savedComponents ?? catalogComponents
      // Each parça carries its own rows; resolve SAYFA SAYISI placeholders on
      // those too (same 'auto' shell, same substitution rule). Editing a
      // resolved row back to 'auto' would round-trip through the snapshot —
      // handleUpdateComponentRow writes r.value verbatim — so this stays a
      // read-time concern and never touches the underlying product_info.
      setSelectedComponents(
        baseComponents.map((c) => ({ ...c, rows: resolveSayfaSayisiRows(c.rows, project) })),
      )
    }

    load()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    // scopeId, not project.id: switching between two sipariş sheets on the
    // same product has to reload, and for a project's own round the two are
    // the same value.
  }, [open, scopeId, viewAttempt, viewDemoId])

  // The catalog can arrive AFTER the load above has resolved. A project
  // created moments ago isn't in the product-info cache: that cache is primed
  // by the projects refetch (useProjectsStore), and creating a project merges
  // the new row into the store without refetching, so the server-seeded
  // product_info never reaches this browser until a reload. The load then ran
  // with an empty catalog and selected nothing — and its deps deliberately
  // exclude catalogComponents, because re-running the whole load would throw
  // away every edit made since the dialog opened.
  //
  // So adopt the default here instead: only while the selection is still the
  // catalog's to make, and only when nothing is selected yet, so a user's own
  // deselection stands. Without this, the first demo form opened on a
  // brand-new project came up with every parça UNCHECKED and fell back to the
  // single İŞİN ADI body — the leader had to tick the parçalar the project
  // was just created with.
  useEffect(() => {
    if (!open || selectionExplicit.current || catalogComponents.length === 0) return
    setSelectedComponents((prev) => (
      prev.length > 0
        ? prev
        : catalogComponents.map((c) => ({ ...c, rows: resolveSayfaSayisiRows(c.rows, project) }))
    ))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, catalogComponents])

  /* ── Parça selection ──────────────────────────────────────────────────── */

  // A parça joining the sheet, carrying the rows the sheet already knew about
  // — a snapshot's, this session's edits, the resolved SAYFA SAYISI — and
  // only falling back to the catalog's own rows (resolved the same way the
  // load effect resolves them) for one that has never been on it.
  const hydrate = (comp) => hydrateComponent(comp, {
    remembered: detachedRows.current,
    resolveRows: (rows) => resolveSayfaSayisiRows(rows, project),
  })

  function toggleComponent(compId) {
    if (readOnly) return
    // From here on the selection is the user's, not the catalog's: a parça
    // they unticked must not come back when the catalog settles.
    selectionExplicit.current = true
    setSelectedComponents((prev) => {
      const exists = prev.find((c) => c.id === compId)
      if (exists) {
        // Remember its rows before it leaves the sheet (see detachedRows).
        detachedRows.current.set(compId, exists.rows ?? [])
        return prev.filter((c) => c.id !== compId)
      }
      const fromCatalog = catalogComponents.find((c) => c.id === compId)
      if (!fromCatalog) return prev
      // Demo: İŞİN ADI is locked to the project title — never overwritten here.
      // Ozalit: first selected component becomes İŞİN ADI.
      if (variant.systemFieldsEditable && prev.length === 0) {
        setForm((f) => ({ ...f, isinAdi: fromCatalog.component }))
      }
      // Catalog order, not tick order — the pages print in this order.
      return inCatalogOrder([...prev, hydrate(fromCatalog)], catalogComponents)
    })
  }
  function selectAllComponents() {
    if (readOnly) return
    selectionExplicit.current = true
    setSelectedComponents((prev) => {
      const onSheet = new Map(prev.map((c) => [c.id, c]))
      return [
        // A parça already on the sheet keeps the rows it has THERE; only the
        // ones being added come from the catalog.
        ...catalogComponents.map((c) => onSheet.get(c.id) ?? hydrate(c)),
        // …and one the catalog no longer lists stays on the sheet instead of
        // being dropped by a button that says "Tümünü Seç".
        ...prev.filter((c) => !catalogComponents.some((k) => k.id === c.id)),
      ]
    })
    if (variant.systemFieldsEditable && catalogComponents[0]) {
      setForm((f) => ({ ...f, isinAdi: catalogComponents[0].component }))
    }
  }
  function clearComponents() {
    if (readOnly) return
    selectionExplicit.current = true
    setSelectedComponents((prev) => {
      // "Hiçbiri" is a selection, not a delete: keep every row so ticking the
      // parça again brings the sheet back as it was.
      for (const c of prev) detachedRows.current.set(c.id, c.rows ?? [])
      return []
    })
  }

  /* ── The sheet's own added rows ───────────────────────────────────────── */

  function addCustomRow() {
    setCustomRows((prev) => [...prev, { id: Date.now() + Math.random(), label: '', value: '' }])
  }
  function updateCustomRow(id, field, val) {
    setCustomRows((prev) => prev.map((r) => (r.id === id ? { ...r, [field]: val } : r)))
  }
  function removeCustomRow(id) {
    setCustomRows((prev) => prev.filter((r) => r.id !== id))
  }
  // Rows are added under İŞİN ADI and the order they are left in is the order
  // they print in, so moving one is a real edit, not a view preference.
  function moveCustomRow(id, dir) {
    setCustomRows((prev) => moveById(prev, id, dir))
  }

  // ── Per-component (parça) spec editing ──────────────────────────────────────
  // Each selected component carries its own auto-filled rows. Editing them here
  // updates the component in place; on save these are merged back into Ürün
  // Bilgileri (see saveEditedComponents in the dialog's save handlers).
  function updateComponentRow(compId, rowId, field, val) {
    setSelectedComponents((prev) =>
      prev.map((c) =>
        c.id !== compId
          ? c
          : { ...c, rows: (c.rows ?? []).map((r) => (r.id === rowId ? { ...r, [field]: val } : r)) },
      ),
    )
  }
  function addComponentRow(compId) {
    setSelectedComponents((prev) =>
      prev.map((c) =>
        c.id !== compId
          ? c
          : { ...c, rows: [...(c.rows ?? []), { id: `row-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, label: '', value: '' }] },
      ),
    )
  }
  function removeComponentRow(compId, rowId) {
    setSelectedComponents((prev) =>
      prev.map((c) => (c.id !== compId ? c : { ...c, rows: (c.rows ?? []).filter((r) => r.id !== rowId) })),
    )
  }
  function moveComponentRow(compId, rowId, dir) {
    setSelectedComponents((prev) =>
      prev.map((c) => (c.id !== compId ? c : { ...c, rows: moveById(c.rows ?? [], rowId, dir) })),
    )
  }
  function handleChange(e) {
    const { name, value } = e.target
    setForm((prev) => ({ ...prev, [name]: value }))
  }

  return {
    form,
    setForm,
    customRows,
    selectedComponents,
    liveAttemptNo,
    catalogComponents,
    handleChange,
    toggleComponent,
    selectAllComponents,
    clearComponents,
    addCustomRow,
    updateCustomRow,
    removeCustomRow,
    moveCustomRow,
    updateComponentRow,
    addComponentRow,
    removeComponentRow,
    moveComponentRow,
  }
}
