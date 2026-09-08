/**
 * Deciding a parça before its round is finished — the client's half (migration 076).
 *
 * The matbaa delivers a multi-parça round one parça at a time and the project
 * deliberately waits at its *_teslim stage for the last one. Until now the
 * leader's side knew nothing about that: every approval surface keys off the
 * *_onay stage, so a parça that came back early could not be received, approved
 * or rejected — the leader saw a notification and no way to act on it.
 *
 * These predicates are what the UI asks instead, and they mirror
 * `parcaAwaitsReceipt` / `parcaDecidable` in server/src/domain/parca-routing.js.
 * Keep the two in step: this pair decides whether the buttons render, that pair
 * decides whether the click survives.
 */
import { describe, expect, it } from 'vitest'

import { parcaAwaitsReceipt, parcaDecidable, earlyParcaGateOpen } from '@/domain'

const atGate = (extra = {}) => ({
  parca: 'KUTU', state: 'pending', owner_role: null,
  delivered_at: '2026-09-08T09:00:00Z', received_at: null, ...extra,
})
const receivedRow = (extra = {}) => atGate({ received_at: '2026-09-08T10:00:00Z', ...extra })
const atMatbaa = () => ({
  parca: 'KİTAP', state: 'with_matbaa', owner_role: 'printer',
  delivered_at: null, received_at: null,
})

describe('parcaAwaitsReceipt', () => {
  it('is a delivered parça nobody has acknowledged yet', () => {
    expect(parcaAwaitsReceipt(atGate())).toBe(true)
  })

  it('is not a parça that has already been received', () => {
    expect(parcaAwaitsReceipt(receivedRow())).toBe(false)
  })

  it('is not a parça still on somebody else\'s desk', () => {
    expect(parcaAwaitsReceipt(atMatbaa())).toBe(false)
    expect(parcaAwaitsReceipt({ ...atGate(), state: 'with_designer' })).toBe(false)
  })

  it('is not an ekran round — there is no physical proof to receive', () => {
    // An ekran parça comes back to the gate with no delivery stamp at all.
    expect(parcaAwaitsReceipt({ ...atGate(), route: 'ekran', delivered_at: null })).toBe(false)
  })

  it('survives a missing row', () => {
    expect(parcaAwaitsReceipt(null)).toBe(false)
    expect(parcaAwaitsReceipt(undefined)).toBe(false)
  })
})

describe('parcaDecidable', () => {
  it('needs both halves: delivered AND taken delivery of', () => {
    expect(parcaDecidable(receivedRow())).toBe(true)
    expect(parcaDecidable(atGate())).toBe(false)
    expect(parcaDecidable({ ...receivedRow(), delivered_at: null })).toBe(false)
  })

  it('refuses a parça that has been handed back out', () => {
    expect(parcaDecidable({ ...receivedRow(), state: 'with_matbaa' })).toBe(false)
  })
})

describe('earlyParcaGateOpen', () => {
  it('opens on a teslim stage as soon as one parça is back', () => {
    expect(earlyParcaGateOpen({ stage: 'demo_teslim' }, [atGate(), atMatbaa()])).toBe(true)
    expect(earlyParcaGateOpen({ stage: 'ozalit_teslim' }, [receivedRow()])).toBe(true)
    expect(earlyParcaGateOpen({ stage: 'cin_demo_teslim' }, [atGate()])).toBe(true)
  })

  it('stays shut while the whole round is still in the press', () => {
    // Three rows of "Matbaada" is not a decision surface — the parça status
    // panel already says that, and the grid would be pure noise.
    expect(earlyParcaGateOpen({ stage: 'demo_teslim' }, [atMatbaa()])).toBe(false)
    expect(earlyParcaGateOpen({ stage: 'demo_teslim' }, [])).toBe(false)
  })

  it('stays shut at the gate stages — the whole-round receipt governs there', () => {
    expect(earlyParcaGateOpen({ stage: 'demo_onay' }, [atGate()])).toBe(false)
    expect(earlyParcaGateOpen({ stage: 'ozalit_onay' }, [receivedRow()])).toBe(false)
    expect(earlyParcaGateOpen({ stage: 'baski_onay' }, [receivedRow()])).toBe(false)
  })

  it('survives a missing project or rows', () => {
    expect(earlyParcaGateOpen(null, [receivedRow()])).toBe(false)
    expect(earlyParcaGateOpen({ stage: 'demo_teslim' }, null)).toBe(false)
  })
})
