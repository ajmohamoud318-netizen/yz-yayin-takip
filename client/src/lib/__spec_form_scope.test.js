/**
 * Narrowing a spec sheet to the parça its reader was handed (migration 074).
 *
 * The matbaa's queue is per-parça while the sheet is per-round, so "KUTU ·
 * İşlemi Başlatın" used to open a three-parça document and leave the printer to
 * work out which page the button meant. These are the rules that stop the
 * narrowing from doing damage of its own: it never invents an empty sheet, and
 * it never quietly drops a parça without the dialog being able to name it.
 */
import { describe, expect, it } from 'vitest'

import {
  hiddenParcaNames, scopeComponents, opensNarrowed, resolveSheetScope, parcaAddFlag,
} from '@/lib/spec-form-scope'

const comp = (component) => ({ id: component, component, rows: [] })
const sheet = [comp('KİTAP'), comp('KUTU'), comp('KILAVUZ')]

/**
 * Which of the three scopes wins, and whether the sheet starts narrowed.
 *
 * The add case is the one worth pinning: it narrows on a different rule than a
 * decision does, and the obvious implementation — routing everything through
 * `opensNarrowed` — silently opens the whole round the moment a leader has two
 * parçalar to send, which is exactly the complaint this exists to answer.
 */
/**
 * One save path feeds two routes with different body schemas, and the sipariş
 * one is `additionalProperties: false`. That makes "absent" and "false"
 * genuinely different values here, which is the trap these pin.
 */
describe('parcaAddFlag', () => {
  it('claims the add when there are parçalar to add', () => {
    expect(parcaAddFlag(['KİTAP'])).toEqual({ allowParcaAdd: true })
    expect(parcaAddFlag(['KİTAP', 'KILAVUZ'])).toEqual({ allowParcaAdd: true })
  })

  it('OMITS the key entirely on an ordinary save — never sends false', () => {
    // The regression: `allowParcaAdd: false` is a defined value, so it survives
    // JSON and reaches the server. On the sipariş ozalit route — same call,
    // stricter schema — that made Fastify 400 every ordinary correction.
    expect(parcaAddFlag(null)).toEqual({})
    expect(parcaAddFlag(undefined)).toEqual({})
    expect(parcaAddFlag([])).toEqual({})
    expect('allowParcaAdd' in parcaAddFlag(null)).toBe(false)
  })

  it('does not claim an add on a list of nothing', () => {
    expect(parcaAddFlag([null, undefined, ''])).toEqual({})
  })

  it('spreads into a body without leaving a stray key', () => {
    const ordinary = { attempt: 3, payload: {}, ...parcaAddFlag(null) }
    expect(Object.keys(ordinary).sort()).toEqual(['attempt', 'payload'])

    const adding = { attempt: 3, payload: {}, ...parcaAddFlag(['KİTAP']) }
    expect(Object.keys(adding).sort()).toEqual(['allowParcaAdd', 'attempt', 'payload'])
  })
})

describe('resolveSheetScope', () => {
  it('opens the whole sheet when nothing scoped it', () => {
    expect(resolveSheetScope()).toEqual({ scope: null, scopeOnly: false })
    expect(resolveSheetScope({})).toEqual({ scope: null, scopeOnly: false })
  })

  it('narrows a one-parça decision', () => {
    expect(resolveSheetScope({ decision: ['KUTU'] }))
      .toEqual({ scope: ['KUTU'], scopeOnly: true })
  })

  it('opens a bulk decision on the whole round', () => {
    // "Tüm parçaları onaylayın" is a decision ABOUT the round, so the round is
    // what has to be read before taking it.
    expect(resolveSheetScope({ decision: ['KUTU', 'KİTAP'] }))
      .toEqual({ scope: ['KUTU', 'KİTAP'], scopeOnly: false })
  })

  it('narrows a per-parça edit', () => {
    expect(resolveSheetScope({ edit: ['KİTAP'] }))
      .toEqual({ scope: ['KİTAP'], scopeOnly: true })
  })

  it('narrows an add of one parça', () => {
    expect(resolveSheetScope({ add: ['KİTAP'] }))
      .toEqual({ scope: ['KİTAP'], scopeOnly: true })
  })

  it('narrows an add of several — unlike a bulk decision', () => {
    // The regression: routed through opensNarrowed this opened the whole round,
    // so "Kalan Parçaları Gönderin" showed every parça including the ones
    // already at the matbaa. Sending two parçalar is not a decision about five.
    expect(resolveSheetScope({ add: ['KİTAP', 'KILAVUZ'] }))
      .toEqual({ scope: ['KİTAP', 'KILAVUZ'], scopeOnly: true })
  })

  it('lets an add win over a stale edit or decision scope', () => {
    // They are cleared on every open in practice; precedence is stated so a
    // leftover value cannot quietly widen the sheet an add was opened for.
    expect(resolveSheetScope({ decision: ['KUTU'], edit: ['KUTU'], add: ['KİTAP'] }))
      .toEqual({ scope: ['KİTAP'], scopeOnly: true })
  })

  it('ignores an empty add and falls through to the rest', () => {
    expect(resolveSheetScope({ add: [], edit: ['KİTAP'] }))
      .toEqual({ scope: ['KİTAP'], scopeOnly: true })
    expect(resolveSheetScope({ add: [null], decision: ['KUTU', 'KİTAP'] }))
      .toEqual({ scope: ['KUTU', 'KİTAP'], scopeOnly: false })
  })

  it('prefers a decision over an edit', () => {
    expect(resolveSheetScope({ decision: ['KUTU'], edit: ['KİTAP'] }).scope).toEqual(['KUTU'])
  })
})

