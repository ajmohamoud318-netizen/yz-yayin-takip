import {
  ORDER_STEPS,
  ORDER_STEP_NEXT,
  ORDER_STEP_OWNER,
  ORDER_REJECT_TARGETS,
  ORDER_REJECT_TO,
  ORDER_STEP_PATH_DEFAULT,
  ORDER_STEP_PATH_EKRAN_ONAY,
  orderStepPath,
  isOrderAssignedToDesigner,
  matbaaOnayLeaderApproved,
  canApproveMatbaaOnayNow,
  canActOnOrder,
  orderOzalitFormMode,
} from './orders.js'

describe('order workflow step graph', () => {
  it('the default path forms a valid linear chain', () => {
    for (let i = 0; i < ORDER_STEP_PATH_DEFAULT.length - 1; i++) {
      expect(ORDER_STEP_NEXT[ORDER_STEP_PATH_DEFAULT[i]]).toBe(ORDER_STEP_PATH_DEFAULT[i + 1])
    }
  })
  it('the ekran_onay branch is valid from ekran_onayinda onward', () => {
    // kontroller_tamam's default ORDER_STEP_NEXT is matbaa_ozalit_yapiyor; the
    // ekran_onayinda branch is an explicit server-side override on resubmit, not
    // reflected in the map — this only checks the segment FROM ekran_onayinda on.
    expect(ORDER_STEP_NEXT.ekran_onayinda).toBe('baski_onayi_bekleniyor')
    expect(ORDER_STEP_NEXT.baski_onayi_bekleniyor).toBe('baskida')
  })
  it("the designer's turn is two steps: the checks, then the ozalit request", () => {
    // Migration 054. Both belong to the same owner, and the request step is
    // what the resubmit route choice hangs off — see the server's /advance.
    expect(ORDER_STEP_NEXT.tasarimciya_atandi).toBe('kontroller_tamam')
    expect(ORDER_STEP_NEXT.kontroller_tamam).toBe('matbaa_ozalit_yapiyor')
    expect(ORDER_STEP_OWNER.kontroller_tamam).toBe(ORDER_STEP_OWNER.tasarimciya_atandi)
  })
  it('the final step (baskida) has no next', () => {
    expect(ORDER_STEP_NEXT.baskida).toBeUndefined()
  })
  it('every actionable step has a labelled owner (baskida is terminal — no owner needed)', () => {
    for (const step of ORDER_STEPS) {
      if (step === 'baskida') continue
      expect(ORDER_STEP_OWNER[step]).toBeTruthy()
    }
  })
  it('owners match the documented role routing', () => {
    expect(ORDER_STEP_OWNER.atama_bekleniyor).toBe('team_leader')
    expect(ORDER_STEP_OWNER.tasarimciya_atandi).toBe('designer')
    expect(ORDER_STEP_OWNER.matbaa_ozalit_yapiyor).toBe('printer')
    expect(ORDER_STEP_OWNER.ekran_onayinda).toBe('team_leader')
    expect(ORDER_STEP_OWNER.imza_bekleniyor).toBe('team_leader')
  })
  it('imza_bekleniyor rejection routes mirror main-pipeline ozalit choices', () => {
    expect(ORDER_REJECT_TARGETS.imza_bekleniyor.matbaa).toBe('matbaa_ozalit_yapiyor')
    expect(ORDER_REJECT_TARGETS.imza_bekleniyor.designer).toBe('tasarimciya_atandi')
  })
  it('ekran_onayinda only offers a designer reject route, never matbaa', () => {
    expect(ORDER_REJECT_TARGETS.ekran_onayinda.designer).toBe('tasarimciya_atandi')
    expect(ORDER_REJECT_TARGETS.ekran_onayinda.matbaa).toBeUndefined()
  })
  it('default reject target is matbaa re-delivery, or designer for ekran_onayinda', () => {
    expect(ORDER_REJECT_TO.imza_bekleniyor).toBe('matbaa_ozalit_yapiyor')
    expect(ORDER_REJECT_TO.ekran_onayinda).toBe('tasarimciya_atandi')
  })
})

describe('orderStepPath', () => {
  it('defaults to the matbaa_ozalit_yapiyor / imza_bekleniyor path', () => {
    expect(orderStepPath({ status: 'imza_bekleniyor', order_history: [] })).toEqual(ORDER_STEP_PATH_DEFAULT)
  })
  it('detects the ekran_onayinda branch from current status', () => {
    expect(orderStepPath({ status: 'ekran_onayinda', order_history: [] })).toEqual(ORDER_STEP_PATH_EKRAN_ONAY)
  })
  it('detects the ekran_onayinda branch from history after completion', () => {
    const order = { status: 'baskida', order_history: [{ step: 'ekran_onayinda' }] }
    expect(orderStepPath(order)).toEqual(ORDER_STEP_PATH_EKRAN_ONAY)
  })
  it('is safe with a missing order', () => {
    expect(orderStepPath(undefined)).toEqual(ORDER_STEP_PATH_DEFAULT)
  })
})

