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
  awaitsOzalitReceipt,
  ozalitDecidable,
  canMarkDemoStarted,
  canMarkOzalitStarted,
  canEditSentDemoRequest,
  canEditSentOzalitRequest,
  canAddParcalarToRound,
  unpreparedParcalar,
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
  // Per-parça helpers (migrations 068/069/070): the UI twin of the
  // server-side per-parça ledger helpers. Kept in sync so the queue can
  // render the same pending/approved/rejected sets the FSM will gate on.
  parcaNames,
  pendingParcalar,
  approvedParcalar,
  rejectedParcalar,
  bulkApproveAvailable,
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

/**
 * Receipt vs. decidability at ozalit_onay.
 *
 * Three different rounds share the stage and a falsey `ozalit_received`, and
 * the UI used to treat all three as "a proof is waiting to be taken delivery
 * of": a delivered physical proof (true), a screen round (nothing arrives),
 * and a rejected round parked here while the designer revizes. Reading the
 * flag alone offered the receipt buttons on rounds the server refuses, and
 * gated the screen round's sign-off shut forever.
 */
describe('ozalit receipt gate vs. decidability', () => {
  const delivered = { stage: 'ozalit_onay', ozalit_received: false }
  const received = { stage: 'ozalit_onay', ozalit_received: true }
  const screen = { stage: 'ozalit_onay', ozalit_received: false, ekran_ozalit: true }
  const inRevision = { stage: 'ozalit_onay', ozalit_received: false, last_reject_type: 'ozalit' }

  it('only a delivered physical proof owes a "Teslim Alındı"', () => {
    expect(awaitsOzalitReceipt(delivered)).toBe(true)
    expect(awaitsOzalitReceipt(received)).toBe(false)
    expect(awaitsOzalitReceipt(screen)).toBe(false)
    expect(awaitsOzalitReceipt(inRevision)).toBe(false)
    expect(awaitsOzalitReceipt({ stage: 'ozalit_teslim', ozalit_received: false })).toBe(false)
    expect(awaitsOzalitReceipt(null)).toBe(false)
  })

  it('a round is decidable once received, or straight away on a screen round', () => {
    expect(ozalitDecidable(received)).toBe(true)
    expect(ozalitDecidable(screen)).toBe(true)
    expect(ozalitDecidable(delivered)).toBe(false)
    expect(ozalitDecidable(inRevision)).toBe(false)
    expect(ozalitDecidable({ stage: 'baski_onay', ozalit_received: true })).toBe(false)
    expect(ozalitDecidable(null)).toBe(false)
  })

  it('the two are mutually exclusive, and both are false during the revision', () => {
    for (const p of [delivered, received, screen, inRevision]) {
      expect(awaitsOzalitReceipt(p) && ozalitDecidable(p)).toBe(false)
    }
    expect(awaitsOzalitReceipt(inRevision) || ozalitDecidable(inRevision)).toBe(false)
    // ...and that revision window is exactly where the route picker lives.
    expect(needsOzalitRouteChoice(inRevision)).toBe(true)
  })
})

// Per-parça approval helpers (migrations 068/069/070). The client twin of
// the server's per-parça ledger helpers — pure functions so the queue
// can render the same pending/approved/rejected sets the FSM gates on,
// and the bulk-approve shortcut can hide itself on single-parça sheets.
describe('parcaNames', () => {
  it('returns plain parça names from a string array', () => {
    expect(parcaNames(['KAPAK', 'KUTU'])).toEqual(['KAPAK', 'KUTU'])
  })

  it('extracts .component from object entries (matches the spec-sheet shape)', () => {
    expect(parcaNames([
      { component: 'KAPAK', date: '2026-01-01' },
      { component: 'KUTU' },
    ])).toEqual(['KAPAK', 'KUTU'])
  })

  it('returns [] for null/undefined/non-array input', () => {
    expect(parcaNames(null)).toEqual([])
    expect(parcaNames(undefined)).toEqual([])
    expect(parcaNames('KAPAK')).toEqual([])
  })

  it('skips entries without a .component on the object shape', () => {
    expect(parcaNames([{ component: 'KAPAK' }, {}, { component: '' }])).toEqual(['KAPAK'])
  })
})

