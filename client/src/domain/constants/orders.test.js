import {
  ORDER_STEPS,
  ORDER_STEP_NEXT,
  ORDER_STEP_OWNER,
  ORDER_REJECT_TARGETS,
  ORDER_REJECT_TO,
  isOrderAssignedToDesigner,
} from './orders.js'

describe('order workflow step graph', () => {
  it('steps form a valid linear chain', () => {
    for (let i = 0; i < ORDER_STEPS.length - 1; i++) {
      const cur = ORDER_STEPS[i]
      const expectedNext = ORDER_STEPS[i + 1]
      expect(ORDER_STEP_NEXT[cur]).toBe(expectedNext)
    }
  })
  it('the final step (onaylandi) has no next', () => {
    expect(ORDER_STEP_NEXT.onaylandi).toBeUndefined()
  })
  it('every actionable step has a labelled owner (onaylandi is terminal — no owner needed)', () => {
    for (const step of ORDER_STEPS) {
      if (step === 'onaylandi') continue
      expect(ORDER_STEP_OWNER[step]).toBeTruthy()
    }
  })
  it('owners match the documented role routing', () => {
    expect(ORDER_STEP_OWNER.pending).toBe('team_leader')
    expect(ORDER_STEP_OWNER.goruldu).toBe('designer')
    expect(ORDER_STEP_OWNER.tasarimci_onay).toBe('printer')
    expect(ORDER_STEP_OWNER.matbaa_onay).toBe('team_leader')
  })
  it('matbaa_onay rejection routes mirror main-pipeline ozalit choices', () => {
    expect(ORDER_REJECT_TARGETS.matbaa_onay.matbaa).toBe('tasarimci_onay')
    expect(ORDER_REJECT_TARGETS.matbaa_onay.designer).toBe('goruldu')
  })
  it('default reject target is matbaa re-delivery', () => {
    expect(ORDER_REJECT_TO.matbaa_onay).toBe('tasarimci_onay')
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
