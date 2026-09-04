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
  isCatalogListed,
  handoverStageFor,
  canRequestHandover,
  assertHandoverEligible,
  isOzalitApprover,
  ozalitLeaderApproved,
  canApproveOzalitNow,
  canMarkDemoStarted,
  canMarkOzalitStarted,
  canEditSentDemoRequest,
  canEditSentOzalitRequest,
  isOzalitRoundLive,
  canCancelDemoRequest,
  canCancelOzalitRequest,
  canRequestDemoChange,
  canRequestOzalitChange,
  canRespondDemoChange,
  canRespondOzalitChange,
  canRequestEkranDemo,
  canRespondEkranDemo,
  needsOzalitRouteChoice,
  canApproveOzalitNow,
  ozalitLeaderApproved,
  isDemoApprover,
  canRejectAtStage,
  canEditProductInfo,
  isLegacyProject,
  assertNotLegacy,
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
  it('allows Baskıda and every stage after it, given a product_info entry', () => {
    expect(canRequestOrder({ stage: 'satista', has_product_info: true })).toBe(true)
    expect(canRequestOrder({ stage: 'satista', has_product_info: false })).toBe(false)
    expect(canRequestOrder({ stage: 'baskida', has_product_info: true })).toBe(true)
    expect(canRequestOrder({ stage: 'gumruk', has_product_info: true })).toBe(true)
    expect(canRequestOrder({ stage: 'tasarim', has_product_info: true })).toBe(false)
    expect(canRequestOrder({ stage: 'ozalit_teslim', has_product_info: true })).toBe(false)
  })
  it('throws 400 on a non-satisfying stage with status set', () => {
    try {
      assertOrderable({ stage: 'tasarim', has_product_info: true })
      throw new Error('should have thrown')
    } catch (e) {
      expect(e.status).toBe(400)
      expect(e.message).toMatch(/üretime hazır/)
    }
  })
  it('throws when in an orderable stage but no product_info entry exists yet', () => {
    expect(() => assertOrderable({ stage: 'satista', has_product_info: false })).toThrow(/Ürün Bilgileri/)
    expect(() => assertOrderable({ stage: 'baskida', has_product_info: false })).toThrow(/Ürün Bilgileri/)
  })
  it('throws on missing project (defensive)', () => {
    expect(() => assertOrderable(undefined)).toThrow(/üretime hazır/)
  })
})

describe('isCatalogListed (kaldırma, migration 033)', () => {
  const listed = { stage: 'satista', has_product_info: true }
  const delisted = { ...listed, catalog_hidden: true }

  it('a delisted product leaves the catalog', () => {
    expect(isCatalogListed(listed)).toBe(true)
    expect(isCatalogListed(delisted)).toBe(false)
  })
  it('rows predating the column are still listed', () => {
    expect(isCatalogListed({ stage: 'baskida' })).toBe(true)
  })
  it('a stage before Baskıda is never listed', () => {
    expect(isCatalogListed({ stage: 'tasarim' })).toBe(false)
    expect(isCatalogListed(undefined)).toBe(false)
  })
  it('blocks ordering, with its own message rather than the not-ready one', () => {
    expect(canRequestOrder(delisted)).toBe(false)
    expect(() => assertOrderable(delisted)).toThrow(/katalogdan kaldırıldı/)
    expect(() => assertOrderable(delisted)).not.toThrow(/üretime hazır/)
  })
  it('re-listing restores orderability', () => {
    expect(canRequestOrder({ ...delisted, catalog_hidden: false })).toBe(true)
  })
})