describe('pendingParcalar', () => {
  const SNAPSHOT = ['KAPAK', 'KUTU', 'KILAVUZ']

  it('demo: returns every parça when nothing is approved', () => {
    const p = { demo_parca_approvals: [] }
    expect(pendingParcalar(p, 'demo', SNAPSHOT)).toEqual(SNAPSHOT)
  })

  it('demo: drops approved parçalar from the pending set', () => {
    const p = {
      demo_parca_approvals: [
        { parca: 'KAPAK', by: 'u-l', by_name: 'Lider' },
      ],
    }
    expect(pendingParcalar(p, 'demo', SNAPSHOT)).toEqual(['KUTU', 'KILAVUZ'])
  })

  it('demo: returns [] when every parça is approved', () => {
    const p = {
      demo_parca_approvals: [
        { parca: 'KAPAK' }, { parca: 'KUTU' }, { parca: 'KILAVUZ' },
      ],
    }
    expect(pendingParcalar(p, 'demo', SNAPSHOT)).toEqual([])
  })

  it('demo: empty snapshot → [] (legacy single-parça shortcut)', () => {
    expect(pendingParcalar({ demo_parca_approvals: [] }, 'demo', [])).toEqual([])
  })

  // A rejected parça has no approval row — which is what holds the project at
  // its gate — but it is NOT waiting on the leader: it is on the designer's or
  // the matbaa's desk. Counting it as pending put a green thumbs-up on the
  // parça the leader had just bounced and folded it into the
  // "Tüm parçaları onaylayın (N)" count, which is exactly the click the server
  // now refuses. The ledger is safe to read because the per-parça routing verbs
  // drop a parça's rejection row the moment the rework lands.
  it('demo: drops parçalar that are out for rework', () => {
    const p = {
      demo_parca_approvals: [{ parca: 'KAPAK' }],
      demo_parca_rejections: [{ parca: 'KUTU', target: 'matbaa' }],
    }
    expect(pendingParcalar(p, 'demo', SNAPSHOT)).toEqual(['KILAVUZ'])
  })

  it('demo: a parça that came back from rework is pending again', () => {
    const p = { demo_parca_approvals: [], demo_parca_rejections: [] }
    expect(pendingParcalar(p, 'demo', SNAPSHOT)).toEqual(SNAPSHOT)
  })

  it('ozalit: drops parçalar that are out for rework', () => {
    const p = {
      ozalit_parca_approvals: { KAPAK: [{ id: 'u-l' }] },
      ozalit_parca_rejections: [{ parca: 'KUTU', target: 'designer' }],
    }
    expect(pendingParcalar(p, 'ozalit', SNAPSHOT)).toEqual(['KILAVUZ'])
  })

  it('baskı onayı has no rework leg, so a demo rejection never hides a parça there', () => {
    const p = {
      demo_parca_rejections: [{ parca: 'KUTU', target: 'matbaa' }],
      baski_parca_preparers: {}, baski_parca_approvals: {},
    }
    expect(pendingParcalar(p, 'baski_onay', SNAPSHOT)).toEqual(SNAPSHOT)
  })

  it('ozalit: returns every parça when no rows exist for them', () => {
    const p = { ozalit_parca_approvals: {} }
    expect(pendingParcalar(p, 'ozalit', SNAPSHOT)).toEqual(SNAPSHOT)
  })

  it('ozalit: drops parçalar with at least one approver row', () => {
    const p = {
      ozalit_parca_approvals: {
        KAPAK: [{ id: 'u-l', role: 'team_leader' }],
      },
    }
    expect(pendingParcalar(p, 'ozalit', SNAPSHOT)).toEqual(['KUTU', 'KILAVUZ'])
  })

  it('baski_onay: a parça is pending when missing preparer OR approver OR same-leader', () => {
    // Three preparers, two approvals — KILAVUZ has the preparer but no
    // approver, so it stays pending.
    const p = {
      baski_parca_preparers: {
        KAPAK: { by: 'u-l1' },
        KUTU: { by: 'u-l2' },
        KILAVUZ: { by: 'u-l1' },
      },
      baski_parca_approvals: {
        KAPAK: { by: 'u-l2' },  // different leader — done
        KUTU: { by: 'u-l1' },  // different leader — done
        // KILAVUZ has no approver yet → pending
      },
    }
    expect(pendingParcalar(p, 'baski_onay', SNAPSHOT)).toEqual(['KILAVUZ'])
  })

  it('baski_onay: maker-checker — same leader on both sides → pending', () => {
    // KUTU's preparer AND approver are the same leader → still pending.
    const p = {
      baski_parca_preparers: {
        KUTU: { by: 'u-l1' },
      },
      baski_parca_approvals: {
        KUTU: { by: 'u-l1' }, // SAME — maker-checker rule violated
      },
    }
    expect(pendingParcalar(p, 'baski_onay', ['KUTU'])).toEqual(['KUTU'])
  })

  it('cin_baski_onay: same dual-leader rule, mirrored ledger', () => {
    const p = {
      cin_baski_parca_preparers: {
        KAPAK: { by: 'u-l1' },
      },
      cin_baski_parca_approvals: {
        KAPAK: { by: 'u-l1' }, // SAME — pending
      },
    }
    expect(pendingParcalar(p, 'cin_baski_onay', ['KAPAK'])).toEqual(['KAPAK'])
  })
})

