// Per-parça approval grid rendering (migrations 068/069/070).
//
// Three layers to cover:
//   1. ParcaApprovalRow renders the right status pill + buttons.
//   2. ParcaApprovalGrid shows one row per parça + the bulk button.
//   3. The bulk button is hidden on single-parça sheets (bulkApproveAvailable
//      returns false) and shown on multi-parça sheets.
//
// The tests skip react-testing-library to stay compatible with the
// project's existing jsdom setup; we render into a temporary container
// and assert against the resulting DOM directly.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { MemoryRouter } from 'react-router-dom'

import ParcaApprovalRow from './ParcaApprovalRow.jsx'
import ParcaApprovalGrid from './ParcaApprovalGrid.jsx'

// Mock the toast hook so per-row clicks don't blow up in jsdom.
vi.mock('sonner', () => ({
  toast: { success: () => {}, error: () => {} },
}))

let container = null
let root = null
beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  container = null
  root = null
})

function render(node) {
  act(() => {
    root.render(<MemoryRouter>{node}</MemoryRouter>)
  })
}

function $$(selector) {
  return Array.from(container.querySelectorAll(selector))
}

describe('ParcaApprovalRow', () => {
  it('renders the parça name and a "pending" status dot by default', () => {
    render(
      <ParcaApprovalRow
        parca="KAPAK"
        status="pending"
        onApprove={() => {}}
        onReject={() => {}}
      />,
    )
    expect(container.textContent).toContain('KAPAK')
    expect(container.querySelector('button[aria-label="KAPAK parçasını onayla"]')).toBeTruthy()
    expect(container.querySelector('button[aria-label="KAPAK parçasını reddet"]')).toBeTruthy()
  })

  it('hides both buttons on an already-approved parça', () => {
    render(<ParcaApprovalRow parca="KAPAK" status="approved" />)
    expect(container.textContent).toContain('Onaylandı')
    expect(container.querySelector('button[aria-label="KAPAK parçasını onayla"]')).toBe(null)
    expect(container.querySelector('button[aria-label="KAPAK parçasını reddet"]')).toBe(null)
  })

  it('renders a "Reddedildi" badge on a rejected parça', () => {
    render(<ParcaApprovalRow parca="KUTU" status="rejected" />)
    expect(container.textContent).toContain('Reddedildi')
    expect(container.querySelector('button[aria-label="KUTU parçasını onayla"]')).toBe(null)
  })

  it('shows the signers list when provided', () => {
    render(
      <ParcaApprovalRow
        parca="KAPAK"
        status="approved"
        signers={[{ name: 'Ayşenur', at: '2026-01-01' }]}
      />,
    )
    expect(container.textContent).toContain('Ayşenur')
  })

  it('fires onApprove when the green button is clicked', () => {
    let approved = null
    render(
      <ParcaApprovalRow
        parca="KAPAK"
        status="pending"
        onApprove={() => { approved = 'KAPAK' }}
      />,
    )
    const btn = container.querySelector('button[aria-label="KAPAK parçasını onayla"]')
    act(() => btn.click())
    expect(approved).toBe('KAPAK')
  })

  it('fires onReject when the red ghost button is clicked', () => {
    let rejected = null
    render(
      <ParcaApprovalRow
        parca="KAPAK"
        status="pending"
        onReject={() => { rejected = 'KAPAK' }}
      />,
    )
    const btn = container.querySelector('button[aria-label="KAPAK parçasını reddet"]')
    act(() => btn.click())
    expect(rejected).toBe('KAPAK')
  })
})

