/**
 * Server-side mirror tests. Kept deliberately identical in shape to the
 * client-side domain tests so the two domains are guaranteed to agree.
 *
 * Run with: node --test server/src/domain/*.test.js
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  getPipeline, getNextStage, assertCanEnterProduction,
  canRequestOrder, assertOrderable,
  canRequestHandover, assertHandoverEligible,
} from './pipeline.js'

describe('pipeline', () => {
  it('TR pipeline leads to satista in 8 stages', () => {
    const p = getPipeline('TR')
    assert.equal(p.length, 8)
    assert.equal(p[p.length - 1], 'satista')
  })

  it('CIN pipeline includes gumruk', () => {
    const p = getPipeline('CIN')
    assert.ok(p.includes('gumruk'))
  })

  it('getNextStage moves to the next pipeline step', () => {
    assert.equal(getNextStage({ type: 'TR', stage: 'tasarim' }), 'demo_teslim')
    assert.equal(getNextStage({ type: 'CIN', stage: 'cin_demo_onay' }), 'uretime_hazir')
    assert.equal(getNextStage({ type: 'TR', stage: 'satista' }), null)
  })

  it('assertCanEnterProduction blocks Ozalit+ below 100%', () => {
    assert.doesNotThrow(() => assertCanEnterProduction('uretime_hazir', 100))
    assert.throws(() => assertCanEnterProduction('demo_teslim', 50), /100/)
    assert.doesNotThrow(() => assertCanEnterProduction('tasarim', 0))
  })

  it('assertOrderable fires only when the project is satista', () => {
    assert.doesNotThrow(() => assertOrderable({ stage: 'satista' }))
    assert.throws(() => assertOrderable({ stage: 'tasarim' }), /satışta/)
    // Critical parity check with the client bug we patched: undefined must throw.
    assert.throws(() => assertOrderable(undefined), /satışta/)
  })

  it('handover eligibility depends on pipeline type', () => {
    assert.equal(canRequestHandover({ type: 'TR', stage: 'uretimde' }), true)
    assert.equal(canRequestHandover({ type: 'CIN', stage: 'gumruk' }), true)
    assert.equal(canRequestHandover({ type: 'TR', stage: 'tasarim' }), false)
    assert.doesNotThrow(() => assertHandoverEligible({ type: 'CIN', stage: 'gumruk' }))
    assert.throws(() => assertHandoverEligible({ type: 'TR', stage: 'tasarim' }), /üretimi tamamlanan/)
  })

  it('canRequestOrder keeps its earlier semantics for unknown stages', () => {
    assert.equal(canRequestOrder({ stage: 'satista' }), true)
    assert.equal(canRequestOrder({ stage: 'tasarim' }), false)
  })
})