describe('approvedParcalar', () => {
  it('demo: returns every parça with at least one approval row', () => {
    const p = {
      demo_parca_approvals: [
        { parca: 'KAPAK' },
        { parca: 'KAPAK' }, // dupes collapse
        { parca: 'KUTU' },
      ],
    }
    expect(approvedParcalar(p, 'demo')).toEqual(['KAPAK', 'KUTU'])
  })

  it('ozalit: returns every parça key with at least one approver row', () => {
    const p = {
      ozalit_parca_approvals: {
        KAPAK: [{ id: 'u-l' }],
        KUTU: [],
        KILAVUZ: [{ id: 'u-d' }],
      },
    }
    expect(approvedParcalar(p, 'ozalit').sort()).toEqual(['KAPAK', 'KILAVUZ'])
  })

  it('baski_onay: only parçalar with BOTH preparer AND different-leader approver count as done', () => {
    const p = {
      baski_parca_preparers: {
        KAPAK: { by: 'u-l1' },
        KUTU: { by: 'u-l2' },
        KILAVUZ: { by: 'u-l1' },
      },
      baski_parca_approvals: {
        KAPAK: { by: 'u-l2' }, // different leader — done
        KUTU: { by: 'u-l2' }, // SAME leader — maker-checker fails
        KILAVUZ: { by: 'u-l1' }, // SAME leader — maker-checker fails
      },
    }
    expect(approvedParcalar(p, 'baski_onay')).toEqual(['KAPAK'])
  })
})

describe('rejectedParcalar', () => {
  it('demo: returns every parça name in the rejection ledger', () => {
    const p = {
      demo_parca_rejections: [
        { parca: 'KAPAK' },
        { parca: 'KAPAK' },
        { parca: 'KUTU' },
      ],
    }
    expect(rejectedParcalar(p, 'demo')).toEqual(['KAPAK', 'KUTU'])
  })

  it('ozalit: reads the ozalit_parca_rejections ledger', () => {
    const p = {
      ozalit_parca_rejections: [{ parca: 'KAPAK' }],
    }
    expect(rejectedParcalar(p, 'ozalit')).toEqual(['KAPAK'])
  })
})

