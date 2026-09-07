// Ledger-key selection for the per-parça approval grid
// (migrations 068/069/070).
//
// The bug this pins: TR and ÇİN both store the baskı sheet under snapshot
// kind `baski_onay`, but they keep SEPARATE per-parça ledgers
// (`baski_parca_*` vs `cin_baski_parca_*`). Approvals.jsx used to hard-code
// the TR key for the whole baskı tab, so a ÇİN project's already-approved
// parçalar all read as unsigned.
//
// `ledgerKindForStage` is the pure half of `useParcaSnapshot` — the part
// that carries the rule — so it is tested on its own without a DOM.

import { describe, it, expect } from 'vitest'

import { ledgerKindForStage } from './useParcaSnapshot.js'
import { pendingParcalar } from '@/domain'

describe('ledgerKindForStage', () => {
  it('maps ozalit_onay to the ozalit ledger', () => {
    expect(ledgerKindForStage('ozalit_onay')).toBe('ozalit')
  })

  it('keeps TR and ÇİN baskı on separate ledgers', () => {
    expect(ledgerKindForStage('baski_onay')).toBe('baski_onay')
    expect(ledgerKindForStage('cin_baski_onay')).toBe('cin_baski_onay')
  })

  it('maps both demo onay stages to the shared demo ledger', () => {
    expect(ledgerKindForStage('demo_onay')).toBe('demo')
    expect(ledgerKindForStage('cin_demo_onay')).toBe('demo')
  })

  it('falls back to demo for any other stage', () => {
    expect(ledgerKindForStage('tasarim')).toBe('demo')
    expect(ledgerKindForStage(undefined)).toBe('demo')
  })
})

describe('ÇİN baskı ledger is read through the cin_* mirror', () => {
  const SNAPSHOT = ['KUTU', 'KİTAP']
  // A ÇİN project whose KUTU is fully prepared+approved by two different
  // leaders. Only the cin_* ledger carries it; the TR columns are empty.
  const cinProject = {
    stage: 'cin_baski_onay',
    baski_parca_preparers: {},
    baski_parca_approvals: {},
    cin_baski_parca_preparers: { KUTU: { by: 'u-1' } },
    cin_baski_parca_approvals: { KUTU: { by: 'u-2' } },
  }

  it('shows KUTU as settled under the correct key', () => {
    const kind = ledgerKindForStage(cinProject.stage)
    expect(pendingParcalar(cinProject, kind, SNAPSHOT)).toEqual(['KİTAP'])
  })

  it('would have shown both parçalar pending under the old TR key', () => {
    // Regression guard: this is exactly what the queue used to render.
    expect(pendingParcalar(cinProject, 'baski_onay', SNAPSHOT)).toEqual(SNAPSHOT)
  })
})
