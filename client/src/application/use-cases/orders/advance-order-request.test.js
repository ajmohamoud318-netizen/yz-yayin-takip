/**
 * Cross-aggregate use-case tests — order reassignment invariants.
 *
 * Guards the load-bearing rules added after the reassignment-scenarios audit:
 *   1. Empty assignee selection is rejected at the data layer (server-side
 *      guard, not just UI).
 *   2. Reassigning to a deactivated user is rejected.
 *   3. Reassigning to a non-designer (printer / satis / team_leader) is rejected.
 *   4. Successful reassignment appends an audit row to the project history.
 *   5. Reassignment log records previous and next assignee ids.
 *   6. Optimistic-concurrency guard rejects double-signs with 409.
 *
 * Run with `npm test` or `npm run test:domain`.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock the helpers the use case touches so we can drive the state machine
// without booting the whole mock store.
vi.mock('../../../infrastructure/http/client.js', () => ({
  httpClient: { post: vi.fn(), patch: vi.fn(), get: vi.fn() },
}))

vi.mock('../../../infrastructure/mock/helpers/mock-handler.js', () => ({
  mockOrHttp: async (mockFn) => mockFn(),
  mockOrHttpFast: async (mockFn) => mockFn(),
}))

import { makeAdvanceOrderRequest } from './advance-order-request.js'

function makeProject(over = {}) {
  return {
    id: 'p-x',
    title: 'Test',
    type: 'TR',
    stage: 'uretime_hazir',
    assignees: [{ id: 'u-feyza', name: 'Feyza' }],
    assigned_to: 'u-feyza',
    assigned_name: 'Feyza',
    history: [],
    ...over,
  }
}

function makeOrder(over = {}) {
  return {
    id: 'or-1',
    project_id: 'p-x',
    project_title: 'Test',
    requested_by: 'u-esra',
    requested_by_name: 'Esra',
    quantity: 1000,
    status: 'pending',
    order_history: [],
    version: 1,
    assignee_ids: ['u-feyza'],
    ...over,
  }
}

function makeUserRepo(users) {
  const map = new Map(users.map((u) => [u.id, u]))
  return {
    findById: (id) => map.get(id) ?? null,
    listRaw: () => users,
  }
}

function makeProjectRepo(project) {
  let p = project
  const subscribers = new Set()
  return {
    findProjectById: () => p,
    assignDesigners: vi.fn((id, ids) => {
      const names = ids.map((i) => ({ id: i, name: 'X' }))
      p = { ...p, assignees: names, assigned_to: ids[0], assigned_name: 'X' }
      for (const fn of subscribers) fn(p)
      return p
    }),
    recordOrderHistory: vi.fn(),
    subscribe: (fn) => (subscribers.add(fn), () => subscribers.delete(fn)),
  }
}

function makeOrderRepo(order) {
  let o = order
  return {
    advanceOrderInStore: vi.fn((id, opts) => {
      if (opts?.expectedVersion != null && o.version !== opts.expectedVersion) {
        const err = new Error('stale')
        err.status = 409
        err.code = 'stale_order'
        throw err
      }
      return { idx: 0, order: o }
    }),
    persistOrder: vi.fn((idx, next) => { o = next }),
  }
}

describe('advanceOrderRequest — assign step validation', () => {
  let project, order, userRepo, projectRepo, orderRepo, advance

  beforeEach(() => {
    project = makeProject()
    order = makeOrder()
    userRepo = makeUserRepo([
      { id: 'u-feyza', name: 'Feyza', role: 'designer', is_active: true },
      { id: 'u-elif', name: 'Aylin', role: 'designer', is_active: true },
      { id: 'u-oktay', name: 'Oktay', role: 'printer', is_active: true },
      { id: 'u-esra', name: 'Esra', role: 'satis', is_active: true },
      { id: 'u-ayse', name: 'Ayşenur', role: 'team_leader', is_active: true },
    ])
    projectRepo = makeProjectRepo(project)
    orderRepo = makeOrderRepo(order)
    advance = makeAdvanceOrderRequest({ orderRepo, projectRepo, userRepo })
  })

  it('rejects an empty assignees list with 400', async () => {
    await expect(
      advance('or-1', {
        actor: { id: 'u-ayse', name: 'Ayşenur', role: 'team_leader' },
        assignees: [],
      }),
    ).rejects.toThrow(/tasarımcı seçmeden/i)
  })

  it('rejects assigning a deactivated designer', async () => {
    userRepo.findById = (id) => {
      if (id === 'u-feyza') return { id, name: 'Feyza', role: 'designer', is_active: false }
      return { id, name: 'Aylin', role: 'designer', is_active: true }
    }
    await expect(
      advance('or-1', {
        actor: { id: 'u-ayse', name: 'Ayşenur', role: 'team_leader' },
        assignees: ['u-feyza'],
      }),
    ).rejects.toThrow(/pasif/)
  })

  it('rejects assigning a non-designer (printer)', async () => {
    await expect(
      advance('or-1', {
        actor: { id: 'u-ayse', name: 'Ayşenur', role: 'team_leader' },
        assignees: ['u-oktay'],
      }),
    ).rejects.toThrow(/tasarımcı değil/)
  })

  it('accepts a valid reassignment and appends an audit row', async () => {
    await advance('or-1', {
      actor: { id: 'u-ayse', name: 'Ayşenur', role: 'team_leader' },
      assignees: ['u-elif'],
    })
    expect(projectRepo.assignDesigners).toHaveBeenCalledWith('p-x', ['u-elif'])
    expect(projectRepo.recordOrderHistory).toHaveBeenCalledWith(
      'p-x',
      expect.objectContaining({
        note: expect.stringContaining('Feyza'),
      }),
    )
  })

  it('does NOT append a reassignment audit row when the assignee set is unchanged', async () => {
    await advance('or-1', {
      actor: { id: 'u-ayse', name: 'Ayşenur', role: 'team_leader' },
      assignees: ['u-feyza'],
    })
    // The step itself still appends a "Tasarımcıya Aktarıldı" row, but the
    // reassignment-specific "kadro güncellendi" row must NOT be appended.
    const calls = projectRepo.recordOrderHistory.mock.calls
    const reassignmentCalls = calls.filter(([, payload]) =>
      String(payload?.note ?? '').includes('kadro güncellendi'),
    )
    expect(reassignmentCalls).toHaveLength(0)
  })

  it('rejects a stale double-sign (optimistic concurrency)', async () => {
    // Simulate a second leader who loaded the order at version 1, but the
    // first leader has already persisted version 2.
    orderRepo.advanceOrderInStore.mockImplementationOnce(() => {
      const err = new Error('stale')
      err.status = 409
      err.code = 'stale_order'
      throw err
    })
    await expect(
      advance('or-1', {
        actor: { id: 'u-ayse', name: 'Ayşenur', role: 'team_leader' },
        assignees: ['u-elif'],
        expectedVersion: 1,
      }),
    ).rejects.toMatchObject({ status: 409, code: 'stale_order' })
  })
})