describe('bulkApproveAvailable', () => {
  it('false on a single-parça sheet (the existing single button is enough)', () => {
    const p = { demo_parca_approvals: [] }
    expect(bulkApproveAvailable(p, 'demo', ['KAPAK'])).toBe(false)
  })

  it('true on a multi-parça sheet with ≥2 parçalar pending', () => {
    const p = { demo_parca_approvals: [] }
    expect(bulkApproveAvailable(p, 'demo', ['KAPAK', 'KUTU'])).toBe(true)
  })

  it('false when ≥2 parçalar exist on the snapshot but only 1 is pending', () => {
    const p = {
      demo_parca_approvals: [{ parca: 'KAPAK' }, { parca: 'KUTU' }],
    }
    // Only KILAVUZ is pending → bulk button should hide.
    expect(bulkApproveAvailable(p, 'demo', ['KAPAK', 'KUTU', 'KILAVUZ'])).toBe(false)
  })

  it('false on an empty snapshot (no parça list at all)', () => {
    expect(bulkApproveAvailable({}, 'demo', [])).toBe(false)
  })
})

/**
 * "Kalan Parçaları Gönderin" — the window for sending a parça the round forgot.
 *
 * Deliberately wider than the edit gates it sits beside. Those answer "may this
 * sheet be corrected", which needs the matbaa to still be holding it. This one
 * answers "may a forgotten parça still be sent", and the honest answer runs one
 * stage longer: the onay gate is precisely where the omission gets noticed, when
 * the round comes home and the panel lists what arrived.
 *
 * Ending the window at *_teslim meant a leader who spotted it at the gate had
 * one move left — reject a demo that was perfectly good, purely to get back to a
 * stage where the button existed.
 */
describe('canAddParcalarToRound', () => {
  const AYSE = { id: 'u-ayse', role: 'team_leader' }
  const AYLIN = { id: 'u-aylin', role: 'designer' }
  const OKTAY = { id: 'u-oktay', role: 'printer' }

  it('is open while the matbaa holds the demo round', () => {
    expect(canAddParcalarToRound(AYSE, { stage: 'demo_teslim' }, 'demo')).toBe(true)
  })

  it('stays open at the demo onay gate, where the edit gate has closed', () => {
    const atGate = { stage: 'demo_onay', demo_received: true }
    expect(canEditSentDemoRequest(AYSE, atGate)).toBe(false)
    expect(canAddParcalarToRound(AYSE, atGate, 'demo')).toBe(true)
  })

  it('covers the ÇİN gate too', () => {
    expect(canAddParcalarToRound(AYSE, { stage: 'cin_demo_onay' }, 'demo')).toBe(true)
  })

  it('closes at demo_teslim once the matbaa has started the sheet', () => {
    // Inherited from canEditSentDemoRequest, and it has to be: computeDemoEdit
    // refuses outright while `demo_started`, so opening the button here would
    // only produce a 400. Note this barely bites in practice — on a split round
    // the flag is structurally false (startParca never sets it), which is why
    // the button survives a matbaa working parça by parça.
    expect(canAddParcalarToRound(AYSE, { stage: 'demo_teslim', demo_started: true }, 'demo')).toBe(false)
  })

  it('is unaffected by that flag at the onay gate — the round is finished there', () => {
    // computeDemoTeslimAdvance clears demo_started on delivery, so the gate is
    // reached with it false and the reopen path is never blocked by it.
    expect(canAddParcalarToRound(AYSE, { stage: 'demo_onay', demo_started: false }, 'demo')).toBe(true)
  })

  it('is team-leader-only, like every other send action', () => {
    expect(canAddParcalarToRound(AYLIN, { stage: 'demo_onay' }, 'demo')).toBe(false)
    expect(canAddParcalarToRound(OKTAY, { stage: 'demo_onay' }, 'demo')).toBe(false)
  })

  it('is shut on a round auto-created by a reject-to-matbaa', () => {
    // computeDemoEdit refuses every save on such a round — the matbaa gets back
    // exactly the file they were rejected on — so this button could only 400,
    // with a message about editing that answers a question nobody asked.
    const autoRound = { stage: 'demo_teslim', last_reject_target: 'matbaa' }
    expect(canAddParcalarToRound(AYSE, autoRound, 'demo')).toBe(false)
    expect(canAddParcalarToRound(AYSE, { stage: 'ozalit_teslim', ozalit_requested: true, last_reject_target: 'matbaa' }, 'ozalit')).toBe(false)
  })

  it('comes back once the matbaa has re-delivered that round', () => {
    // computeDemoTeslimAdvance clears last_reject_target on delivery, so the
    // forgotten parça can be sent from the gate — it is a pause, not a dead end.
    expect(canAddParcalarToRound(AYSE, { stage: 'demo_onay', last_reject_target: null }, 'demo')).toBe(true)
  })

  it('is unaffected by a reject-to-designer, which lands somewhere else anyway', () => {
    expect(canAddParcalarToRound(AYSE, { stage: 'demo_onay', last_reject_target: 'designer' }, 'demo')).toBe(true)
  })

  it('is shut where there is no round to add to', () => {
    expect(canAddParcalarToRound(AYSE, { stage: 'tasarim' }, 'demo')).toBe(false)
    expect(canAddParcalarToRound(AYSE, { stage: 'baski_onay' }, 'demo')).toBe(false)
    expect(canAddParcalarToRound(AYSE, null, 'demo')).toBe(false)
  })

  it('mirrors all of it on the ozalit leg', () => {
    const live = { stage: 'ozalit_teslim', ozalit_requested: true }
    expect(canAddParcalarToRound(AYSE, live, 'ozalit')).toBe(true)
    expect(canAddParcalarToRound(AYSE, { stage: 'ozalit_onay' }, 'ozalit')).toBe(true)
    expect(canAddParcalarToRound(AYLIN, { stage: 'ozalit_onay' }, 'ozalit')).toBe(false)
    // The demo gate is not an ozalit round.
    expect(canAddParcalarToRound(AYSE, { stage: 'demo_onay' }, 'ozalit')).toBe(false)
  })
})