describe('isOrderAssignedToDesigner', () => {
  const order = (assignee_ids) => ({ id: 'o-1', project_id: 'p-1', assignee_ids })

  it('matches the designer the leader picked, with no project assignment at all', () => {
    // The regression: a sipariş transfer sets no subtask, so the project's
    // assignees list is empty and the project-based filter hid the order.
    expect(isOrderAssignedToDesigner(order(['u-aylin']), 'u-aylin', new Set())).toBe(true)
  })

  it('matches every designer of a multi-select, not just the first', () => {
    // Only assignees[0] becomes the project primary, so 2nd..8th were invisible.
    const o = order(['u-aylin', 'u-feyza', 'u-nur'])
    expect(isOrderAssignedToDesigner(o, 'u-feyza', new Set())).toBe(true)
    expect(isOrderAssignedToDesigner(o, 'u-nur', new Set())).toBe(true)
  })

  it('does not leak an order to a designer who was not picked', () => {
    expect(isOrderAssignedToDesigner(order(['u-aylin']), 'u-sumeyye', new Set())).toBe(false)
  })

  it('an explicit assignee list wins over project assignment', () => {
    // Someone assigned to the project but not to THIS order must not see it.
    expect(isOrderAssignedToDesigner(order(['u-aylin']), 'u-sumeyye', new Set(['p-1']))).toBe(false)
  })

  it('falls back to project assignment for legacy orders with no assignee list', () => {
    for (const legacy of [null, undefined, []]) {
      expect(isOrderAssignedToDesigner(order(legacy), 'u-aylin', new Set(['p-1']))).toBe(true)
      expect(isOrderAssignedToDesigner(order(legacy), 'u-aylin', new Set(['p-9']))).toBe(false)
    }
  })

  it('is safe with missing order, missing user, or missing fallback set', () => {
    expect(isOrderAssignedToDesigner(null, 'u-aylin', new Set())).toBe(false)
    expect(isOrderAssignedToDesigner(order(['u-aylin']), undefined, new Set())).toBe(false)
    expect(isOrderAssignedToDesigner(order(null), 'u-aylin', undefined)).toBe(false)
  })
})

describe('canApproveMatbaaOnayNow (multi-party, leader-first — mirrors canApproveOzalitNow)', () => {
  const AYSE = { id: 'u-ayse', role: 'team_leader' }
  const AYLIN = { id: 'u-aylin', role: 'designer' }
  const NUR = { id: 'u-nur', role: 'designer' }
  const OKTAY = { id: 'u-oktay', role: 'printer' }

  const base = { id: 'o-1', assignee_ids: ['u-aylin'], matbaa_received: true, matbaa_approvals: [] }
  const leaderSigned = { ...base, matbaa_approvals: [{ id: 'u-ayse', role: 'team_leader' }] }
  const designerOnly = { ...base, matbaa_approvals: [{ id: 'u-aylin', role: 'designer' }] }

  it('a team leader may always approve once received, regardless of sign order', () => {
    expect(canApproveMatbaaOnayNow(AYSE, base)).toBe(true)
  })

  it('an assigned designer must wait for a leader to sign first', () => {
    expect(canApproveMatbaaOnayNow(AYLIN, base)).toBe(false)
    expect(canApproveMatbaaOnayNow(AYLIN, leaderSigned)).toBe(true)
  })

  it('a designer approval alone does not open the gate for other designers', () => {
    expect(matbaaOnayLeaderApproved(designerOnly)).toBe(false)
    expect(canApproveMatbaaOnayNow(AYLIN, designerOnly)).toBe(false)
  })

  it('nobody may approve before the receipt gate', () => {
    expect(canApproveMatbaaOnayNow(AYSE, { ...leaderSigned, matbaa_received: false })).toBe(false)
    expect(canApproveMatbaaOnayNow(AYLIN, { ...leaderSigned, matbaa_received: false })).toBe(false)
  })

  it('an unassigned designer, a printer, and missing args are all refused', () => {
    expect(canApproveMatbaaOnayNow(NUR, leaderSigned)).toBe(false)
    expect(canApproveMatbaaOnayNow(OKTAY, leaderSigned)).toBe(false)
    expect(canApproveMatbaaOnayNow(undefined, leaderSigned)).toBe(false)
    expect(canApproveMatbaaOnayNow(AYSE, undefined)).toBe(false)
  })
})