describe('ParcaApprovalGrid', () => {
  const SNAPSHOT = ['KAPAK', 'KUTU', 'KILAVUZ']

  it('renders one row per parça on the snapshot', () => {
    const p = { demo_parca_approvals: [], demo_parca_rejections: [] }
    render(
      <ParcaApprovalGrid
        project={p}
        kind="demo"
        snapshotParcalar={SNAPSHOT}
        onApproveParcalar={() => {}}
      />,
    )
    for (const name of SNAPSHOT) {
      expect(container.textContent).toContain(name)
    }
  })

  it('hides the bulk button on a single-parça sheet (no need to bulk-approve one row)', () => {
    const p = { demo_parca_approvals: [], demo_parca_rejections: [] }
    render(
      <ParcaApprovalGrid
        project={p}
        kind="demo"
        snapshotParcalar={['KAPAK']}
        onApproveParcalar={() => {}}
      />,
    )
    expect(container.querySelector('button[aria-label*="Tüm parçaları onaylayın"]')).toBe(null)
  })

  it('shows the bulk button on a multi-parça sheet with ≥2 pending', () => {
    const p = { demo_parca_approvals: [], demo_parca_rejections: [] }
    render(
      <ParcaApprovalGrid
        project={p}
        kind="demo"
        snapshotParcalar={SNAPSHOT}
        onApproveParcalar={() => {}}
      />,
    )
    const btn = container.querySelector('button[aria-label*="Tüm parçaları onaylayın"]')
    expect(btn).toBeTruthy()
    expect(btn.textContent).toContain('(3)') // count of pending parçalar
  })

  it('passes `null` (all pending) when the bulk button is clicked', () => {
    const p = { demo_parca_approvals: [], demo_parca_rejections: [] }
    let receivedParcalar = null
    render(
      <ParcaApprovalGrid
        project={p}
        kind="demo"
        snapshotParcolar={SNAPSHOT}
        snapshotParcalar={SNAPSHOT}
        onApproveParcalar={(parcalar) => { receivedParcalar = parcalar }}
      />,
    )
    const btn = container.querySelector('button[aria-label*="Tüm parçaları onaylayın"]')
    act(() => btn.click())
    // null on the bulk shortcut — server defaults to "all still-pending".
    expect(receivedParcalar).toBe(null)
  })

  it('marks an already-approved parça as approved (read-only, no buttons)', () => {
    const p = {
      demo_parca_approvals: [{ parca: 'KAPAK', by: 'u-l', by_name: 'Ayşenur' }],
      demo_parca_rejections: [],
    }
    render(
      <ParcaApprovalGrid
        project={p}
        kind="demo"
        snapshotParcalar={SNAPSHOT}
        onApproveParcalar={() => {}}
      />,
    )
    // KAPAK is approved → no approve/reject button for it.
    expect(container.querySelector('button[aria-label="KAPAK parçasını onayla"]')).toBe(null)
    // KUTU + KILAVUZ still pending → buttons present.
    expect(container.querySelector('button[aria-label="KUTU parçasını onayla"]')).toBeTruthy()
    expect(container.querySelector('button[aria-label="KILAVUZ parçasını onayla"]')).toBeTruthy()
  })

  it('hides the bulk button when 0 parçalar are pending (nothing to bulk-approve)', () => {
    const p = {
      demo_parca_approvals: SNAPSHOT.map((name) => ({ parca: name, by: 'u-l' })),
      demo_parca_rejections: [],
    }
    render(
      <ParcaApprovalGrid
        project={p}
        kind="demo"
        snapshotParcalar={SNAPSHOT}
        onApproveParcalar={() => {}}
      />,
    )
    // When every parça is already approved, the grid shows NO bulk
    // button — nothing to approve, so the shortcut would be a no-op.
    expect(container.querySelector('button[aria-label*="Tüm parçaları onaylayın"]')).toBe(null)
    // The grid also drops the "X bekliyor" header chip.
    expect(container.textContent).not.toContain('bekliyor')
  })

  it('does NOT render anything when the snapshot has no parçalar', () => {
    const p = { demo_parca_approvals: [] }
    render(
      <ParcaApprovalGrid
        project={p}
        kind="demo"
        snapshotParcalar={[]}
        onApproveParcalar={() => {}}
      />,
    )
    expect(container.textContent.trim()).toBe('')
  })
})

