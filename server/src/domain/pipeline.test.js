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

  it('assertCanEnterProduction blocks Ozalit+ below 100% but lets demo run at any progress', () => {
    assert.doesNotThrow(() => assertCanEnterProduction('uretime_hazir', 100))
    // demo_teslim no longer requires 100% — demos are allowed at any
    // progress; the hold-at-<100% rule lives in computeApproval instead.
    assert.doesNotThrow(() => assertCanEnterProduction('demo_teslim', 50))
    assert.doesNotThrow(() => assertCanEnterProduction('cin_demo_onay', 0))
    // ozalit onward still requires 100%.
    assert.throws(() => assertCanEnterProduction('ozalit_teslim', 50), /100/)
    assert.throws(() => assertCanEnterProduction('uretime_hazir', 99), /100/)
    assert.doesNotThrow(() => assertCanEnterProduction('tasarim', 0))
  })

  it('assertOrderable fires unless the project has reached an orderable stage AND has a product_info entry', () => {
    assert.doesNotThrow(() => assertOrderable({ stage: 'satista', has_product_info: true }))
    assert.doesNotThrow(() => assertOrderable({ stage: 'uretime_hazir', has_product_info: true }))
    assert.doesNotThrow(() => assertOrderable({ stage: 'uretimde', has_product_info: true }))
    assert.doesNotThrow(() => assertOrderable({ stage: 'gumruk', has_product_info: true }))
    assert.throws(() => assertOrderable({ stage: 'satista', has_product_info: false }), /Ürün Bilgileri/)
    assert.throws(() => assertOrderable({ stage: 'tasarim', has_product_info: true }), /üretime hazır/)
    // Critical parity check with the client bug we patched: undefined must throw.
    assert.throws(() => assertOrderable(undefined), /üretime hazır/)
  })

  it('handover eligibility depends on pipeline type', () => {
    assert.equal(canRequestHandover({ type: 'TR', stage: 'uretimde' }), true)
    assert.equal(canRequestHandover({ type: 'CIN', stage: 'gumruk' }), true)
    assert.equal(canRequestHandover({ type: 'TR', stage: 'tasarim' }), false)
    assert.doesNotThrow(() => assertHandoverEligible({ type: 'CIN', stage: 'gumruk' }))
    assert.throws(() => assertHandoverEligible({ type: 'TR', stage: 'tasarim' }), /üretimi tamamlanan/)
  })

  it('canRequestOrder allows Üretime Hazır onward, given a product_info entry', () => {
    assert.equal(canRequestOrder({ stage: 'satista', has_product_info: true }), true)
    assert.equal(canRequestOrder({ stage: 'satista', has_product_info: false }), false)
    assert.equal(canRequestOrder({ stage: 'uretime_hazir', has_product_info: true }), true)
    assert.equal(canRequestOrder({ stage: 'uretimde', has_product_info: true }), true)
    assert.equal(canRequestOrder({ stage: 'gumruk', has_product_info: true }), true)
    assert.equal(canRequestOrder({ stage: 'tasarim', has_product_info: true }), false)
  })
})
