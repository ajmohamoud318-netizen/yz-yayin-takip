/**
 * Ürün Bilgileri auto-capture on entering production.
 *
 * The spec a designer actually fills in lives in the Demo / Ozalit sheet
 * (`demos.payload`), not in `product_info`. Until now the only way a project
 * got a `product_info` row was the team leader hand-typing it in Ürün
 * Bilgileri, plus a partial write-back from the spec dialog
 * (SpecFormDialog#persistCatalogEdits) that deliberately no-ops when the
 * project has no catalog yet — i.e. exactly the case where the data is
 * missing. The consequence: a project could clear ozalit onayı with a fully
 * filled, signed sheet and still have zero ürün bilgileri, which leaves
 * `has_product_info` false and blocks Sales from raising a sipariş at all
 * (see domain/pipeline.js#assertOrderable).
 *
 * So: the moment a project lands on `baskida` (migration 047) — via TR's
 * `baski_onay` approval or ÇİN's mirrored `cin_baski_onay` approval — the
 * approved sheet is copied into `product_info`. That is the right moment
 * because it is the point the spec stops changing, and it is what unblocks
 * the sipariş flow downstream.
 *
 * Merge policy is per-parça and additive: a parça the leader already wrote by
 * hand is left completely untouched, only parçalar missing from the catalog
 * are appended. Hand-entered data is never overwritten or reordered, so
 * running this twice (or after a manual edit) can't destroy anyone's work.
 */

const up = (s) => String(s ?? '').toLocaleUpperCase('tr-TR')

/**
 * Infer the structured `kind` tag for a parça from its display name. Lets
 * demo/ozalit auto-capture and seed backfill land a sensible `kind` without
 * the leader having to set it manually. The mapping mirrors the seed-data
 * convention: a name containing "KUTU" is the box recipe, "KILAVUZ" the
 * guide, anything else is `main` (the project's primary recipe).
 *
 * - "KUTU REÇETESİ" / "- KUTU" / "RİNGOO (6-99 YAŞ) - KUTU" → 'kutu'
 * - "KILAVUZ" / "KILAVUZ REÇETESİ" → 'kilavuz'
 * - everything else → 'main'  (single-recipe projects AND the first
 *   component of a multi-recipe project; both render as the lead)
 *
 * `other` is reserved for components a leader explicitly tagged that way
 * (or future kinds we don't yet auto-detect).
 *
 * @param   {string}  name
 * @returns {'main'|'kutu'|'kilavuz'}
 */
export function inferComponentKind(name) {
  // Plain `.toUpperCase()` rather than `toLocaleUpperCase('tr-TR')`: the
  // latter turns a lowercase 'i' into a dotted 'İ', so a name written
  // 'kilavuz' would never match the `'KILAVUZ'` substring probe below.
  // We don't need Turkish-aware case folding here — only the two keywords
  // we look for, which are already ASCII letters in the seed data and
  // every project name the leader has typed so far.
  const upper = String(name ?? '').toUpperCase()
  if (!upper) return 'main'
  // KILAVUZ must be checked before KUTU so the rare "KILAVUZ KUTUSU"
  // (guide + box combo) is classified as kilavuz, not kutu.
  if (upper.includes('KILAVUZ')) return 'kilavuz'
  if (upper.includes('KUTU')) return 'kutu'
  return 'main'
}

/**
 * ADET is the ordered quantity for one sipariş, prepended to the sheet from
 * the order (see client/src/data/orderAdet.js#buildAdetRows). It describes a
 * single print run, not the product — baking it into the catalog spec would
 * make the next order inherit the previous run's quantity.
 */
const isAdetLabel = (label) => up(label).startsWith('ADET')

/** Spec rows → product_info `fields`, dropping the rows that don't belong. */
function fieldsFromRows(rows) {
  const out = []
  for (const row of Array.isArray(rows) ? rows : []) {
    const k = String(row?.label ?? '').trim()
    const v = String(row?.value ?? '').trim()
    if (!k && !v) continue
    if (isAdetLabel(k)) continue
    // İŞİN ADI is the parça's own name; the caller writes it as the first
    // field, so a second copy would duplicate it on every rendered sheet.
    if (up(k) === 'İŞİN ADI') continue
    out.push({ k, v })
  }
  return out
}