/**
 * Parçalar the PROJECT has that no round ever carried.
 *
 * They are absent from the snapshot and from every ledger — which is exactly
 * what made the bug invisible: the grid described the round and read as though
 * it described the project. A leader could sign off every row here and still be
 * leaving a parça that never had a demo, and the server would then refuse to
 * advance with nothing on screen explaining why.
 */
describe('ParcaApprovalGrid — never-sent parçalar', () => {
  const clean = { demo_parca_approvals: [], demo_parca_rejections: [] }

  it('draws a row for a parça that is not on the round at all', () => {
    render(
      <ParcaApprovalGrid
        project={clean}
        kind="demo"
        snapshotParcalar={['KAPAK', 'KUTU']}
        neverSentParcalar={['KILAVUZ']}
        onApproveParcalar={() => {}}
      />,
    )
    expect(container.textContent).toContain('KILAVUZ')
    expect(container.textContent).toContain('Gönderilmedi')
  })

  it('offers no decision on it — there is nothing to decide yet', () => {
    render(
      <ParcaApprovalGrid
        project={clean}
        kind="demo"
        snapshotParcalar={['KAPAK', 'KUTU']}
        neverSentParcalar={['KILAVUZ']}
        onApproveParcalar={() => {}}
        onRejectParcalar={() => {}}
      />,
    )
    expect(container.querySelector('button[aria-label*="KILAVUZ parçasını onayla"]')).toBe(null)
    expect(container.querySelector('button[aria-label*="KILAVUZ parçasını reddet"]')).toBe(null)
  })

  it('keeps the bulk shortcut, scoped to the parçalar that WERE sent', () => {
    // The bulk buttons act on the round, and a parça nobody sent is not part of
    // it — the count says so. Signing off what arrived is real work the server
    // records; the round then holds at the gate until the missing parça is sent.
    render(
      <ParcaApprovalGrid
        project={clean}
        kind="demo"
        snapshotParcalar={['KAPAK', 'KUTU']}
        neverSentParcalar={['KILAVUZ']}
        onApproveParcalar={() => {}}
      />,
    )
    const btn = container.querySelector('button[aria-label*="Tüm parçaları onaylayın"]')
    expect(btn).toBeTruthy()
    expect(btn.textContent).toContain('(2)') // KAPAK + KUTU, never KILAVUZ
  })

  it('counts the missing parça as outstanding in the header', () => {
    // It is the leader's own job and the reason the round will not close, so
    // leaving it out of "bekliyor" is what kept the omission invisible.
    render(
      <ParcaApprovalGrid
        project={{
          demo_parca_approvals: [
            { parca: 'KAPAK', by: 'u-l', by_name: 'Ayşenur' },
            { parca: 'KUTU', by: 'u-l', by_name: 'Ayşenur' },
          ],
          demo_parca_rejections: [],
        }}
        kind="demo"
        snapshotParcalar={['KAPAK', 'KUTU']}
        neverSentParcalar={['KILAVUZ']}
        onApproveParcalar={() => {}}
      />,
    )
    expect(container.textContent).toContain('1 bekliyor')
    expect(container.textContent).toContain('3 parça')
  })

  it('changes nothing when the prop is omitted', () => {
    render(
      <ParcaApprovalGrid
        project={clean}
        kind="demo"
        snapshotParcalar={['KAPAK', 'KUTU']}
        onApproveParcalar={() => {}}
      />,
    )
    expect(container.textContent).not.toContain('Gönderilmedi')
    expect(container.querySelector('button[aria-label*="Tüm parçaları onaylayın"]')).toBeTruthy()
  })
})

/**
 * "Tümünü Reddedin" — the header's old whole-round Reddet, relocated.
 *
 * Approving and rejecting a round are the same kind of decision, and having one
 * of them in the header above the panel and the other inside it meant the panel
 * only ever told half the story. Both bulk buttons now sit together, above the
 * per-parça rows they summarise.
 *
 * The grid does not re-derive when a whole-round reject is allowed — receipt
 * gate, role, split-across-desks all live in `availableActions`, which hands the
 * decision over as the 'reject-parca' action. The handler's presence IS the
 * permission.
 */