/**
 * Baskı Onayı's first step, told apart from its second.
 *
 * `pendingParcalar` folds them together because either one holds the gate. The
 * panel cannot: an unprepared parça has no approval row, and telling the leader
 * "not approved" when the step actually owed is the one before it puts a
 * thumbs-up on a parça the server drops from every approve it is handed.
 */
describe('unpreparedParcalar', () => {
  const SNAP = ['KAPAK', 'KUTU']
  const prep = (by) => ({ by, by_name: 'Ayşenur', at: '2026-09-08T09:00:00.000Z' })

  it('names the parçalar with no preparer', () => {
    const project = { baski_parca_preparers: { KAPAK: prep('u-a') } }
    expect(unpreparedParcalar(project, 'baski_onay', SNAP)).toEqual(['KUTU'])
  })

  it('is empty once every parça is prepared', () => {
    const project = { baski_parca_preparers: { KAPAK: prep('u-a'), KUTU: prep('u-a') } }
    expect(unpreparedParcalar(project, 'baski_onay', SNAP)).toEqual([])
  })

  it('does not care whether they have been APPROVED yet', () => {
    // Prepared-but-unapproved is the second step, and it is per parça. This
    // function is only about the first.
    const project = {
      baski_parca_preparers: { KAPAK: prep('u-a'), KUTU: prep('u-a') },
      baski_parca_approvals: {},
    }
    expect(unpreparedParcalar(project, 'baski_onay', SNAP)).toEqual([])
  })

  it('reads the ÇİN mirror on the ÇİN gate', () => {
    const project = {
      cin_baski_parca_preparers: { KAPAK: prep('u-a') },
      // The TR ledger is fully populated and must be ignored here.
      baski_parca_preparers: { KAPAK: prep('u-a'), KUTU: prep('u-a') },
    }
    expect(unpreparedParcalar(project, 'cin_baski_onay', SNAP)).toEqual(['KUTU'])
  })

  it('is empty on the demo and ozalit gates — they have no prepare step', () => {
    expect(unpreparedParcalar({}, 'demo', SNAP)).toEqual([])
    expect(unpreparedParcalar({}, 'ozalit', SNAP)).toEqual([])
  })

  it('survives a missing project, ledger or snapshot', () => {
    expect(unpreparedParcalar(null, 'baski_onay', SNAP)).toEqual([])
    expect(unpreparedParcalar({}, 'baski_onay', SNAP)).toEqual(SNAP)
    expect(unpreparedParcalar({}, 'baski_onay', [])).toEqual([])
  })
})