describe('scopeComponents', () => {
  it('keeps only the parçalar the caller asked for', () => {
    expect(scopeComponents(sheet, ['KUTU']).map((c) => c.component)).toEqual(['KUTU'])
  })

  it('keeps them in the sheet order, not the order they were clicked', () => {
    // The sheet's order is the catalog's (lib/spec-form-selection.js) and it is
    // also the page order on paper — a bulk stamp must not reshuffle it.
    expect(scopeComponents(sheet, ['KILAVUZ', 'KİTAP']).map((c) => c.component))
      .toEqual(['KİTAP', 'KILAVUZ'])
  })

  it('shows the whole sheet when there is no scope', () => {
    expect(scopeComponents(sheet, null)).toHaveLength(3)
    expect(scopeComponents(sheet, [])).toHaveLength(3)
    expect(scopeComponents(sheet, [null, ''])).toHaveLength(3)
  })

  it('matches names the way parça names actually vary', () => {
    // Queue rows and sheet blocks come from the same string, but a rename in
    // Ürün Bilgileri or a stray space must not blank the document.
    expect(scopeComponents(sheet, ['  kutu  ']).map((c) => c.component)).toEqual(['KUTU'])
    expect(scopeComponents([comp('Kılavuz')], ['KILAVUZ']).map((c) => c.component))
      .toEqual(['Kılavuz'])
  })

  it('falls back to the whole sheet when the scope matches nothing', () => {
    // A routing row from a previous round, or a parça since renamed. Showing
    // everything is what the printer had before per-parça routing; showing an
    // empty sheet tells them nothing and hides the job.
    expect(scopeComponents(sheet, ['POSTER'])).toHaveLength(3)
  })

  it('survives a sheet with no parçalar at all', () => {
    expect(scopeComponents([], ['KUTU'])).toEqual([])
    expect(scopeComponents(null, ['KUTU'])).toEqual([])
    expect(scopeComponents([null, comp('KUTU')], ['KUTU'])).toHaveLength(1)
  })
})

describe('hiddenParcaNames', () => {
  it('names what the narrowed sheet is not showing', () => {
    const shown = scopeComponents(sheet, ['KUTU'])
    expect(hiddenParcaNames(sheet, shown)).toEqual(['KİTAP', 'KILAVUZ'])
  })

  it('is empty when nothing is hidden', () => {
    expect(hiddenParcaNames(sheet, sheet)).toEqual([])
    expect(hiddenParcaNames(sheet, scopeComponents(sheet, null))).toEqual([])
  })
})

describe('opensNarrowed', () => {
  it('opens on the parça when the sheet is about exactly one', () => {
    // The leader's per-row Onayla / Reddedin, the designer's send-back, and
    // the correction a released parça is waiting for.
    expect(opensNarrowed(['KUTU'])).toBe(true)
  })

  it('opens on the whole round when the sheet is about several', () => {
    // "Tüm parçaları onaylayın" and the matbaa's "Hepsini Başlatın" are
    // decisions about the round, so the round is what has to be read.
    expect(opensNarrowed(['KUTU', 'KİTAP'])).toBe(false)
  })

  it('is not a scope at all when empty or absent', () => {
    expect(opensNarrowed([])).toBe(false)
    expect(opensNarrowed(null)).toBe(false)
    expect(opensNarrowed(undefined)).toBe(false)
    // A list of nothing but blanks is the same as no list.
    expect(opensNarrowed([null, ''])).toBe(false)
  })
})
