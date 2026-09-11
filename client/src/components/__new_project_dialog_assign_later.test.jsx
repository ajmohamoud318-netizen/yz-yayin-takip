// NewProjectDialog — staffing a project after creating it.
//
// Two leaks between the pickers' hidden state and the save, both on the edit
// path a leader uses to assign designers later:
//
//   1. A project created without designers has an ownerless İç Sayfalar,
//      which rehydrates as "Tüm Tasarımcılar". With one designer the picker
//      is hidden, so the save must not send that invisible value — every row
//      goes to the new primary instead.
//   2. Unticking a designer must clear their subtask picks; otherwise the
//      "removed" designer stays on those subtasks.

import { describe, it, expect, afterEach, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'

import api from '@/api'
import NewProjectDialog from './NewProjectDialog.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

// Radix primitives measure with ResizeObserver, which jsdom doesn't ship.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
}

vi.mock('sonner', () => ({
  toast: { success: () => {}, error: () => {}, info: () => {} },
}))

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'u-leader', name: 'Ayşenur Kanak', role: 'team_leader' } }),
}))

vi.mock('@/hooks/useProjectsStore', () => ({
  useProjectsStore: () => ({ addOne: () => {}, updateOne: () => {} }),
}))

vi.mock('@/api', async () => {
  const actual = await vi.importActual('@/api')
  return {
    ...actual,
    default: {
      ...actual.default,
      listUsers: () => Promise.resolve([
        { id: 'd1', name: 'Ali', role: 'designer', is_active: true },
        { id: 'd2', name: 'Ayşe', role: 'designer', is_active: true },
        { id: 'd3', name: 'Zeynep', role: 'designer', is_active: true },
      ]),
      createProject: vi.fn(() => Promise.resolve({ id: 'p-new' })),
      updateProject: vi.fn(() => Promise.resolve({ id: 'p-1' })),
    },
  }
})

let mounted = []
afterEach(() => {
  for (const { root, host } of mounted) { act(() => root.unmount()); host.remove() }
  mounted = []
  vi.clearAllMocks()
})

async function openEditDialog(project) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push({ root, host })
  act(() => {
    root.render(<NewProjectDialog open onOpenChange={() => {}} project={project} />)
  })
  // Let api.listUsers() resolve and the rehydrated state commit.
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

function designerCheckbox(name) {
  // Each designer row is a <label> wrapping the checkbox, an initials badge
  // (span.rounded-full) and the name. Radix portals the dialog into body.
  const row = Array.from(document.body.querySelectorAll('label')).find((l) => {
    const badge = l.querySelector('span.rounded-full')
    if (!badge) return false
    return l.textContent.trim().slice(badge.textContent.trim().length).trim() === name
  })
  if (!row) throw new Error(`Designer row not found for ${name}`)
  return row.querySelector('button[role="checkbox"]')
}

async function submit() {
  const form = document.body.querySelector('form')
  await act(async () => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  })
}

describe('NewProjectDialog — staffing a project after creation', () => {
  it('gives every row to a single designer added later, not the hidden "Tüm Tasarımcılar"', async () => {
    await openEditDialog({
      id: 'p-1',
      title: 'Tasarımcı sonra',
      type: 'TR',
      target_month: '2027-01-01',
      assignees: [],
      subtasks: [
        { id: 's1', title: 'Kapak', kind: 'check', assigned_to: null },
        { id: 's2', title: 'İç Sayfalar', kind: 'pages', total_pages: 32, assigned_to: null },
      ],
    })
    await act(async () => { designerCheckbox('Ali').click() })
    await submit()

    expect(api.updateProject).toHaveBeenCalledTimes(1)
    const [, payload] = api.updateProject.mock.calls[0]
    expect(payload.assignees).toEqual(['d1'])
    expect(payload.subtaskAssignees).toEqual({})
  })

  it('takes an unticked designer off the subtasks they owned', async () => {
    await openEditDialog({
      id: 'p-1',
      title: 'Üç tasarımcı',
      type: 'TR',
      target_month: '2027-01-01',
      assignees: [{ id: 'd1', name: 'Ali' }, { id: 'd2', name: 'Ayşe' }, { id: 'd3', name: 'Zeynep' }],
      subtasks: [
        { id: 's1', title: 'Kapak', kind: 'check', assigned_to: 'd3' },
        { id: 's2', title: 'İç Sayfalar', kind: 'pages', total_pages: 32, assigned_to: 'd2' },
      ],
    })
    await act(async () => { designerCheckbox('Zeynep').click() })
    await submit()

    expect(api.updateProject).toHaveBeenCalledTimes(1)
    const [, payload] = api.updateProject.mock.calls[0]
    expect(payload.assignees).toEqual(['d1', 'd2'])
    expect(payload.subtaskAssignees.kapak).toBe('')
    expect(payload.subtaskAssignees.sayfalar).toBe('d2')
    expect(Object.values(payload.subtaskAssignees)).not.toContain('d3')
  })
})
