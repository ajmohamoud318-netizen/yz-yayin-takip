/**
 * Tests for the Ürün Bilgileri auto-capture that runs when a project enters
 * production (Üretime Hazır).
 *
 * The case that matters most is the third one: a project with NO catalog, whose
 * whole spec lives in the sheet's `_customRows`. That shape produced nothing at
 * all before this feature — the client's write-back deliberately no-ops without
 * a catalog — which left the project unorderable by Sales.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  componentsFromSpecPayload,
  mergeComponents,
  captureProductInfoFromSpec,
  inferComponentKind,
} from './product-info-capture.js'

const row = (label, value) => ({ label, value })

describe('componentsFromSpecPayload', () => {
  it('turns each selected parça card into its own component', () => {
    const comps = componentsFromSpecPayload({
      isinAdi: 'Matematik 8',
      _selectedComponents: [
        { component: 'KİTAP', rows: [row('EBAT', '19,5 x 27,5'), row('KAĞIT', '80 gr enso')] },
        { component: 'KUTU', rows: [row('EBAT', '20 x 28 x 5')] },
      ],
      _customRows: [row('YOK SAYILMALI', 'custom rows are ignored when cards exist')],
    }, 'Matematik 8')

    assert.deepEqual(comps, [
      {
        component: 'KİTAP',
        date: '',
        kind: 'main',
        fields: [
          { k: 'İŞİN ADI', v: 'KİTAP' },
          { k: 'EBAT', v: '19,5 x 27,5' },
          { k: 'KAĞIT', v: '80 gr enso' },
        ],
      },
      {
        component: 'KUTU',
        date: '',
        kind: 'kutu',
        fields: [
          { k: 'İŞİN ADI', v: 'KUTU' },
          { k: 'EBAT', v: '20 x 28 x 5' },
        ],
      },
    ])
  })

  it('drops ADET rows — they describe one print run, not the product', () => {
    const [comp] = componentsFromSpecPayload({
      _selectedComponents: [{
        component: 'KİTAP',
        rows: [row('ADET', '5.000'), row('ADET (Kutu)', '250'), row('EBAT', '19,5 x 27,5')],
      }],
    }, 'Kitap')
    assert.deepEqual(comp.fields.map((f) => f.k), ['İŞİN ADI', 'EBAT'])
  })

  it('does not repeat İŞİN ADI as a spec row', () => {
    const [comp] = componentsFromSpecPayload({
      _selectedComponents: [{
        component: 'KİTAP',
        rows: [row('İŞİN ADI', 'KİTAP'), row('CİLT', 'amerikan cilt')],
      }],
    }, 'Kitap')
    assert.deepEqual(comp.fields, [
      { k: 'İŞİN ADI', v: 'KİTAP' },
      { k: 'CİLT', v: 'amerikan cilt' },
    ])
  })

  it('builds a single parça from _customRows when the project has no catalog', () => {
    const comps = componentsFromSpecPayload({
      isinAdi: 'Fen Bilimleri 7',
      _selectedComponents: null,
      _customRows: [row('EBAT', '19,5 x 27,5'), row('RENK', '4+4')],
    }, 'Fen Bilimleri 7 — 2. Baskı')

    assert.equal(comps.length, 1)
    assert.equal(comps[0].component, 'Fen Bilimleri 7')
    assert.deepEqual(comps[0].fields, [
      { k: 'İŞİN ADI', v: 'Fen Bilimleri 7' },
      { k: 'EBAT', v: '19,5 x 27,5' },
      { k: 'RENK', v: '4+4' },
    ])
  })

  it('falls back to the project title when the sheet carries no İŞİN ADI', () => {
    const [comp] = componentsFromSpecPayload(
      { _customRows: [row('EBAT', '19,5 x 27,5')] },
      'Fen Bilimleri 7',
    )
    assert.equal(comp.component, 'Fen Bilimleri 7')
  })

  it('returns nothing for an empty or absent sheet', () => {
    assert.deepEqual(componentsFromSpecPayload(null, 'X'), [])
    assert.deepEqual(componentsFromSpecPayload({}, 'X'), [])
    // Blank rows only — writing this would flip has_product_info on for a
    // product whose spec sheet is empty.
    assert.deepEqual(componentsFromSpecPayload({ _customRows: [row('', '')] }, 'X'), [])
    // Nothing but ADET is still nothing.
    assert.deepEqual(componentsFromSpecPayload({ _customRows: [row('ADET', '500')] }, 'X'), [])
  })

  it('skips nameless and duplicate parça cards', () => {
    const comps = componentsFromSpecPayload({
      _selectedComponents: [
        { component: 'KİTAP', rows: [row('EBAT', 'a')] },
        { component: '  ', rows: [row('EBAT', 'b')] },
        { component: 'kitap', rows: [row('EBAT', 'c')] },
      ],
    }, 'X')
    assert.deepEqual(comps.map((c) => c.component), ['KİTAP'])
  })
})

describe('mergeComponents', () => {
  const kitap = { component: 'KİTAP', date: '', fields: [{ k: 'EBAT', v: 'leader typed this' }] }
  const kutu = { component: 'KUTU', date: '', fields: [{ k: 'EBAT', v: 'from the sheet' }] }

  it('appends only parçalar the catalog is missing', () => {
    const { merged, added } = mergeComponents([kitap], [
      { component: 'KİTAP', date: '', fields: [{ k: 'EBAT', v: 'sheet version' }] },
      kutu,
    ])
    assert.deepEqual(added, ['KUTU'])
    assert.equal(merged.length, 2)
    // The leader's hand-typed parça is untouched, in place, and wins.
    assert.deepEqual(merged[0], kitap)
    assert.deepEqual(merged[1], kutu)
  })

  it('matches existing parçalar case-insensitively (Turkish locale)', () => {
    const { added } = mergeComponents([{ component: 'kitap', fields: [] }], [
      { component: 'KİTAP', date: '', fields: [] },
    ])
    assert.deepEqual(added, [], 'İ/i must not read as a different parça')
  })

  it('treats a missing/blank catalog as an empty one', () => {
    const { merged, added } = mergeComponents(undefined, [kutu])
    assert.deepEqual(added, ['KUTU'])
    assert.deepEqual(merged, [kutu])
  })

  it('overwrite: true replaces an existing parça in place instead of skipping it', () => {
    const { merged, added, updated } = mergeComponents([kitap], [
      { component: 'KİTAP', date: '', fields: [{ k: 'EBAT', v: 'baski onay value' }] },
      kutu,
    ], { overwrite: true })
    assert.deepEqual(updated, ['KİTAP'])
    assert.deepEqual(added, ['KUTU'])
    assert.equal(merged.length, 2)
    assert.deepEqual(merged[0].fields, [{ k: 'EBAT', v: 'baski onay value' }])
    assert.deepEqual(merged[1], kutu)
  })

  it('overwrite: true still matches existing parçalar case-insensitively', () => {
    const { updated } = mergeComponents([{ component: 'kitap', fields: [] }], [
      { component: 'KİTAP', date: '', fields: [{ k: 'EBAT', v: 'x' }] },
    ], { overwrite: true })
    assert.deepEqual(updated, ['KİTAP'])
  })
})

/* ---------------------------------------------------------------- *
 *  captureProductInfoFromSpec — the DB-facing half                  *
 * ---------------------------------------------------------------- */

