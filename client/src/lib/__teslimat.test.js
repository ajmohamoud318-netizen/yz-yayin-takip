/**
 * Regression tests for "the matbaa delivered it but TESLİM TARİHİ is empty".
 *
 * The teslimat künye rows were stamped into the sheet's snapshot and nowhere
 * else. A round that gets corrected after it is sent lives in two snapshot
 * slots, the stamp lands in whichever one the matbaa's form was read from,
 * and every other reader of that round printed a delivered demo with three
 * empty boxes. These pin the rule that replaced it: the project row is where
 * the teslimat is resolved from, and the snapshot only fills what the server
 * has nothing to say about.
 */
import { describe, expect, it } from 'vitest'
import { liveTeslimat, withTeslimat } from '@/lib/teslimat'
import { buildFormKunye } from '@/lib/specPrint'

const labels = (pairs) => pairs.map(([label]) => label)
const valueOf = (pairs, label) => pairs.find(([l]) => l === label)?.[1]

const DELIVERED_DEMO = {
  demo_delivered_at: '2026-08-14T09:30:00.000Z',
  demo_delivered_by_name: 'Oktay',
  demo_received: true,
  demo_received_by: 'Aylin',
}

describe('liveTeslimat', () => {
  it('reads a delivered demo round off the project, not off the sheet', () => {
    expect(liveTeslimat({ project: DELIVERED_DEMO, kind: 'demo' })).toEqual({
      teslimTarihi: '14 Ağustos 2026',
      teslimEdenKisi: 'Oktay',
      teslimAlanKisi: 'Aylin',
    })
  })

  it('leaves every box blank while the round is still with the matbaa', () => {
    expect(liveTeslimat({ project: { demo_received: false }, kind: 'demo' })).toEqual({
      teslimTarihi: '', teslimEdenKisi: '', teslimAlanKisi: '',
    })
  })

  it('reports no receipt until someone actually answered the gate', () => {
    const undelivered = { ...DELIVERED_DEMO, demo_received: false, demo_received_by: null }
    expect(liveTeslimat({ project: undelivered, kind: 'demo' }).teslimAlanKisi).toBe('')
  })

  it('has only the receipt for an ozalit — that leg records no delivery', () => {
    const project = { ozalit_received: true, ozalit_received_by: 'Ayşenur' }
    expect(liveTeslimat({ project, kind: 'ozalit' })).toEqual({
      teslimTarihi: '', teslimEdenKisi: '', teslimAlanKisi: 'Ayşenur',
    })
  })

  it("reads a sipariş round off the order's own ledger", () => {
    const order = { matbaa_received: true, matbaa_received_by: 'Serpil' }
    expect(liveTeslimat({ project: DELIVERED_DEMO, order, kind: 'ozalit' }).teslimAlanKisi).toBe('Serpil')
  })

  it('says nothing about a Baskı Onay Formu, which never leaves the building', () => {
    expect(liveTeslimat({ project: DELIVERED_DEMO, kind: 'baski_onay' })).toEqual({
      teslimTarihi: '', teslimEdenKisi: '', teslimAlanKisi: '',
    })
  })

  it('survives a project it has never heard of', () => {
    expect(liveTeslimat({ project: null, kind: 'demo' })).toEqual({
      teslimTarihi: '', teslimEdenKisi: '', teslimAlanKisi: '',
    })
  })
})

describe('withTeslimat', () => {
  it('overwrites a stale snapshot stamp with what the server knows', () => {
    const form = { isinAdi: 'Fen 7', teslimEdenKisi: 'eski' }
    expect(withTeslimat(form, { teslimEdenKisi: 'Oktay' })).toEqual({
      isinAdi: 'Fen 7', teslimEdenKisi: 'Oktay',
    })
  })

  it('never wipes a stamp the server has nothing to say about', () => {
    // The ozalit leg has no delivery columns, so a legacy ozalit sheet's own
    // TESLİM EDEN KİŞİ is the only record there is — blanking it would lose it.
    const form = { teslimEdenKisi: 'Oktay', teslimTarihi: '14 Ağustos 2026' }
    expect(withTeslimat(form, { teslimEdenKisi: '', teslimTarihi: '', teslimAlanKisi: 'Aylin' })).toEqual({
      teslimEdenKisi: 'Oktay', teslimTarihi: '14 Ağustos 2026', teslimAlanKisi: 'Aylin',
    })
  })

  it('leaves the form alone when there is nothing to layer', () => {
    expect(withTeslimat({ isinAdi: 'Fen 7' }, null)).toEqual({ isinAdi: 'Fen 7' })
    expect(withTeslimat(null, { teslimAlanKisi: 'Aylin' })).toEqual({ teslimAlanKisi: 'Aylin' })
  })
})

describe('buildFormKunye — TESLİM ALAN KİŞİ', () => {
  const kunye = (form) => buildFormKunye({ form, kind: 'demo' })

  it('prints the receipt row once someone has signed for the delivery', () => {
    const pairs = kunye(withTeslimat({}, liveTeslimat({ project: DELIVERED_DEMO, kind: 'demo' })))
    expect(labels(pairs)).toContain('TESLİM ALAN KİŞİ')
    expect(valueOf(pairs, 'TESLİM ALAN KİŞİ')).toBe('Aylin')
    expect(valueOf(pairs, 'TESLİM EDEN KİŞİ')).toBe('Oktay')
    expect(valueOf(pairs, 'TESLİM TARİHİ')).toBe('14 Ağustos 2026')
  })

  it('stays off a sheet nobody has taken delivery of yet', () => {
    const pairs = kunye({ teslimTarihi: '14 Ağustos 2026', teslimEdenKisi: 'Oktay' })
    expect(labels(pairs)).toContain('TESLİM EDEN KİŞİ')
    expect(labels(pairs)).not.toContain('TESLİM ALAN KİŞİ')
  })

  it('stays off an undelivered sheet entirely', () => {
    expect(labels(kunye({ demoIstemTarihi: '1 Ağustos 2026' }))).toEqual([
      'DEMO İSTEM TARİHİ', 'DEMO İSTEYEN KİŞİ',
    ])
  })
})