describe('canActOnOrder (ProjectDetail — any role viewing any order)', () => {
  const AYSE = { id: 'u-ayse', role: 'team_leader' }
  const AYLIN = { id: 'u-aylin', role: 'designer' }
  const NUR = { id: 'u-nur', role: 'designer' }
  const OKTAY = { id: 'u-oktay', role: 'printer' }
  const ESRA = { id: 'u-esra', role: 'satis' }

  it('atama_bekleniyor, ekran_onayinda, and baski_onayi_bekleniyor are team-leader-only', () => {
    for (const status of ['atama_bekleniyor', 'ekran_onayinda', 'baski_onayi_bekleniyor']) {
      const order = { id: 'o-1', status }
      expect(canActOnOrder(AYSE, order)).toBe(true)
      expect(canActOnOrder(AYLIN, order)).toBe(false)
      expect(canActOnOrder(OKTAY, order)).toBe(false)
    }
  })

  it('matbaa_ozalit_yapiyor is printer-only', () => {
    const order = { id: 'o-1', status: 'matbaa_ozalit_yapiyor' }
    expect(canActOnOrder(OKTAY, order)).toBe(true)
    expect(canActOnOrder(AYSE, order)).toBe(false)
    expect(canActOnOrder(AYLIN, order)).toBe(false)
  })

  it('tasarimciya_atandi is only actionable by the assigned designer', () => {
    const order = { id: 'o-1', status: 'tasarimciya_atandi', assignee_ids: ['u-aylin'] }
    expect(canActOnOrder(AYLIN, order)).toBe(true)
    expect(canActOnOrder(NUR, order)).toBe(false)
    expect(canActOnOrder(AYSE, order)).toBe(false)
  })

  it('kontroller_tamam is the same designer\'s second step, same assignment rule', () => {
    const order = { id: 'o-1', status: 'kontroller_tamam', assignee_ids: ['u-aylin'] }
    expect(canActOnOrder(AYLIN, order)).toBe(true)
    expect(canActOnOrder(NUR, order)).toBe(false)
    expect(canActOnOrder(AYSE, order)).toBe(false)
  })

  it('the assigned designer opens the ozalit sheet to SEND it at kontroller_tamam', () => {
    const order = { id: 'o-1', status: 'kontroller_tamam', assignee_ids: ['u-aylin'] }
    expect(orderOzalitFormMode(order, AYLIN)).toBe('advance')
    // Everyone else only reads it — the request is the designer's to make.
    expect(orderOzalitFormMode(order, NUR)).toBe('view')
    expect(orderOzalitFormMode(order, AYSE)).toBe('view')
    expect(orderOzalitFormMode(order, OKTAY)).toBe('view')
  })

  it('tasarimciya_atandi falls back to project assignment for legacy orders', () => {
    const order = { id: 'o-1', project_id: 'p-1', status: 'tasarimciya_atandi', assignee_ids: [] }
    expect(canActOnOrder(AYLIN, order, new Set(['p-1']))).toBe(true)
    expect(canActOnOrder(AYLIN, order, new Set())).toBe(false)
  })

  it('imza_bekleniyor: either the leader or the assigned designer can clear the receipt gate', () => {
    const order = { id: 'o-1', status: 'imza_bekleniyor', assignee_ids: ['u-aylin'], matbaa_received: false }
    expect(canActOnOrder(AYSE, order)).toBe(true)
    expect(canActOnOrder(AYLIN, order)).toBe(true)
    expect(canActOnOrder(NUR, order)).toBe(false)
    expect(canActOnOrder(OKTAY, order)).toBe(false)
  })

  it('imza_bekleniyor: once received, approval is leader-first', () => {
    const received = { id: 'o-1', status: 'imza_bekleniyor', assignee_ids: ['u-aylin'], matbaa_received: true, matbaa_approvals: [] }
    expect(canActOnOrder(AYSE, received)).toBe(true)
    expect(canActOnOrder(AYLIN, received)).toBe(false)
    const leaderSigned = { ...received, matbaa_approvals: [{ id: 'u-ayse', role: 'team_leader' }] }
    expect(canActOnOrder(AYLIN, leaderSigned)).toBe(true)
  })

  it('baskida and rejected are terminal — nobody owes an action', () => {
    expect(canActOnOrder(AYSE, { id: 'o-1', status: 'baskida' })).toBe(false)
    expect(canActOnOrder(AYSE, { id: 'o-1', status: 'rejected' })).toBe(false)
  })

  it('is safe with missing user, missing order, or an unrelated role', () => {
    expect(canActOnOrder(undefined, { id: 'o-1', status: 'atama_bekleniyor' })).toBe(false)
    expect(canActOnOrder(AYSE, undefined)).toBe(false)
    expect(canActOnOrder(ESRA, { id: 'o-1', status: 'atama_bekleniyor' })).toBe(false)
  })
})
