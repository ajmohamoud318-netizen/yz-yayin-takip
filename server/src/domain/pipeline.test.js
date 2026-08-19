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
  canRequestOrder, assertOrderable, isCatalogListed,
  canRequestHandover, assertHandoverEligible,
  isLegacyProject, assertNotLegacy,
  isAtOrPastStage,
} from './pipeline.js'

describe('pipeline', () => {
  it('TR pipeline leads to satista in 9 stages', () => {
    const p = getPipeline('TR')
    assert.equal(p.length, 9)
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

  it('isAtOrPastStage makes a sipariş final approval forward-only', () => {
    // A project already past uretimde (e.g. sold through, or another
    // concurrent order got there first) must not be regressed by a second
    // order's approval.
    assert.equal(isAtOrPastStage({ type: 'TR', stage: 'satista' }, 'uretimde'), true)
    assert.equal(isAtOrPastStage({ type: 'TR', stage: 'uretimde' }, 'uretimde'), true)
    // Still short of uretimde — the approval should be allowed to advance it.
    assert.equal(isAtOrPastStage({ type: 'TR', stage: 'uretime_hazir' }, 'uretimde'), false)
    assert.equal(isAtOrPastStage({ type: 'TR', stage: 'tasarim' }, 'uretimde'), false)
    // CIN pipeline: gumruk sits after uretimde, so it's also "past".
    assert.equal(isAtOrPastStage({ type: 'CIN', stage: 'gumruk' }, 'uretimde'), true)
    assert.equal(isAtOrPastStage({ type: 'CIN', stage: 'uretime_hazir' }, 'uretimde'), false)
  })
})

describe('catalog delisting (kaldırma, migration 033)', () => {
  const listed = { stage: 'satista', has_product_info: true }
  const delisted = { ...listed, catalog_hidden: true }

  it('isCatalogListed follows the flag, not the stage alone', () => {
    assert.equal(isCatalogListed(listed), true)
    assert.equal(isCatalogListed(delisted), false)
    // Rows written before 033 have no column value at all — still listed.
    assert.equal(isCatalogListed({ stage: 'uretime_hazir' }), true)
    assert.equal(isCatalogListed({ stage: 'tasarim' }), false)
    assert.equal(isCatalogListed(undefined), false)
  })

  it('a delisted product cannot be ordered even when otherwise perfect', () => {
    assert.equal(canRequestOrder(delisted), false)
    assert.throws(() => assertOrderable(delisted), /katalogdan kaldırıldı/)
  })

  it('re-listing restores orderability', () => {
    assert.equal(canRequestOrder({ ...delisted, catalog_hidden: false }), true)
    assert.doesNotThrow(() => assertOrderable({ ...delisted, catalog_hidden: false }))
  })

  it('the delisted message is distinct from the not-ready one', () => {
    // A delisted product IS at a finished stage with a spec, so reusing the
    // generic text would tell Sales to wait for something already done.
    assert.throws(() => assertOrderable(delisted), (err) => !/üretime hazır/.test(err.message))
  })
})

describe('legacy (kayıtlı ürün) products', () => {
  const legacy = { stage: 'satista', origin: 'legacy', has_product_info: true }
  const pipeline = { stage: 'satista', origin: 'pipeline', has_product_info: true }

  it('identifies imported backlist rows by origin', () => {
    assert.equal(isLegacyProject(legacy), true)
    assert.equal(isLegacyProject(pipeline), false)
    // A row predating migration 031 has no origin at all — must not be legacy.
    assert.equal(isLegacyProject({ stage: 'satista' }), false)
    assert.equal(isLegacyProject(undefined), false)
  })

  it('blocks pipeline transitions on a legacy product', () => {
    assert.throws(() => assertNotLegacy(legacy), { status: 400 })
    assert.throws(() => assertNotLegacy(legacy), /Kayıtlı ürün/)
    assert.doesNotThrow(() => assertNotLegacy(pipeline))
    assert.doesNotThrow(() => assertNotLegacy({ stage: 'tasarim' }))
    assert.doesNotThrow(() => assertNotLegacy(undefined))
  })

  it('still lets Sales order a legacy product — that is the point of importing it', () => {
    // The sipariş and teslim guards are intentionally origin-blind.
    assert.equal(canRequestOrder(legacy), true)
    assert.doesNotThrow(() => assertOrderable(legacy))
    assert.equal(canRequestHandover({ type: 'TR', stage: 'uretimde', origin: 'legacy' }), true)
  })

  it('is imported at 100% so it clears the production gate it already passed', () => {
    // The import route sets progress: 100 for exactly this reason — every
    // orderable stage is in STAGES_REQUIRING_FULL_PROGRESS.
    assert.doesNotThrow(() => assertCanEnterProduction('satista', 100))
    assert.throws(() => assertCanEnterProduction('satista', 0), /%100/)
  })
})
