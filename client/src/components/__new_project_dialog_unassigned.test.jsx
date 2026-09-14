// NewProjectDialog — "Henüz atanmadı" on subtasks other than İç Sayfalar.
//
// An empty subtask pick goes to the project primary. "Henüz atanmadı" is the
// leader saying nobody has this job yet, and the server stores it as an
// ownerless row (assigned_to NULL). The edit dialog has to read that back
// faithfully:
//
//   1. On a staffed project an ownerless Kutu was a "Henüz atanmadı" pick — it
//      rehydrates as one and a re-save sends it again, instead of quietly
//      handing Kutu to the primary.
//   2. On a project with no designers every row is ownerless for want of
//      anyone to give it to. Staffing it later still hands those rows to the
//      primary, as before.

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
      ]),
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

// A library subtask's designer picker: the Select trigger in its checkbox row.
function pickerFor(key) {
  return document.getElementById(`st-${key}`).closest('div').querySelector('button[role="combobox"]')
}

async function submit() {
  const form = document.body.querySelector('form')
  await act(async () => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  })
}

const BASE = { id: 'p-1', title: 'Kutu kimde', type: 'TR', target_month: '2027-01-01' }

describe('NewProjectDialog — "Henüz atanmadı"', () => {
  it('reads an ownerless Kutu on a staffed project back as "Henüz atanmadı" and keeps it on save', async () => {
    await openEditDialog({
      ...BASE,
      assignees: [{ id: 'd1', name: 'Ali' }, { id: 'd2', name: 'Ayşe' }],
      subtasks: [
        { id: 's1', title: 'Kapak', kind: 'check', assigned_to: 'd2' },
        { id: 's2', title: 'Kutu', kind: 'check', assigned_to: null },
      ],
    })
    expect(pickerFor('kutu').textContent).toContain('Henüz atanmadı')
    await submit()

    expect(api.updateProject).toHaveBeenCalledTimes(1)
    const [, payload] = api.updateProject.mock.calls[0]
    expect(payload.subtaskAssignees.kapak).toBe('d2')
    expect(payload.subtaskAssignees.kutu).toBe('__none__')
  })

  it('still hands the rows of a project created without designers to the primary once it is staffed', async () => {
    await openEditDialog({
      ...BASE,
      assignees: [],
      subtasks: [
        { id: 's1', title: 'Kapak', kind: 'check', assigned_to: null },
        { id: 's2', title: 'Kutu', kind: 'check', assigned_to: null },
      ],
    })
    await act(async () => { designerCheckbox('Ali').click() })
    await act(async () => { designerCheckbox('Ayşe').click() })
    expect(pickerFor('kutu').textContent).not.toContain('Henüz atanmadı')
    await submit()

    expect(api.updateProject).toHaveBeenCalledTimes(1)
    const [, payload] = api.updateProject.mock.calls[0]
    expect(payload.assignees).toEqual(['d1', 'd2'])
    expect(payload.subtaskAssignees.kapak).toBe('')
    expect(payload.subtaskAssignees.kutu).toBe('')
  })
})
