/**
 * Domain tests — pipeline rules.
 * Run with `npm test` or `npm run test:domain`.
 *
 * These tests guard the load-bearing business rules: the only place in the
 * app where "is this transition legal?" is answered. If any of these break,
 * the seed flow + the live advance/approve/reject paths are all at risk.
 */
import {
  STAGE_PIPELINE,
  STAGES_REQUIRING_FULL_PROGRESS,
  getPipeline,
  getNextStage,
  assertCanEnterProduction,
  canRequestOrder,
  assertOrderable,
  handoverStageFor,
  canRequestHandover,
  assertHandoverEligible,
} from '../index.js'

describe('getPipeline', () => {
  it('returns the TR pipeline for type "TR"', () => {
    expect(getPipeline('TR')).toEqual(STAGE_PIPELINE.TR)
  })
  it('returns the ÇİN pipeline for type "CIN"', () => {
    expect(getPipeline('CIN')).toEqual(STAGE_PIPELINE.CIN)
  })
  it('falls back to TR for an unknown type', () => {
    expect(getPipeline('XX')).toEqual(STAGE_PIPELINE.TR)
  })
})

describe('getNextStage', () => {
  it('advances within the TR pipeline', () => {
    expect(getNextStage({ type: 'TR', stage: 'tasarim' })).toBe('demo_teslim')
    expect(getNextStage({ type: 'TR', stage: 'demo_onay' })).toBe('ozalit_teslim')
  })
  it('returns null at the last stage (no satışta — that comes from handover)', () => {
    expect(getNextStage({ type: 'TR', stage: 'satista' })).toBeNull()
    expect(getNextStage({ type: 'CIN', stage: 'satista' })).toBeNull()
  })
  it('returns null for a stage not on the pipeline', () => {
    expect(getNextStage({ type: 'TR', stage: 'mystery' })).toBeNull()
  })
})

describe('assertCanEnterProduction (100% gate)', () => {
  it('lets the demo stages open at partial progress', () => {
    // Demo can be requested mid-design (no throw).
    expect(() => assertCanEnterProduction('demo_teslim', 50)).not.toThrow()
    expect(() => assertCanEnterProduction('cin_demo_teslim', 0)).not.toThrow()
  })
  it('blocks Ozalit onward at < 100%', () => {
    for (const stage of STAGES_REQUIRING_FULL_PROGRESS) {
      expect(() => assertCanEnterProduction(stage, 99)).toThrow(/%100 tamamlanmadan/)
    }
  })
  it('allows Ozalit onward at exactly 100%', () => {
    for (const stage of STAGES_REQUIRING_FULL_PROGRESS) {
      expect(() => assertCanEnterProduction(stage, 100)).not.toThrow()
    }
  })
  it('treats undefined progress as 0', () => {
    expect(() => assertCanEnterProduction('ozalit_teslim', undefined)).toThrow()
  })
})

describe('canRequestOrder / assertOrderable', () => {
  it('accepts only satışta', () => {
    expect(canRequestOrder({ stage: 'satista' })).toBe(true)
    expect(canRequestOrder({ stage: 'uretime_hazir' })).toBe(false)
    expect(canRequestOrder({ stage: 'uretimde' })).toBe(false)
    expect(canRequestOrder({ stage: 'tasarim' })).toBe(false)
  })
  it('throws 400 on a non-satisfying stage with status set', () => {
    try {
      assertOrderable({ stage: 'tasarim' })
      throw new Error('should have thrown')
    } catch (e) {
      expect(e.status).toBe(400)
      expect(e.message).toMatch(/satışta olan/)
    }
  })
  it('throws on missing project (defensive)', () => {
    expect(() => assertOrderable(undefined)).toThrow(/satışta olan/)
  })
})

describe('handoverStageFor / canRequestHandover / assertHandoverEligible', () => {
  it('TR hands over from uretimde', () => {
    expect(handoverStageFor('TR')).toBe('uretimde')
    expect(canRequestHandover({ type: 'TR', stage: 'uretimde' })).toBe(true)
  })
  it('ÇİN hands over from gumruk', () => {
    expect(handoverStageFor('CIN')).toBe('gumruk')
    expect(canRequestHandover({ type: 'CIN', stage: 'gumruk' })).toBe(true)
  })
  it('rejects handovers raised at the wrong stage', () => {
    expect(canRequestHandover({ type: 'TR', stage: 'tasarim' })).toBe(false)
    expect(canRequestHandover({ type: 'CIN', stage: 'uretimde' })).toBe(false)
    expect(canRequestHandover({ type: 'TR', stage: 'satista' })).toBe(false)
  })
  it('assertHandoverEligible throws 400 with status on wrong stage', () => {
    try {
      assertHandoverEligible({ type: 'TR', stage: 'tasarim' })
      throw new Error('should have thrown')
    } catch (e) {
      expect(e.status).toBe(400)
      expect(e.message).toMatch(/üretimi tamamlanan/)
    }
  })
  it('falls back to TR handover stage for an unknown type', () => {
    expect(handoverStageFor('XX')).toBe('uretimde')
  })
})
