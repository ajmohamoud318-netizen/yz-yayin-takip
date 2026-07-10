import {
  ORDER_STEPS,
  ORDER_STEP_NEXT,
  ORDER_STEP_OWNER,
  ORDER_REJECT_TARGETS,
  ORDER_REJECT_TO,
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