describe('ParcaApprovalGrid — bulk reject', () => {
  const clean = { demo_parca_approvals: [], demo_parca_rejections: [] }

  it('is absent unless the caller passes a handler', () => {
    render(
      <ParcaApprovalGrid
        project={clean}
        kind="demo"
        snapshotParcalar={['KAPAK', 'KUTU']}
        onApproveParcalar={() => {}}
      />,
    )
    expect(container.querySelector('button[aria-label*="Tümünü Reddedin"]')).toBe(null)
  })

  it('sits beside the bulk approve when one is passed', () => {
    render(
      <ParcaApprovalGrid
        project={clean}
        kind="demo"
        snapshotParcalar={['KAPAK', 'KUTU']}
        onApproveParcalar={() => {}}
        onBulkReject={() => {}}
      />,
    )
    expect(container.querySelector('button[aria-label*="Tüm parçaları onaylayın"]')).toBeTruthy()
    expect(container.querySelector('button[aria-label*="Tümünü Reddedin"]')).toBeTruthy()
  })

  it('fires the handler on click', () => {
    let fired = false
    render(
      <ParcaApprovalGrid
        project={clean}
        kind="demo"
        snapshotParcalar={['KAPAK', 'KUTU']}
        onApproveParcalar={() => {}}
        onBulkReject={() => { fired = true }}
      />,
    )
    act(() => container.querySelector('button[aria-label*="Tümünü Reddedin"]').click())
    expect(fired).toBe(true)
  })

  it('still shows when there is nothing left to bulk-approve', () => {
    // A round the leader has already signed off parça by parça can still be
    // bounced as a whole — the header's Reddet never depended on anything being
    // pending, and moving it must not quietly add that condition.
    render(
      <ParcaApprovalGrid
        project={{
          demo_parca_approvals: [
            { parca: 'KAPAK', by: 'u-l', by_name: 'Ayşenur' },
            { parca: 'KUTU', by: 'u-l', by_name: 'Ayşenur' },
          ],
          demo_parca_rejections: [],
        }}
        kind="demo"
        snapshotParcalar={['KAPAK', 'KUTU']}
        onApproveParcalar={() => {}}
        onBulkReject={() => {}}
      />,
    )
    expect(container.querySelector('button[aria-label*="Tüm parçaları onaylayın"]')).toBe(null)
    expect(container.querySelector('button[aria-label*="Tümünü Reddedin"]')).toBeTruthy()
  })

  it('stays off the unfinished-round surface', () => {
    // With routing rows the grid is showing a round still out at the matbaa.
    // Bouncing the whole round there would discard parçalar still in the press.
    render(
      <ParcaApprovalGrid
        project={clean}
        kind="demo"
        snapshotParcalar={['KAPAK', 'KUTU']}
        parcaRows={[{ parca: 'KAPAK', state: 'with_matbaa', owner_role: 'printer' }]}
        onApproveParcalar={() => {}}
        onBulkReject={() => {}}
      />,
    )
    expect(container.querySelector('button[aria-label*="Tümünü Reddedin"]')).toBe(null)
  })
})

/**
 * The whole-round receipt, in the panel.
 *
 * It used to be a header-only pair, and the panel did not draw at all until it
 * was pressed (`parcaRoundDecidable` is false until the receipt) — so the one
 * screen that could have said WHAT was being taken delivery of was the one thing
 * missing at that moment. Now the panel draws its rows first and carries the
 * receipt itself.
 *
 * This is one receipt for the whole round, not a per-parça one: the stage only
 * reaches its gate once the matbaa has delivered every parça, so the proof
 * arrives as a single package. The genuinely per-parça receipt is
 * `onReceiveParca`, on the *_teslim surface where parçalar trickle back.
 */
