/**
 * `narrowToApproved` — the demo re-send default (migration next).
 *
 * Re-sending a held demo at demo_onay should pre-tick only the parçalar the
 * prior round approved. Anything rejected stays where it is (out for rework,
 * with the designer); re-sending it would silently undo the gate's decision.
 *
 * The hook (`useSpecSheet`) is heavy — api, snapshot fetch, localStorage —
 * so the rule is exercised here in isolation. The integration is one
 * condition in `useSpecSheet` and one prop on the dialog; if the helper
 * holds, the dialog holds.
 */

import { describe, it, expect } from 'vitest'

import { narrowToApproved } from './useSpecSheet.js'

const comp = (component, rows = []) => ({ id: component, component, rows })

describe('narrowToApproved — demo re-send default', () => {
  it('keeps only the components whose names are on the approved list', () => {
    const components = [comp('KUTU'), comp('KİTAP'), comp('KILAVUZ')]
    const result = narrowToApproved(components, ['KUTU', 'KILAVUZ'])
    expect(result.map((c) => c.component)).toEqual(['KUTU', 'KILAVUZ'])
  })

  it('preserves the order and rows of the components that survive', () => {
    const components = [
      comp('KUTU', [{ id: 'r1', label: 'KUTU EBAT', value: '20x30' }]),
      comp('KİTAP'),
    ]
    const result = narrowToApproved(components, ['KİTAP'])
    expect(result).toHaveLength(1)
    expect(result[0].component).toBe('KİTAP')
    // Unselected components carry through untouched — re-ticking them later
    // should restore them as they were, not as the catalog's empty shell.
    expect(components[0].rows).toEqual([{ id: 'r1', label: 'KUTU EBAT', value: '20x30' }])
  })

  // The function's most important contract: a parça that was REJECTED on the
  // prior round must not survive into the new round's default selection.
  it('drops rejected parçalar from the new round default', () => {
    // Three parçalar were sent to the matbaa; the leader approved two and
    // sent the third back to the designer. Only the two should pre-tick.
    const components = [comp('KUTU'), comp('KİTAP'), comp('KILAVUZ')]
    const approved = ['KUTU', 'KILAVUZ'] // KİTAP was rejected
    expect(narrowToApproved(components, approved).map((c) => c.component))
      .toEqual(['KUTU', 'KILAVUZ'])
  })

  it('matches names the way parça names actually vary', () => {
    // Snapshot row is uppercase, approved list might be lowercase, or vice
    // versa. The form's Turkish-aware key function handles both — see the
    // hook's own `parcaNameKey` for the same rule.
    const components = [comp('KUTU'), comp('KILAVUZ')]
    expect(narrowToApproved(components, ['kutu']).map((c) => c.component))
      .toEqual(['KUTU'])
    expect(narrowToApproved(components, ['  KILAVUZ  ']).map((c) => c.component))
      .toEqual(['KILAVUZ'])
  })

  it('returns an empty list when nothing was approved', () => {
    // The leader rejected every parça. The re-send opens with an empty sheet
    // and the picker is the only way to put parçalar back — exactly what
    // makes this safe against a "re-send everything" foot-gun.
    expect(narrowToApproved([comp('KUTU'), comp('KİTAP')], [])).toEqual([])
  })

  it('survives a missing or empty input', () => {
    expect(narrowToApproved(null, ['KUTU'])).toEqual([])
    expect(narrowToApproved(undefined, ['KUTU'])).toEqual([])
    expect(narrowToApproved([null, comp('KUTU')], ['KUTU'])).toHaveLength(1)
  })

  it('ignores blank names on the approved list', () => {
    // The catalog guard rejects empty parça names, but the API surface still
    // hands them through — the helper must not match the literal empty key.
    const components = [comp('KUTU')]
    expect(narrowToApproved(components, ['', null, '  ']).map((c) => c.component))
      .toEqual([])
  })
})