const toComponent = (name, rows) => ({
  component: name,
  date: '',
  kind: inferComponentKind(name),
  fields: [{ k: 'İŞİN ADI', v: name }, ...fieldsFromRows(rows)],
})

/**
 * Read a saved Demo/Ozalit payload as product_info components.
 *
 * The payload is the form object plus two underscore keys the spec dialog
 * writes: `_selectedComponents` ([{ component, rows: [{label, value}] }]) and
 * `_customRows` ([{ label, value }]).
 *
 * Two shapes to handle:
 *   - the project HAS parçalar → one component per selected parça card
 *   - the project has NO catalog → the sheet is a single unnamed parça and
 *     everything the designer typed sits in `_customRows`. This is the shape
 *     that previously produced nothing at all.
 *
 * @param   {object}  payload       demos.payload (JSONB, already parsed by pg)
 * @param   {string}  fallbackName  project title, used when the sheet has no İŞİN ADI
 * @returns {{component: string, date: string, fields: {k: string, v: string}[]}[]}
 */
export function componentsFromSpecPayload(payload, fallbackName) {
  if (!payload || typeof payload !== 'object') return []

  const selected = Array.isArray(payload._selectedComponents) ? payload._selectedComponents : []
  if (selected.length > 0) {
    const seen = new Set()
    const out = []
    for (const card of selected) {
      const name = String(card?.component ?? '').trim()
      // A card with no name can't be merged (the merge keys on the name) and
      // would render as a nameless sheet — skip it rather than guess.
      if (!name || seen.has(up(name))) continue
      seen.add(up(name))
      out.push(toComponent(name, card.rows))
    }
    return out
  }

  const fields = fieldsFromRows(payload._customRows)
  // An empty sheet is not a spec — writing it would flip has_product_info on
  // for a product with nothing on its spec sheet, which is the exact case
  // listProjects' `components <> '[]'` guard exists to prevent.
  if (fields.length === 0) return []
  const name = String(payload.isinAdi ?? '').trim() || String(fallbackName ?? '').trim()
  if (!name) return []
  return [{ component: name, date: '', fields: [{ k: 'İŞİN ADI', v: name }, ...fields] }]
}

/**
 * Merge freshly captured parçalar into an existing spec.
 *
 * Default (`overwrite: false`): existing entries win outright and keep their
 * position — a demo/ozalit sheet is never authoritative over hand-typed
 * catalog data. Only names absent from `existing` are appended.
 *
 * `overwrite: true` is the Baskı Onay Formu case — the literal final,
 * team-leader-only correction (see captureProductInfoFromSpec below). There
 * a matching parça's fields ARE replaced, in place, since that form is meant
 * to be what actually reaches the catalog even when the parça already
 * existed there. Names new to `existing` are still appended either way.
 *
 * @returns {{merged: object[], added: string[], updated: string[]}}
 */
export function mergeComponents(existing, captured, { overwrite = false } = {}) {
  const base = Array.isArray(existing) ? existing : []
  const added = []
  const updated = []

  if (!overwrite) {
    const known = new Set(base.map((c) => up(c?.component)))
    const merged = [...base]
    for (const comp of captured) {
      if (known.has(up(comp.component))) continue
      known.add(up(comp.component))
      merged.push(comp)
      added.push(comp.component)
    }
    return { merged, added, updated }
  }

  const byName = new Map(base.map((c) => [up(c?.component), c]))
  for (const comp of captured) {
    const key = up(comp.component)
    if (byName.has(key)) updated.push(comp.component)
    else added.push(comp.component)
    byName.set(key, comp)
  }
  const merged = base.map((c) => byName.get(up(c?.component)) ?? c)
  const known = new Set(base.map((c) => up(c?.component)))
  for (const comp of captured) if (!known.has(up(comp.component))) merged.push(comp)
  return { merged, added, updated }
}