// Minimal in-memory pg client. Queries are matched on a distinguishing SQL
// fragment; writes are recorded so the test can assert what was persisted.
// `demoPayloads` is the full result set in preference order (ozalit sheets
// first); `demoPayload` is the single-sheet shorthand.
function makeFakeClient({ demoPayload, demoPayloads, demoKinds, existingComponents }) {
  const sheets = demoPayloads ?? (demoPayload === undefined ? [] : [demoPayload])
  const kinds = demoKinds ?? []
  const writes = []
  return {
    writes,
    async query(sql, params) {
      if (/FROM demos/.test(sql)) {
        return { rows: sheets.map((payload, i) => ({ payload, kind: kinds[i] ?? null })) }
      }
      if (/SELECT components FROM product_info/.test(sql)) {
        return { rows: existingComponents === undefined ? [] : [{ components: existingComponents }] }
      }
      if (/INSERT INTO product_info/.test(sql)) {
        writes.push({ projectId: params[0], components: JSON.parse(params[1]), updatedBy: params[2] })
        return { rows: [] }
      }
      return { rows: [] }
    },
  }
}

const project = { id: 'p-1', title: 'Fen Bilimleri 7' }
const actor = { id: 'u-aysenur', name: 'Ayşenur' }

describe('captureProductInfoFromSpec', () => {
  it('writes the sheet into an empty catalog and reports what it added', async () => {
    const client = makeFakeClient({
      demoPayload: { isinAdi: 'Fen Bilimleri 7', _customRows: [row('EBAT', '19,5 x 27,5')] },
    })
    const result = await captureProductInfoFromSpec(client, { project, actor })

    assert.deepEqual(result, { added: ['Fen Bilimleri 7'], updated: [] })
    assert.equal(client.writes.length, 1)
    assert.equal(client.writes[0].projectId, 'p-1')
    assert.equal(client.writes[0].updatedBy, 'u-aysenur')
    assert.deepEqual(client.writes[0].components[0].fields, [
      { k: 'İŞİN ADI', v: 'Fen Bilimleri 7' },
      { k: 'EBAT', v: '19,5 x 27,5' },
    ])
  })

  it('never overwrites a parça the leader already entered', async () => {
    const leaderSpec = [{ component: 'KİTAP', date: '', fields: [{ k: 'EBAT', v: 'leader value' }] }]
    const client = makeFakeClient({
      demoPayload: {
        _selectedComponents: [{ component: 'KİTAP', rows: [row('EBAT', 'sheet value')] }],
      },
      existingComponents: leaderSpec,
    })
    const result = await captureProductInfoFromSpec(client, { project, actor })

    assert.equal(result, null, 'nothing new → no write at all')
    assert.equal(client.writes.length, 0, 'updated_by/updated_at must keep pointing at the human')
  })

  it('adds the missing parça alongside the leader-typed one', async () => {
    const client = makeFakeClient({
      demoPayload: {
        _selectedComponents: [
          { component: 'KİTAP', rows: [row('EBAT', 'sheet value')] },
          { component: 'KUTU', rows: [row('EBAT', '20 x 28 x 5')] },
        ],
      },
      existingComponents: [{ component: 'KİTAP', date: '', fields: [{ k: 'EBAT', v: 'leader value' }] }],
    })
    const result = await captureProductInfoFromSpec(client, { project, actor })

    assert.deepEqual(result, { added: ['KUTU'], updated: [] })
    const written = client.writes[0].components
    assert.deepEqual(written.map((c) => c.component), ['KİTAP', 'KUTU'])
    assert.equal(written[0].fields[0].v, 'leader value', 'leader value survives')
  })

  it('is a no-op when the project has no demo/ozalit sheet at all', async () => {
    const client = makeFakeClient({})
    assert.equal(await captureProductInfoFromSpec(client, { project, actor }), null)
    assert.equal(client.writes.length, 0)
  })

  it('prefers baski_onay, then ozalit, falling back to demo for ÇİN', async () => {
    // The preference is expressed in SQL (ORDER BY kind = 'baski_onay' DESC,
    // kind = 'ozalit' DESC) rather than in JS, so assert the query carries it.
    const seen = []
    const client = {
      async query(sql) {
        seen.push(sql)
        return { rows: [] }
      },
    }
    await captureProductInfoFromSpec(client, { project, actor })
    const demoQuery = seen.find((s) => /FROM demos/.test(s))
    assert.match(demoQuery, /ORDER BY \(kind = 'baski_onay'\) DESC, \(kind = 'ozalit'\) DESC/)
    assert.match(demoQuery, /attempt DESC/, 'latest round of that kind wins')
  })

  it('a baski_onay sheet — a team leader\'s post-ozalit correction — wins over ozalit', async () => {
    const client = makeFakeClient({
      demoPayloads: [
        { _selectedComponents: [{ component: 'KİTAP', rows: [row('EBAT', 'baski onay value')] }] },
        { _selectedComponents: [{ component: 'KİTAP', rows: [row('EBAT', 'ozalit value')] }] },
      ],
    })
    await captureProductInfoFromSpec(client, { project, actor })
    assert.equal(client.writes[0].components[0].fields[1].v, 'baski onay value')
  })

  it('a baski_onay sheet DOES overwrite a parça already in the catalog — unlike ozalit/demo', async () => {
    const client = makeFakeClient({
      demoPayload: {
        _selectedComponents: [{ component: 'KİTAP', rows: [row('EBAT', 'leader corrected this on baski onay')] }],
      },
      demoKinds: ['baski_onay'],
      existingComponents: [{ component: 'KİTAP', date: '', fields: [{ k: 'EBAT', v: 'stale ozalit value' }] }],
    })
    const result = await captureProductInfoFromSpec(client, { project, actor })

    assert.deepEqual(result, { added: [], updated: ['KİTAP'] })
    assert.equal(client.writes.length, 1)
    assert.deepEqual(client.writes[0].components[0].fields, [
      { k: 'İŞİN ADI', v: 'KİTAP' },
      { k: 'EBAT', v: 'leader corrected this on baski onay' },
    ])
  })

  it('falls back to the demo sheet when the ozalit sheet carries no spec', async () => {
    // The real-world shape on a project with no catalog: the leader's ozalit
    // form opens empty, so "Matbaaya Gönder" stores a sheet with the header
    // fields but no rows. Preferring it blindly captured nothing and the
    // project entered production with no ürün bilgileri at all.
    const client = makeFakeClient({
      demoPayloads: [
        { isinAdi: 'Fen Bilimleri 7', ozalitIsteyenKisi: 'Ayşenur', _customRows: [], _selectedComponents: [] },
        { isinAdi: 'Fen Bilimleri 7', _customRows: [row('EBAT', '19,5 x 27,5'), row('CİLT', 'amerikan cilt')] },
      ],
    })
    const result = await captureProductInfoFromSpec(client, { project, actor })

    assert.deepEqual(result, { added: ['Fen Bilimleri 7'], updated: [] })
    assert.deepEqual(client.writes[0].components[0].fields, [
      { k: 'İŞİN ADI', v: 'Fen Bilimleri 7' },
      { k: 'EBAT', v: '19,5 x 27,5' },
      { k: 'CİLT', v: 'amerikan cilt' },
    ])
  })

  it('an ozalit sheet that HAS a spec still wins over the demo sheet', async () => {
    const client = makeFakeClient({
      demoPayloads: [
        { _selectedComponents: [{ component: 'KİTAP', rows: [row('EBAT', 'ozalit value')] }] },
        { _selectedComponents: [{ component: 'KİTAP', rows: [row('EBAT', 'demo value')] }] },
      ],
    })
    await captureProductInfoFromSpec(client, { project, actor })
    assert.equal(client.writes[0].components[0].fields[1].v, 'ozalit value')
  })
})

