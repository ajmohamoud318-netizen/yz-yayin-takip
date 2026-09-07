// Per-parça approval handlers in `useProjectDelivery`
// (migrations 068/069/070): the parça subset is forwarded to the right
// API endpoint, null means "all still-pending" (the bulk shortcut), and
// the failure toast surfaces the server's Turkish message.
//
// We render the hook inside a tiny TestHost component (no
// @testing-library/react — the project doesn't have it) and capture
// the returned handlers via a ref. Mock api + toast before each test.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useEffect, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'

import { useProjectDelivery } from './useProjectDelivery.js'

const apiCalls = []
vi.mock('@/api', () => ({
  default: {
    approveProject: (...args) => {
      apiCalls.push(['approveProject', args])
      return Promise.resolve({ id: 'p-1', stage: 'ozalit_teslim' })
    },
    rejectProject: (...args) => {
      apiCalls.push(['rejectProject', args])
      return Promise.resolve({ id: 'p-1', stage: 'tasarim' })
    },
    approveEkranDemo: (...args) => {
      apiCalls.push(['approveEkranDemo', args])
      return Promise.resolve({ id: 'p-1', stage: 'ozalit_teslim' })
    },
    prepareBaskiOnay: (...args) => {
      apiCalls.push(['prepareBaskiOnay', args])
      return Promise.resolve({ id: 'p-1', stage: 'baski_onay' })
    },
    receiveDemo: () => Promise.resolve({ id: 'p-1' }),
    receiveOzalit: () => Promise.resolve({ id: 'p-1' }),
  },
}))

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('sonner', () => ({ toast: toastMock }))

vi.mock('@/components/SpecFormDialog', () => ({
  stampSpecSignature: () => Promise.resolve(),
}))

const project = { id: 'p-1', stage: 'demo_onay', title: 'Test' }
const user = { id: 'u-leader', name: 'Ayşenur', role: 'team_leader' }

let container = null
let root = null
let refetch
let current

function TestHost({ project: p, refetch: r, user: u }) {
  const ref = useRef(null)
  const result = useProjectDelivery(p, r, u)
  ref.current = result
  current = result
  return null
}

beforeEach(() => {
  apiCalls.length = 0
  toastMock.success.mockClear()
  toastMock.error.mockClear()
  refetch = vi.fn(() => Promise.resolve())
  current = null
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => {
    root.unmount()
  })
  container.remove()
  container = null
  root = null
})

async function mountAndGet(p = project) {
  await act(async () => {
    root.render(<TestHost project={p} refetch={refetch} user={user} />)
  })
  return current
}

describe('useProjectDelivery — per-parça approve', () => {
  it('handleApproveParcalar forwards the subset to /approve', async () => {
    const result = await mountAndGet()
    await act(async () => {
      await result.handleApproveParcalar(['KAPAK', 'KUTU'])
    })
    expect(apiCalls).toEqual([
      ['approveProject', ['p-1', ['KAPAK', 'KUTU']]],
    ])
    expect(refetch).toHaveBeenCalledOnce()
  })

  it('handleApproveParcalar forwards null as "all still-pending" (bulk shortcut)', async () => {
    const result = await mountAndGet()
    await act(async () => {
      await result.handleApproveParcalar(null)
    })
    expect(apiCalls).toEqual([
      ['approveProject', ['p-1', null]],
    ])
  })
})

describe('useProjectDelivery — per-parça reject', () => {
  it('handleRejectParcalar forwards the subset to /reject with target=designer', async () => {
    const result = await mountAndGet()
    await act(async () => {
      await result.handleRejectParcalar(['KAPAK'], 'tasarım bozuk', 'designer')
    })
    expect(apiCalls[0][0]).toBe('rejectProject')
    // Wire shape: (id, reason, revizeIds, target, parcalar)
    expect(apiCalls[0][1]).toEqual(['p-1', 'tasarım bozuk', [], 'designer', ['KAPAK']])
  })

  it('handleRejectParcalar passes null when the leader wants to bounce the whole round', async () => {
    const result = await mountAndGet()
    await act(async () => {
      await result.handleRejectParcalar(null, 'her şey yanlış')
    })
    expect(apiCalls[0][1]).toEqual(['p-1', 'her şey yanlış', [], 'designer', null])
  })
})

describe('useProjectDelivery — per-parça ekran demo approve', () => {
  it('handleEkranApproveParcalar forwards the subset to /ekran-demo-approve', async () => {
    const result = await mountAndGet()
    await act(async () => {
      await result.handleEkranApproveParcalar(['KAPAK'])
    })
    expect(apiCalls).toEqual([
      ['approveEkranDemo', ['p-1', ['KAPAK']]],
    ])
  })
})

describe('useProjectDelivery — per-parça baski onayı prepare', () => {
  it('handlePrepareBaskiParcalar forwards the subset to /baski-onay-prepare', async () => {
    const result = await mountAndGet()
    await act(async () => {
      await result.handlePrepareBaskiParcalar(['KAPAK', 'KILAVUZ'])
    })
    expect(apiCalls).toEqual([
      ['prepareBaskiOnay', ['p-1', ['KAPAK', 'KILAVUZ']]],
    ])
  })
})
