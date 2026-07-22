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
  assertDemoCanAdvance,
  canRequestOrder,
  assertOrderable,
  handoverStageFor,
  canRequestHandover,
  assertHandoverEligible,
  isOzalitApprover,
  isDemoApprover,
  canRejectAtStage,
  canEditProductInfo,
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
  it('blocks every post-design stage at < 100% — ozalit onward is locked', () => {
    // Note: demo_teslim / cin_demo_teslim / demo_onay / cin_demo_onay are
    // deliberately NOT in STAGES_REQUIRING_FULL_PROGRESS anymore. A demo
    // round can run at any progress; the hold at <100% is enforced by
    // assertDemoCanAdvance when the leader approves (server side).
    for (const stage of STAGES_REQUIRING_FULL_PROGRESS) {
      expect(() => assertCanEnterProduction(stage, 99)).toThrow(/%100 tamamlanmadan/)
    }
  })
  it('lets tasarım‑stage transitions stay open at partial progress', () => {
    expect(() => assertCanEnterProduction('tasarim', 0)).not.toThrow()
  })
  it('allows demo stages at any progress (gate starts at ozalit)', () => {
    // The demo rule: any progress is OK for entering demo_teslim /
    // demo_onay / cin_demo_teslim / cin_demo_onay. The actual advance
    // out of demo_onay is what assertDemoCanAdvance guards.
    for (const stage of ['demo_teslim', 'demo_onay', 'cin_demo_teslim', 'cin_demo_onay']) {
      expect(() => assertCanEnterProduction(stage, 0)).not.toThrow()
      expect(() => assertCanEnterProduction(stage, 50)).not.toThrow()
      expect(() => assertCanEnterProduction(stage, 100)).not.toThrow()
    }
  })
  it('allows every post-design stage at exactly 100%', () => {
    for (const stage of STAGES_REQUIRING_FULL_PROGRESS) {
      expect(() => assertCanEnterProduction(stage, 100)).not.toThrow()
    }
  })
  it('treats undefined progress as 0', () => {
    // demo_teslim now accepts undefined (the gate no longer covers it).
    expect(() => assertCanEnterProduction('demo_teslim', undefined)).not.toThrow()
    // ozalit_teslim still requires 100% — undefined falls through to the gate.
    expect(() => assertCanEnterProduction('ozalit_teslim', undefined)).toThrow()
  })
})

describe('assertDemoCanAdvance (approve-but-hold rule)', () => {
  it('returns null at 100% (project may advance)', () => {
    expect(assertDemoCanAdvance(100)).toBeNull()
    expect(assertDemoCanAdvance(150)).toBeNull() // over-100 is treated as OK
  })
  it('returns a Turkish hold reason at < 100%', () => {
    const msg = assertDemoCanAdvance(50)
    expect(msg).toMatch(/tasarım tamamlanmadan/i)
    expect(msg).toMatch(/yeni bir demo/i)
  })
  it('treats undefined progress as 0', () => {
    expect(assertDemoCanAdvance(undefined)).toMatch(/tasarım tamamlanmadan/i)
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

/* ─── capability helpers ──────────────────────────────────────────────────── */

const LEADER = { role: 'team_leader' }
const PRINTER = { role: 'printer' }
const DESIGNER = { role: 'designer' }

describe('isOzalitApprover (ozalit_onay approval)', () => {
  it('allows team_leader', () => {
    expect(isOzalitApprover(LEADER)).toBe(true)
  })
  it('denies designer / printer / satis / missing', () => {
    expect(isOzalitApprover(DESIGNER)).toBe(false)
    expect(isOzalitApprover(PRINTER)).toBe(false)
    expect(isOzalitApprover({ role: 'satis' })).toBe(false)
    expect(isOzalitApprover(undefined)).toBe(false)
  })
})

describe('isDemoApprover (demo_onay / cin_demo_onay approval)', () => {
  it('allows team_leader and printer', () => {
    expect(isDemoApprover(LEADER)).toBe(true)
    expect(isDemoApprover(PRINTER)).toBe(true)
  })
  it('denies designer / satis', () => {
    expect(isDemoApprover(DESIGNER)).toBe(false)
    expect(isDemoApprover({ role: 'satis' })).toBe(false)
  })
})

describe('canRejectAtStage', () => {
  it('lets team_leader reject at any stage', () => {
    for (const stage of [
      'demo_onay', 'cin_demo_onay', 'ozalit_onay',
      'demo_teslim', 'tasarim', 'ozalit_teslim', 'uretime_hazir',
      'uretimde', 'gumruk',
    ]) {
      expect(canRejectAtStage(LEADER, stage)).toBe(true)
    }
  })

  it('blocks designer / printer / satis at every stage', () => {
    for (const stage of ['demo_onay', 'ozalit_onay', 'tasarim', 'uretime_hazir']) {
      expect(canRejectAtStage(DESIGNER, stage)).toBe(false)
      expect(canRejectAtStage(PRINTER, stage)).toBe(false)
      expect(canRejectAtStage({ role: 'satis' }, stage)).toBe(false)
    }
  })
})

describe('canEditProductInfo (Ürün Bilgileri edit)', () => {
  it('allows team_leader', () => {
    expect(canEditProductInfo(LEADER)).toBe(true)
  })
  it('denies designer / printer / satis / missing', () => {
    expect(canEditProductInfo(DESIGNER)).toBe(false)
    expect(canEditProductInfo(PRINTER)).toBe(false)
    expect(canEditProductInfo({ role: 'satis' })).toBe(false)
    expect(canEditProductInfo(undefined)).toBe(false)
  })
})