describe('handoverStageFor / canRequestHandover / assertHandoverEligible', () => {
  it('TR hands over from baskida', () => {
    expect(handoverStageFor('TR')).toBe('baskida')
    expect(canRequestHandover({ type: 'TR', stage: 'baskida' })).toBe(true)
  })
  it('ÇİN hands over from gumruk', () => {
    expect(handoverStageFor('CIN')).toBe('gumruk')
    expect(canRequestHandover({ type: 'CIN', stage: 'gumruk' })).toBe(true)
  })
  it('rejects handovers raised at the wrong stage', () => {
    expect(canRequestHandover({ type: 'TR', stage: 'tasarim' })).toBe(false)
    expect(canRequestHandover({ type: 'CIN', stage: 'baskida' })).toBe(false)
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
    expect(handoverStageFor('XX')).toBe('baskida')
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

describe('canApproveOzalitNow (multi-party, leader-first)', () => {
  // Mirrors computeOzalitOnayApproval on the server; the UI uses it to decide
  // whether to offer Onayla at all.
  const AYSE = { id: 'u-ayse', role: 'team_leader' }
  const AYLIN = { id: 'u-aylin', role: 'designer' }
  const OKTAY = { id: 'u-oktay', role: 'printer' }
  const base = { ozalit_received: true, assignees: [{ id: 'u-aylin' }], ozalit_approvals: [] }
  const leaderSigned = { ...base, ozalit_approvals: [{ id: 'u-ayse', role: 'team_leader' }] }

  it('lets a leader approve a received proof straight away', () => {
    expect(canApproveOzalitNow(AYSE, base)).toBe(true)
  })
  it('blocks the assigned designer until a leader has approved', () => {
    expect(canApproveOzalitNow(AYLIN, base)).toBe(false)
    expect(canApproveOzalitNow(AYLIN, leaderSigned)).toBe(true)
  })
  it('does not count another designer\'s sign-off as the leader\'s', () => {
    const designerOnly = { ...base, ozalit_approvals: [{ id: 'u-feyza', role: 'designer' }] }
    expect(ozalitLeaderApproved(designerOnly)).toBe(false)
    expect(canApproveOzalitNow(AYLIN, designerOnly)).toBe(false)
  })
  it('keeps the receipt gate ahead of the order rule', () => {
    expect(canApproveOzalitNow(AYSE, { ...leaderSigned, ozalit_received: false })).toBe(false)
    expect(canApproveOzalitNow(AYLIN, { ...leaderSigned, ozalit_received: false })).toBe(false)
  })
  it('denies unassigned designers, printers and missing users', () => {
    expect(canApproveOzalitNow({ id: 'u-nur', role: 'designer' }, leaderSigned)).toBe(false)
    expect(canApproveOzalitNow(OKTAY, leaderSigned)).toBe(false)
    expect(canApproveOzalitNow(undefined, leaderSigned)).toBe(false)
    expect(canApproveOzalitNow(AYSE, undefined)).toBe(false)
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

describe('demo/ozalit "Başladım" gate + cancel + change-request (migration 048)', () => {
  const AYSE = { id: 'u-ayse', role: 'team_leader' }
  const AYLIN = { id: 'u-aylin', role: 'designer' }
  const STRANGER = { id: 'u-nur', role: 'designer' }
  const OKTAY = { id: 'u-oktay', role: 'printer' }
  const assignees = [{ id: 'u-aylin' }]

  it('canMarkDemoStarted/canMarkOzalitStarted: printer only, right stage, not already started', () => {
    expect(canMarkDemoStarted(OKTAY, { stage: 'demo_teslim' })).toBe(true)
    expect(canMarkDemoStarted(OKTAY, { stage: 'cin_demo_teslim' })).toBe(true)
    expect(canMarkDemoStarted(OKTAY, { stage: 'demo_teslim', demo_started: true })).toBe(false)
    expect(canMarkDemoStarted(AYSE, { stage: 'demo_teslim' })).toBe(false)
    expect(canMarkDemoStarted(OKTAY, { stage: 'demo_onay' })).toBe(false)

    // Ozalit additionally needs a LIVE round (isOzalitRoundLive): reaching
    // ozalit_teslim isn't the request the way reaching demo_teslim is.
    const liveOzalit = { stage: 'ozalit_teslim', ozalit_requested: true }
    expect(canMarkOzalitStarted(OKTAY, liveOzalit)).toBe(true)
    expect(canMarkOzalitStarted(OKTAY, { ...liveOzalit, ozalit_started: true })).toBe(false)
    expect(canMarkOzalitStarted(AYSE, liveOzalit)).toBe(false)
    // Nobody has asked for an ozalit yet — nothing to start.
    expect(canMarkOzalitStarted(OKTAY, { stage: 'ozalit_teslim' })).toBe(false)
    // A reject-to-matbaa re-delivery IS live, despite ozalit_requested=false.
    expect(canMarkOzalitStarted(OKTAY, { stage: 'ozalit_teslim', reject_target: 'matbaa' })).toBe(true)
  })

  // Regression: a reject-to-matbaa re-delivery parks the project on
  // ozalit_teslim with ozalit_requested=false on purpose. Gating the leader's
  // actions on that flag alone left her with NO button on a round the matbaa
  // was actively working — not edit, not cancel, not "Değişiklik İste".
  it('re-delivery round (reject_target=matbaa) still gives the leader a way to act', () => {
    const redelivery = { stage: 'ozalit_teslim', ozalit_requested: false, reject_target: 'matbaa', assignees }
    expect(isOzalitRoundLive(redelivery)).toBe(true)
    // The leader can edit-and-notify on any non-started, live round — the
    // server refuses the auto-reject case at write time (transitions.auto-
    // reject-edit.test.js) so we don't gate the button here.
    expect(canEditSentOzalitRequest(AYSE, redelivery)).toBe(true)
    // After they start: edit closes, change-request opens — never both shut.
    const started = { ...redelivery, ozalit_started: true }
    expect(canEditSentOzalitRequest(AYSE, started)).toBe(false)
    expect(canRequestOzalitChange(AYSE, started)).toBe(true)
    // Cancel stays gated on a real pending request: this round WAS delivered
    // and rejected, so "nothing was delivered" doesn't apply to it.
    expect(canCancelOzalitRequest(AYSE, redelivery)).toBe(false)
  })

  it('an ozalit nobody requested exposes no leader actions either', () => {
    const idle = { stage: 'ozalit_teslim', ozalit_requested: false, assignees }
    expect(isOzalitRoundLive(idle)).toBe(false)
    expect(canEditSentOzalitRequest(AYSE, idle)).toBe(false)
    expect(canRequestOzalitChange(AYSE, { ...idle, ozalit_started: true })).toBe(false)
  })

  it('canCancelDemoRequest: team-leader-only, before matbaa starts', () => {
    const project = { stage: 'demo_teslim', demo_started: false, assignees }
    expect(canCancelDemoRequest(AYSE, project)).toBe(true)
    expect(canCancelDemoRequest(AYLIN, project)).toBe(false)
    expect(canCancelDemoRequest(STRANGER, project)).toBe(false)
    expect(canCancelDemoRequest(OKTAY, project)).toBe(false)
    expect(canCancelDemoRequest(AYSE, { ...project, demo_started: true })).toBe(false)
    expect(canCancelDemoRequest(AYSE, { ...project, stage: 'demo_onay' })).toBe(false)
  })

  it('canCancelOzalitRequest: additionally requires a pending ozalit_requested', () => {
    const project = { stage: 'ozalit_teslim', ozalit_requested: true, ozalit_started: false, assignees }
    expect(canCancelOzalitRequest(AYSE, project)).toBe(true)
    expect(canCancelOzalitRequest(AYSE, { ...project, ozalit_requested: false })).toBe(false)
    expect(canCancelOzalitRequest(AYSE, { ...project, ozalit_started: true })).toBe(false)
  })

  it('canRequestDemoChange: team-leader-only, once started, and not while a request is already pending', () => {
    const project = { stage: 'demo_teslim', demo_started: true, assignees }
    expect(canRequestDemoChange(AYSE, project)).toBe(true)
    expect(canRequestDemoChange(AYLIN, project)).toBe(false)
    expect(canRequestDemoChange(STRANGER, project)).toBe(false)
    expect(canRequestDemoChange(AYSE, { ...project, demo_started: false })).toBe(false)
    expect(canRequestDemoChange(AYSE, { ...project, demo_change_requested_at: '2026-01-01' })).toBe(false)
  })

  it('canRequestOzalitChange: mirrors the demo leg, plus ozalit_requested', () => {
    const project = { stage: 'ozalit_teslim', ozalit_requested: true, ozalit_started: true, assignees }
    expect(canRequestOzalitChange(AYSE, project)).toBe(true)
    expect(canRequestOzalitChange(AYSE, { ...project, ozalit_started: false })).toBe(false)
    expect(canRequestOzalitChange(AYSE, { ...project, ozalit_change_requested_at: '2026-01-01' })).toBe(false)
  })

  it('canRespondDemoChange/canRespondOzalitChange: printer only, only while a request is pending', () => {
    expect(canRespondDemoChange(OKTAY, { demo_change_requested_at: '2026-01-01' })).toBe(true)
    expect(canRespondDemoChange(OKTAY, { demo_change_requested_at: null })).toBe(false)
    expect(canRespondDemoChange(AYSE, { demo_change_requested_at: '2026-01-01' })).toBe(false)

    expect(canRespondOzalitChange(OKTAY, { ozalit_change_requested_at: '2026-01-01' })).toBe(true)
    expect(canRespondOzalitChange(OKTAY, { ozalit_change_requested_at: null })).toBe(false)
  })
})

describe('canRejectAtStage', () => {
  it('lets team_leader reject at any stage', () => {
    for (const stage of [
      'demo_onay', 'cin_demo_onay', 'ozalit_onay',
      'demo_teslim', 'tasarim', 'ozalit_teslim', 'baski_onay', 'cin_baski_onay',
      'baskida', 'gumruk',
    ]) {
      expect(canRejectAtStage(LEADER, stage)).toBe(true)
    }
  })

  it('blocks designer / printer / satis at every stage', () => {
    for (const stage of ['demo_onay', 'ozalit_onay', 'tasarim', 'baskida']) {
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

describe('isLegacyProject / assertNotLegacy (kayıtlı ürünler)', () => {
  const legacy = { type: 'TR', stage: 'satista', origin: 'legacy', has_product_info: true }
  const pipeline = { type: 'TR', stage: 'satista', origin: 'pipeline', has_product_info: true }

  it('identifies imported backlist rows by origin', () => {
    expect(isLegacyProject(legacy)).toBe(true)
    expect(isLegacyProject(pipeline)).toBe(false)
    // Rows predating migration 031 carry no origin — must not read as legacy.
    expect(isLegacyProject({ stage: 'satista' })).toBe(false)
    expect(isLegacyProject(undefined)).toBe(false)
  })

  it('blocks pipeline transitions but leaves sipariş and teslim open', () => {
    expect(() => assertNotLegacy(legacy)).toThrow(/Kayıtlı ürün/)
    expect(() => assertNotLegacy(pipeline)).not.toThrow()
    expect(() => assertNotLegacy(undefined)).not.toThrow()
    // Ordering a backlist book is the entire point of importing it.
    expect(canRequestOrder(legacy)).toBe(true)
    expect(() => assertOrderable(legacy)).not.toThrow()
    expect(canRequestHandover({ type: 'TR', stage: 'baskida', origin: 'legacy' })).toBe(true)
  })

  it('matches the server guard message', () => {
    // Server: server/src/domain/pipeline.js assertNotLegacy. The two domains
    // are kept in parity deliberately; a divergence here means the SPA hides a
    // button the API still allows (or vice versa).
    let status
    try { assertNotLegacy(legacy) } catch (e) { status = e.status }
    expect(status).toBe(400)
  })
})


/**
 * Ekran Demo Onayı. The SPA copy of a server rule (computeEkranDemoRequest /
 * computeEkranDemoApprove, server/src/domain/transitions.js) — kept in the
 * same parity contract as assertNotLegacy above: a divergence here means the
 * SPA shows a button the API refuses, or hides one it would allow.
 *
 * The load-bearing rule is that request and response are DISJOINT: the
 * assigned designer asks, the team leader decides. Nobody does both.
 */
describe('canRequestEkranDemo / canRespondEkranDemo', () => {
  const designer = { id: 'u-d', role: 'designer' }
  const leader = { id: 'u-l', role: 'team_leader' }
  const printer = { id: 'u-p', role: 'printer' }

  const held = (overrides = {}) => ({
    stage: 'demo_onay',
    demo_held: true,
    progress: 100,
    ekran_demo_requested_at: null,
    assignees: [{ id: 'u-d' }],
    ...overrides,
  })

  it('lets the assigned designer request it on a held demo at 100%', () => {
    expect(canRequestEkranDemo(designer, held())).toBe(true)
  })

  it('refuses the team leader — they respond, they do not request', () => {
    expect(canRequestEkranDemo(leader, held())).toBe(false)
  })

  it('refuses an unassigned designer and the matbaa', () => {
    expect(canRequestEkranDemo({ id: 'u-x', role: 'designer' }, held())).toBe(false)
    expect(canRequestEkranDemo(printer, held())).toBe(false)
    // An id match alone must not be enough — the role has to be designer too.
    expect(canRequestEkranDemo(printer, held({ assignees: [{ id: 'u-p' }] }))).toBe(false)
  })

  it('requires a held demo at exactly 100% in a demo_onay stage', () => {
    expect(canRequestEkranDemo(designer, held({ demo_held: false }))).toBe(false)
    expect(canRequestEkranDemo(designer, held({ progress: 80 }))).toBe(false)
    expect(canRequestEkranDemo(designer, held({ stage: 'demo_teslim' }))).toBe(false)
    expect(canRequestEkranDemo(designer, held({ type: 'CIN', stage: 'cin_demo_onay' }))).toBe(true)
  })

  it('refuses stacking a second request while one is pending', () => {
    expect(canRequestEkranDemo(designer, held({ ekran_demo_requested_at: '2026-01-01T00:00:00Z' }))).toBe(false)
  })

  it('lets only the leader respond, and only to a pending request', () => {
    const pending = held({ ekran_demo_requested_at: '2026-01-01T00:00:00Z' })
    expect(canRespondEkranDemo(leader, pending)).toBe(true)
    expect(canRespondEkranDemo(designer, pending)).toBe(false)
    expect(canRespondEkranDemo(leader, held())).toBe(false)
  })
})


/**
 * Ekran Ozalit (migration 061) — SPA copy of the server rule. Same parity
 * contract as the rest of this file: a divergence means the SPA offers an
 * approval the API refuses, or hides one it would allow.
 */
describe('ekran ozalit', () => {
  const leader = { id: 'u-l', role: 'team_leader' }
  const designer = { id: 'u-d', role: 'designer' }

  it('asks for a route only on a post-revize ozalit resubmit', () => {
    // Ozalit redo legs stay on ozalit_onay (no longer bounce to tasarim) —
    // the designer revizes in-place and then reopens the route picker from
    // the same stage. Demo rejections still bounce to tasarim and route
    // through the generic forward advance, so they don't need a choice.
    expect(needsOzalitRouteChoice({ stage: 'ozalit_onay', last_reject_type: 'ozalit' })).toBe(true)
    expect(needsOzalitRouteChoice({ stage: 'tasarim', last_reject_type: 'demo' })).toBe(false)
    expect(needsOzalitRouteChoice({ stage: 'tasarim', last_reject_type: null })).toBe(false)
    expect(needsOzalitRouteChoice({ stage: 'tasarim', last_reject_type: 'ozalit' })).toBe(false)
    expect(needsOzalitRouteChoice({ stage: 'ozalit_teslim', last_reject_type: 'ozalit' })).toBe(false)
    expect(needsOzalitRouteChoice({ stage: 'ozalit_onay', last_reject_type: null })).toBe(false)
    expect(needsOzalitRouteChoice(null)).toBe(false)
  })

  it('lets a single leader approve a screen round with no receipt', () => {
    const screen = { ekran_ozalit: true, ozalit_received: false, ozalit_approvals: [] }
    expect(canApproveOzalitNow(leader, screen)).toBe(true)
    // No designer counter-sign on a screen round.
    expect(canApproveOzalitNow({ ...designer }, { ...screen, assignees: [{ id: 'u-d' }] })).toBe(false)
  })

  it('leaves the physical round on the full multi-party rule', () => {
    const physical = {
      ekran_ozalit: false, ozalit_received: true,
      ozalit_approvals: [], assignees: [{ id: 'u-d' }],
    }
    // Receipt still gates it, leader still goes first, designer still signs.
    expect(canApproveOzalitNow(leader, { ...physical, ozalit_received: false })).toBe(false)
    expect(canApproveOzalitNow(leader, physical)).toBe(true)
    expect(canApproveOzalitNow(designer, physical)).toBe(false)
    const afterLeader = {
      ...physical,
      ozalit_approvals: [{ id: 'u-l', role: 'team_leader' }],
    }
    expect(ozalitLeaderApproved(afterLeader)).toBe(true)
    expect(canApproveOzalitNow(designer, afterLeader)).toBe(true)
  })
})