/* ---------------------------------------------------------------- *
 *  inferComponentKind — the kind-tagging helper                      *
 * ---------------------------------------------------------------- */

// The leader's product_info payload (and the demo/ozalit auto-capture's
// output) flows through this helper to land a structured `kind` on every
// component. The server uses the same helper to backfill legacy rows on
// read, so all three surfaces — write, capture, GET — classify a given
// name identically. The name-based heuristic is brittle enough that
// locking these expectations down is worth its own block.
describe('inferComponentKind', () => {
  it('classifies the project title (no KUTU / KILAVUZ) as `main`', () => {
    assert.equal(inferComponentKind('RİNGOO (6-99 YAŞ)'), 'main')
    assert.equal(inferComponentKind('POFİDİK PUZZLE ÇİFTLİK'), 'main')
    assert.equal(inferComponentKind(''), 'main')
  })

  it('classifies a box recipe by the "KUTU" suffix', () => {
    assert.equal(inferComponentKind('KUTU REÇETESİ'), 'kutu')
    assert.equal(inferComponentKind('RİNGOO - KUTU'), 'kutu')
    assert.equal(inferComponentKind('POFİDİK PUZZLE ÇİFTLİK - KUTU'), 'kutu')
  })

  it('classifies a guide recipe by the "KILAVUZ" suffix', () => {
    assert.equal(inferComponentKind('KILAVUZ REÇETESİ'), 'kilavuz')
    assert.equal(inferComponentKind('RİNGOO - KILAVUZ'), 'kilavuz')
    assert.equal(inferComponentKind('ÖĞRETMEN KILAVUZU'), 'kilavuz')
  })

  it('prefers KILAVUZ over KUTU when the name contains both', () => {
    // "KILAVUZ KUTUSU" (the guide's own box) must classify as kilavuz so the
    // leader's tag matches the parça they're actually describing.
    assert.equal(inferComponentKind('KILAVUZ KUTUSU'), 'kilavuz')
  })

  it('is locale-aware (İ vs i collapse to the same class)', () => {
    assert.equal(inferComponentKind('kutu'), 'kutu')
    assert.equal(inferComponentKind('KUTU'), 'kutu')
    assert.equal(inferComponentKind('kilavuz'), 'kilavuz')
    assert.equal(inferComponentKind('KILAVUZ'), 'kilavuz')
  })
})
