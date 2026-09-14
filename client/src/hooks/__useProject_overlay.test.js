/**
 * The detail page overlays a few live scalars from the shared list store
 * onto the fetched project. `assigned_name` must NOT be one of them: the
 * list used to ship only the primary designer there, so overlaying it
 * made a three-designer header flash every name and then snap to one.
 */
import { describe, expect, it } from 'vitest'
import { LIST_OVERLAY_KEYS, overlayStoreOnDetail } from './useProjects.js'

describe('overlayStoreOnDetail', () => {
  const detail = {
    id: 'p1',
    stage: 'tasarim',
    assigned_to: 'u-ayse',
    assigned_name: 'Ayşe, Mehmet, Zeynep',
    assignees: [
      { id: 'u-ayse', name: 'Ayşe' },
      { id: 'u-mehmet', name: 'Mehmet' },
      { id: 'u-zeynep', name: 'Zeynep' },
    ],
    subtasks: [{ id: 's1' }],
  }

  it('does not copy assigned_name from the list onto the detail', () => {
    expect(LIST_OVERLAY_KEYS).not.toContain('assigned_name')
    const next = overlayStoreOnDetail(detail, {
      id: 'p1',
      assigned_name: 'Ayşe',
      stage: 'demo_onay',
    })
    expect(next.assigned_name).toBe('Ayşe, Mehmet, Zeynep')
    expect(next.assignees).toHaveLength(3)
    expect(next.subtasks).toEqual([{ id: 's1' }])
    expect(next.stage).toBe('demo_onay')
  })

  it('returns the detail unchanged when the store has no row yet', () => {
    expect(overlayStoreOnDetail(detail, undefined)).toBe(detail)
  })
})