/**
 * Copy the project's approved spec sheet into Ürün Bilgileri.
 *
 * Must run inside the transaction that moved the project into production, so
 * the spec and the stage change commit together — a project can never be
 * observed at Üretime Hazır with the capture half-applied.
 *
 * @param   {object} client   pg client inside an open transaction
 * @param   {object} project  the project (needs `id` and `title`)
 * @param   {object} actor    the user whose approval triggered this
 * @returns {Promise<{added: string[]} | null>}  null when nothing was written
 */
export async function captureProductInfoFromSpec(client, { project, actor }) {
  if (!project?.id) return null

  // Prefer the Baskı Onay Formu (migration 044, and ÇİN's mirrored
  // cin_baski_onay gate from migration 047 — stored under the same
  // demos.kind='baski_onay' value): it's the literal final approval —
  // team_leader-only, and the only sheet that may still have been
  // hand-corrected after the ozalit/demo proof was signed. Next, the ozalit
  // sheet: it is the last PRINT proof every TR approver signed off on, so
  // short of a baski_onay edit it reflects the product as it will actually
  // be produced. ÇİN projects have no ozalit stage, but since migration 047
  // they DO have a baski_onay-kind sheet of their own (from cin_baski_onay)
  // that ranks first same as TR's; only a ÇİN project that somehow has
  // neither falls through to its latest demo sheet. Ordering `kind` this
  // way does all three in one query.
  //
  // "Prefer" means "prefer a sheet that HAS a spec", not "take the top-ranked
  // row and give up". On a project with no catalog yet — the exact case this
  // capture exists for — the leader's ozalit form opens empty (SpecFormDialog
  // seeds `selectedComponents` from catalogComponents, which is []), so
  // clicking "Matbaaya Gönder" without retyping the spec stores an ozalit
  // payload with no rows at all. Taking that one row and stopping meant the
  // demo sheet holding the designer's actual spec was never read and the
  // project entered production with zero ürün bilgileri — the bug this whole
  // module was written to prevent. So walk the sheets in preference order and
  // capture the first one that yields anything.
  const { rows: specRows } = await client.query(
    `SELECT payload, kind
       FROM demos
      WHERE project_id = $1
      ORDER BY (kind = 'baski_onay') DESC, (kind = 'ozalit') DESC, attempt DESC, created_at DESC
      LIMIT 50`,
    [project.id],
  )
  let captured = []
  let capturedKind = null
  for (const row of specRows) {
    captured = componentsFromSpecPayload(row.payload, project.title)
    if (captured.length > 0) { capturedKind = row.kind; break }
  }
  if (captured.length === 0) return null

  // FOR UPDATE so a leader saving Ürün Bilgileri at this exact moment can't
  // have their write silently dropped by the upsert below.
  const { rows: existingRows } = await client.query(
    'SELECT components FROM product_info WHERE project_id = $1 FOR UPDATE',
    [project.id],
  )
  const existing = Array.isArray(existingRows[0]?.components) ? existingRows[0].components : []
  // Only a baski_onay sheet is the literal final, team-leader-only correction
  // (see the module docstring / AGENTS.md) — a parça it names should always
  // reach the catalog, even one that's already there. A demo/ozalit-sourced
  // capture (ÇİN projects, or a TR project whose baski_onay carried no spec)
  // keeps the additive-only safety net, since neither sheet is anyone's final
  // sign-off on the product spec.
  const overwrite = capturedKind === 'baski_onay'
  const { merged, added, updated } = mergeComponents(existing, captured, { overwrite })
  // Nothing new and nothing to overwrite — leave the row alone entirely so
  // `updated_by` / `updated_at` keep pointing at the human who last edited it.
  if (added.length === 0 && updated.length === 0) return null

  await client.query(
    `INSERT INTO product_info (project_id, components, updated_by, updated_at)
     VALUES ($1, $2::jsonb, $3, NOW())
     ON CONFLICT (project_id)
     DO UPDATE SET components = EXCLUDED.components,
                   updated_by = EXCLUDED.updated_by,
                   updated_at = NOW()`,
    [project.id, JSON.stringify(merged), actor?.id ?? null],
  )
  return { added, updated }
}

/** Timeline note for a capture — lists the parçalar that were written. */
export const captureHistoryNote = (names) =>
  `Ürün bilgileri onaylanan formdan otomatik kaydedildi: ${names.join(', ')}`