describe('ParcaApprovalGrid — round awaiting receipt', () => {
  const clean = { demo_parca_approvals: [], demo_parca_rejections: [] }
  const props = {
    project: clean,
    kind: 'demo',
    snapshotParcalar: ['KAPAK', 'KUTU'],
    roundAwaitsReceipt: true,
    onApproveParcalar: () => {},
  }

  it('offers the receipt pair instead of the approve pair', () => {
    render(<ParcaApprovalGrid {...props} onBulkReceive={() => {}} onBulkNotReceived={() => {}} />)
    expect(container.querySelector('button[aria-label*="Tümünü Teslim Alın"]')).toBeTruthy()
    expect(container.querySelector('button[aria-label*="Teslim Alınamadı"]')).toBeTruthy()
    expect(container.querySelector('button[aria-label*="Tüm parçaları onaylayın"]')).toBe(null)
  })

  it('withholds every per-parça decision until the proof has arrived', () => {
    // The receipt gate the server has always enforced, now visible per parça
    // rather than implied by an empty screen.
    render(
      <ParcaApprovalGrid {...props} onBulkReceive={() => {}} onRejectParcalar={() => {}} />,
    )
    expect(container.querySelector('button[aria-label="KAPAK parçasını onayla"]')).toBe(null)
    expect(container.querySelector('button[aria-label="KAPAK parçasını reddet"]')).toBe(null)
    expect(container.textContent).toContain('Teslim bekliyor')
  })

  it('withholds the whole-round reject too — you cannot bounce what you have not received', () => {
    render(<ParcaApprovalGrid {...props} onBulkReceive={() => {}} onBulkReject={() => {}} />)
    expect(container.querySelector('button[aria-label*="Tümünü Reddedin"]')).toBe(null)
  })

  it('still lists what the round contains', () => {
    // The whole point of drawing before the receipt: the leader sees what they
    // are about to say arrived.
    render(<ParcaApprovalGrid {...props} onBulkReceive={() => {}} />)
    expect(container.textContent).toContain('KAPAK')
    expect(container.textContent).toContain('KUTU')
  })

  it('fires the handlers on click', () => {
    let received = false
    let notReceived = false
    render(
      <ParcaApprovalGrid
        {...props}
        onBulkReceive={() => { received = true }}
        onBulkNotReceived={() => { notReceived = true }}
      />,
    )
    act(() => container.querySelector('button[aria-label*="Tümünü Teslim Alın"]').click())
    act(() => container.querySelector('button[aria-label*="Teslim Alınamadı"]').click())
    expect(received).toBe(true)
    expect(notReceived).toBe(true)
  })

  it('draws nothing extra once the round has been received', () => {
    render(
      <ParcaApprovalGrid
        {...props}
        roundAwaitsReceipt={false}
        onBulkReceive={() => {}}
        onBulkReject={() => {}}
      />,
    )
    expect(container.querySelector('button[aria-label*="Tümünü Teslim Alın"]')).toBe(null)
    expect(container.querySelector('button[aria-label*="Tüm parçaları onaylayın"]')).toBeTruthy()
    expect(container.querySelector('button[aria-label*="Tümünü Reddedin"]')).toBeTruthy()
  })

  it('keeps a parça signed off on a previous round reading as signed off', () => {
    // The ledger wins over the receipt state — an approved parça is not
    // "awaiting receipt" just because this round is.
    render(
      <ParcaApprovalGrid
        {...props}
        project={{
          demo_parca_approvals: [{ parca: 'KAPAK', by: 'u-l', by_name: 'Ayşenur' }],
          demo_parca_rejections: [],
        }}
        onBulkReceive={() => {}}
      />,
    )
    expect(container.textContent).toContain('Onaylandı')
  })
})

/**
 * Baskı Onayı — a gate with two steps, told apart.
 *
 * `pendingParcalar` folds "nobody prepared it" and "nobody approved it"
 * together, which is right for the gate (either one holds the project) and wrong
 * for the panel: it left an unprepared parça wearing a thumbs-up that does
 * nothing, because the server filters unprepared parçalar out of any approve it
 * is handed (`preparers[p] && !approvals[p]`).
 *
 * Preparing is ONE act on ONE document — the baskı formu is a single sheet, so
 * one button prepares every parça on it. Only the onay that follows is per
 * parça, which is where the maker-checker lives.
 */
describe('ParcaApprovalGrid — baskı onayı prepare step', () => {
  const SNAP = ['KAPAK', 'KUTU']
  const prep = (by) => ({ by, by_name: 'Ayşenur', at: '2026-09-08T09:00:00.000Z' })

  it('marks an unprepared parça as Hazırlanmadı, with no thumbs', () => {
    render(
      <ParcaApprovalGrid
        project={{ baski_parca_preparers: {}, baski_parca_approvals: {} }}
        kind="baski_onay"
        snapshotParcalar={SNAP}
        onApproveParcalar={() => {}}
      />,
    )
    expect(container.textContent).toContain('Hazırlanmadı')
    expect(container.querySelector('button[aria-label="KAPAK parçasını onayla"]')).toBe(null)
  })

  it('offers one prepare button for the whole sheet, counting what it covers', () => {
    render(
      <ParcaApprovalGrid
        project={{ baski_parca_preparers: {}, baski_parca_approvals: {} }}
        kind="baski_onay"
        snapshotParcalar={SNAP}
        onApproveParcalar={() => {}}
        onPrepareSheet={() => {}}
      />,
    )
    const btn = container.querySelector('button[aria-label*="Baskı Onayı Hazırlayın"]')
    expect(btn).toBeTruthy()
    expect(btn.textContent).toContain('(2)')
  })

  it('gives a prepared parça its thumbs-up back', () => {
    render(
      <ParcaApprovalGrid
        project={{
          baski_parca_preparers: { KAPAK: prep('u-a') },
          baski_parca_approvals: {},
        }}
        kind="baski_onay"
        snapshotParcalar={SNAP}
        onApproveParcalar={() => {}}
        onPrepareSheet={() => {}}
      />,
    )
    expect(container.querySelector('button[aria-label="KAPAK parçasını onayla"]')).toBeTruthy()
    // KUTU is still unprepared, so it keeps the badge and no button.
    expect(container.querySelector('button[aria-label="KUTU parçasını onayla"]')).toBe(null)
    expect(container.textContent).toContain('Hazırlanmadı')
  })

  it('counts only prepared parçalar in the bulk approve', () => {
    // The button must not promise a parça the server would silently drop.
    render(
      <ParcaApprovalGrid
        project={{
          baski_parca_preparers: { KAPAK: prep('u-a') },
          baski_parca_approvals: {},
        }}
        kind="baski_onay"
        snapshotParcalar={SNAP}
        onApproveParcalar={() => {}}
      />,
    )
    const bulk = container.querySelector('button[aria-label*="Tüm parçaları onaylayın"]')
    if (bulk) expect(bulk.textContent).toContain('(1)')
  })

  it('drops the prepare button once everything is prepared', () => {
    render(
      <ParcaApprovalGrid
        project={{
          baski_parca_preparers: { KAPAK: prep('u-a'), KUTU: prep('u-a') },
          baski_parca_approvals: {},
        }}
        kind="baski_onay"
        snapshotParcalar={SNAP}
        onApproveParcalar={() => {}}
        onPrepareSheet={() => {}}
      />,
    )
    expect(container.querySelector('button[aria-label*="Baskı Onayı Hazırlayın"]')).toBe(null)
    expect(container.textContent).not.toContain('Hazırlanmadı')
  })

  it('leaves the demo and ozalit gates alone — they have no prepare step', () => {
    render(
      <ParcaApprovalGrid
        project={{ demo_parca_approvals: [], demo_parca_rejections: [] }}
        kind="demo"
        snapshotParcalar={SNAP}
        onApproveParcalar={() => {}}
        onPrepareSheet={() => {}}
      />,
    )
    expect(container.querySelector('button[aria-label*="Baskı Onayı Hazırlayın"]')).toBe(null)
    expect(container.textContent).not.toContain('Hazırlanmadı')
  })
})
