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

  it('withdraws once any parça has been signed off', () => {
    // Reported from a live round: three parçalar, two approved, one still
    // pending — and "Tümünü Reddedin" sitting above them. It reads as "send back
    // the one that's left"; what it does is `computeRejection`'s non-partial
    // branch, which sets demo_parca_approvals to [] and bumps the attempt. The
    // two sign-offs the leader gave are gone, silently.
    //
    // The row's own thumbs-down is the honest action for the rest of the round:
    // a per-parça reject bounces that parça and leaves the others locked.
    render(
      <ParcaApprovalGrid
        project={{
          demo_parca_approvals: [
            { parca: 'KAPAK', by: 'u-l', by_name: 'Ayşenur' },
            { parca: 'KİTAP', by: 'u-l', by_name: 'Ayşenur' },
          ],
          demo_parca_rejections: [],
        }}
        kind="demo"
        snapshotParcalar={['KAPAK', 'KİTAP', 'KUTU']}
        onApproveParcalar={() => {}}
        onRejectParcalar={() => {}}
        onBulkReject={() => {}}
      />,
    )
    expect(container.querySelector('button[aria-label*="Tümünü Reddedin"]')).toBe(null)
    // …and the per-parça way out of the pending one is still right there.
    expect(container.querySelector('button[aria-label="KUTU parçasını reddet"]')).toBeTruthy()
  })

  it('withdraws once any parça has been sent back, too', () => {
    // Same wipe, other ledger: the non-partial branch clears
    // demo_parca_rejections as well, so a bounce here would erase the record of
    // the parça already on its way to the matbaa.
    render(
      <ParcaApprovalGrid
        project={{
          demo_parca_approvals: [],
          demo_parca_rejections: [{ parca: 'KAPAK', by: 'u-l', target: 'matbaa' }],
        }}
        kind="demo"
        snapshotParcalar={['KAPAK', 'KUTU']}
        onApproveParcalar={() => {}}
        onBulkReject={() => {}}
      />,
    )
    expect(container.querySelector('button[aria-label*="Tümünü Reddedin"]')).toBe(null)
  })

  it('is offered on a round nobody has decided anything on', () => {
    // The one round the button is honest about: everything goes back, and there
    // is nothing on the ledger for the wipe to destroy.
    render(
      <ParcaApprovalGrid
        project={clean}
        kind="demo"
        snapshotParcalar={['KAPAK', 'KİTAP', 'KUTU']}
        onApproveParcalar={() => {}}
        onBulkReject={() => {}}
      />,
    )
    expect(container.querySelector('button[aria-label*="Tümünü Reddedin"]')).toBeTruthy()
  })

  /**
   * The ozalit leg gets all of this for free — one grid, one `kind` prop — but
   * "for free" is worth two tests, because the two ledgers are not the same
   * SHAPE. `demo_parca_approvals` is a list of rows; `ozalit_parca_approvals` is
   * an object keyed by parça whose values are the signer lists. A partialArrival
   * that only knew how to count a list would read every ozalit round as
   * undecided and leave the wiping button on screen for exactly the case it was
   * just removed from.
   */
  it('does the same on the ozalit leg, whose ledger is object-shaped', () => {
    render(
      <ParcaApprovalGrid
        project={{
          ozalit_parca_approvals: { KAPAK: [{ id: 'u-l', name: 'Ayşenur' }] },
          ozalit_parca_rejections: [],
        }}
        kind="ozalit"
        snapshotParcalar={['KAPAK', 'KİTAP', 'KUTU']}
        onApproveParcalar={() => {}}
        onBulkReject={() => {}}
      />,
    )
    expect(container.querySelector('button[aria-label*="Tümünü Reddedin"]')).toBe(null)
  })

  it('…and still offers it on an ozalit round nobody has signed', () => {
    render(
      <ParcaApprovalGrid
        project={{ ozalit_parca_approvals: {}, ozalit_parca_rejections: [] }}
        kind="ozalit"
        snapshotParcalar={['KAPAK', 'KİTAP', 'KUTU']}
        onApproveParcalar={() => {}}
        onBulkReject={() => {}}
      />,
    )
    expect(container.querySelector('button[aria-label*="Tümünü Reddedin"]')).toBeTruthy()
  })

  /**
   * A button with no handler behind it is not a button.
   *
   * Reported live: an assigned designer at `ozalit_onay`, before any team leader
   * had signed, saw "Tüm parçaları onaylayın (3)" and a green thumb on every
   * row — with no red one anywhere. The asymmetry was the tell. Reject asked
   * whether it had a handler; approve built its closure from the row's status
   * alone and let `onApproveParcalar?.()` swallow the click. So the panel drew
   * a full set of sign-off buttons for the one person the ozalit's leader-first
   * rule says must not have them yet.
   */
  describe('approve buttons require a handler, as reject always did', () => {
    const props = {
      project: { demo_parca_approvals: [], demo_parca_rejections: [] },
      kind: 'demo',
      snapshotParcalar: ['KAPAK', 'KİTAP', 'KUTU'],
    }

    it('draws no per-row thumbs-up without onApproveParcalar', () => {
      render(<ParcaApprovalGrid {...props} />)
      expect(container.querySelector('button[aria-label="KAPAK parçasını onayla"]')).toBe(null)
    })

    it('draws no bulk approve without a handler either', () => {
      render(<ParcaApprovalGrid {...props} />)
      expect(container.querySelector('button[aria-label*="Tüm parçaları onaylayın"]')).toBe(null)
    })

    it('still lists the round — seeing it was never the thing withheld', () => {
      render(<ParcaApprovalGrid {...props} />)
      expect(container.textContent).toContain('KAPAK')
      expect(container.textContent).toContain('KUTU')
    })

    it('draws both again once a handler is passed', () => {
      render(<ParcaApprovalGrid {...props} onApproveParcalar={() => {}} />)
      expect(container.querySelector('button[aria-label="KAPAK parçasını onayla"]')).toBeTruthy()
      expect(container.querySelector('button[aria-label*="Tüm parçaları onaylayın"]')).toBeTruthy()
    })

    it('accepts onBulkApprove as the bulk half’s handler', () => {
      // The baskı/queue callers pass this instead of onApproveParcalar.
      render(<ParcaApprovalGrid {...props} onBulkApprove={() => {}} />)
      expect(container.querySelector('button[aria-label*="Tüm parçaları onaylayın"]')).toBeTruthy()
    })
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

/**
 * One parça coming back is not the round arriving.
 *
 * `settleParcaAtGate` clears the project-level `demo_received` when the matbaa
 * hands back a SINGLE parça after a per-parça reject — the same flag a fresh
 * whole-round delivery clears — so the two states are indistinguishable from the
 * project row. The ledger tells them apart, and it has to: "Tümünü Teslim Alın"
 * is a lie about one reprint, and "Teslim Alınamadı" there bounces the whole
 * round and wipes the sign-offs already given (the server refuses it now).
 */
describe('ParcaApprovalGrid — partial arrival at the gate', () => {
  const SNAP = ['KAPAK', 'KUTU', 'KILAVUZ']
  const partly = {
    demo_parca_approvals: [
      { parca: 'KAPAK', by: 'u-l', by_name: 'Ayşenur' },
      { parca: 'KUTU', by: 'u-l', by_name: 'Ayşenur' },
    ],
    demo_parca_rejections: [],
  }

  it('does not claim to receive the whole round', () => {
    render(
      <ParcaApprovalGrid
        project={partly}
        kind="demo"
        snapshotParcalar={SNAP}
        roundAwaitsReceipt
        onApproveParcalar={() => {}}
        onBulkReceive={() => {}}
      />,
    )
    expect(container.querySelector('button[aria-label="Teslim Alın"]')).toBeTruthy()
    expect(container.querySelector('button[aria-label*="Tümünü Teslim Alın"]')).toBe(null)
  })

  it('withholds Teslim Alınamadı, which would wipe those approvals', () => {
    render(
      <ParcaApprovalGrid
        project={partly}
        kind="demo"
        snapshotParcalar={SNAP}
        roundAwaitsReceipt
        onApproveParcalar={() => {}}
        onBulkReceive={() => {}}
        onBulkNotReceived={() => {}}
      />,
    )
    expect(container.querySelector('button[aria-label*="Teslim Alınamadı"]')).toBe(null)
  })

  it('keeps both on a genuinely fresh round, where nothing is signed', () => {
    render(
      <ParcaApprovalGrid
        project={{ demo_parca_approvals: [], demo_parca_rejections: [] }}
        kind="demo"
        snapshotParcalar={SNAP}
        roundAwaitsReceipt
        onApproveParcalar={() => {}}
        onBulkReceive={() => {}}
        onBulkNotReceived={() => {}}
      />,
    )
    expect(container.querySelector('button[aria-label*="Tümünü Teslim Alın"]')).toBeTruthy()
    expect(container.querySelector('button[aria-label*="Teslim Alınamadı"]')).toBeTruthy()
  })

  it('leaves the signed parçalar reading as signed', () => {
    render(
      <ParcaApprovalGrid
        project={partly}
        kind="demo"
        snapshotParcalar={SNAP}
        roundAwaitsReceipt
        onApproveParcalar={() => {}}
        onBulkReceive={() => {}}
      />,
    )
    expect(container.textContent).toContain('Onaylandı')
    // …and only the returned parça is waiting on the leader.
    expect(container.textContent).toContain('1 bekliyor')
  })
})


/**
 * Ozalit is multi-party, so "still pending" is a question about the VIEWER.
 *
 * Reported live: the leader signed a parça on a partially-delivered ozalit and
 * the assigned designer's approve button never appeared. `pendingParcalar` read
 * the ozalit ledger round-level — "does this parça have any signature at all" —
 * so the leader's own sign-off closed the row for everybody. The designer saw
 * `Onaylandı` on a parça they had never signed and the gate was still waiting on
 * them for.
 */
describe('ParcaApprovalGrid — the ozalit ledger is per-party', () => {
  const leader = { id: 'u-l', role: 'team_leader' }
  const designer = { id: 'u-d', role: 'designer' }
  const leaderSigned = {
    ozalit_parca_approvals: { KUTU: [{ id: 'u-l', role: 'team_leader', name: 'Ayşenur' }] },
    ozalit_parca_rejections: [],
  }
  const props = { kind: 'ozalit', snapshotParcalar: ['KUTU', 'KAPAK'] }

  it('gives the designer a thumb on a parça the leader has signed', () => {
    render(
      <ParcaApprovalGrid
        {...props}
        project={leaderSigned}
        user={designer}
        onApproveParcalar={() => {}}
      />,
    )
    expect(container.querySelector('button[aria-label="KUTU parçasını onayla"]')).toBeTruthy()
  })

  it('withholds it on a parça no leader has signed — leader-first, per parça', () => {
    render(
      <ParcaApprovalGrid
        {...props}
        project={leaderSigned}
        user={designer}
        onApproveParcalar={() => {}}
      />,
    )
    expect(container.querySelector('button[aria-label="KAPAK parçasını onayla"]')).toBe(null)
  })

  it('shows the leader their own sign-off as done', () => {
    render(
      <ParcaApprovalGrid
        {...props}
        project={leaderSigned}
        user={leader}
        onApproveParcalar={() => {}}
      />,
    )
    expect(container.querySelector('button[aria-label="KUTU parçasını onayla"]')).toBe(null)
    expect(container.querySelector('button[aria-label="KAPAK parçasını onayla"]')).toBeTruthy()
  })

  it('drops the designer’s bulk button to what they may actually sign', () => {
    render(
      <ParcaApprovalGrid
        {...props}
        project={leaderSigned}
        user={designer}
        onApproveParcalar={() => {}}
        bulkApproveLabel="Tüm parçaları onaylayın"
      />,
    )
    // Only KUTU is theirs to sign; KAPAK has no leader row yet.
    const bulk = container.querySelector('button[aria-label*="Tüm parçaları onaylayın"]')
    expect(bulk).toBe(null)
  })

  it('leaves the demo leg round-level — nobody counter-signs a demo', () => {
    render(
      <ParcaApprovalGrid
        kind="demo"
        snapshotParcalar={['KUTU', 'KAPAK']}
        project={{
          demo_parca_approvals: [{ parca: 'KUTU', by: 'u-l', by_name: 'Ayşenur' }],
          demo_parca_rejections: [],
        }}
        user={leader}
        onApproveParcalar={() => {}}
      />,
    )
    expect(container.querySelector('button[aria-label="KUTU parçasını onayla"]')).toBe(null)
    expect(container.textContent).toContain('Onaylandı')
  })
})

/**
 * A round of ONE parça is decided in the panel too.
 *
 * The header's Onayla/Reddet used to stay for it, on the reasoning that one
 * button is enough for one parça. Every decision on a round with a parça list is
 * now taken in one place instead — so the grid draws, and the only things that
 * change are the ones that would misdescribe a round of one.
 */
describe('ParcaApprovalGrid — a round of one parça', () => {
  const clean = { demo_parca_approvals: [], demo_parca_rejections: [] }
  const props = { project: clean, kind: 'demo', snapshotParcalar: ['ANA PARÇA'] }

  it('draws the row with both of its buttons', () => {
    render(<ParcaApprovalGrid {...props} onApproveParcalar={() => {}} onRejectParcalar={() => {}} />)
    expect(container.textContent).toContain('1 parça')
    expect(container.querySelector('button[aria-label="ANA PARÇA parçasını onayla"]')).toBeTruthy()
    expect(container.querySelector('button[aria-label="ANA PARÇA parçasını reddet"]')).toBeTruthy()
  })

  it('offers no "Tümünü Reddedin" — the row’s thumbs-down is that button', () => {
    // The caller wires the row to the whole-round reject on a round of one; a
    // second button for the same act would only disagree with it about the name.
    render(
      <ParcaApprovalGrid
        {...props}
        onApproveParcalar={() => {}}
        onRejectParcalar={() => {}}
        onBulkReject={() => {}}
      />,
    )
    expect(container.querySelector('button[aria-label*="Tümünü Reddedin"]')).toBe(null)
    expect(container.querySelector('button[aria-label="ANA PARÇA parçasını reddet"]')).toBeTruthy()
  })

  it('offers no bulk approve either', () => {
    render(<ParcaApprovalGrid {...props} onApproveParcalar={() => {}} />)
    expect(container.querySelector('button[aria-label*="Tüm parçaları onaylayın"]')).toBe(null)
  })

  it('takes delivery with "Teslim Alın", not "Tümünü Teslim Alın"', () => {
    render(
      <ParcaApprovalGrid
        {...props}
        roundAwaitsReceipt
        onApproveParcalar={() => {}}
        onBulkReceive={() => {}}
        onBulkNotReceived={() => {}}
      />,
    )
    expect(container.querySelector('button[aria-label="Teslim Alın"]')).toBeTruthy()
    expect(container.querySelector('button[aria-label*="Tümünü Teslim Alın"]')).toBe(null)
    // Nothing is signed yet, so the not-received escape stays.
    expect(container.querySelector('button[aria-label="Teslim Alınamadı"]')).toBeTruthy()
  })

  it('offers the baskı prepare step for the one parça', () => {
    render(
      <ParcaApprovalGrid
        project={{ baski_parca_preparers: {}, baski_parca_approvals: {} }}
        kind="baski_onay"
        snapshotParcalar={['ANA PARÇA']}
        onApproveParcalar={() => {}}
        onPrepareSheet={() => {}}
      />,
    )
    const prepare = container.querySelector('button[aria-label*="Baskı Onayı Hazırlayın"]')
    expect(prepare).toBeTruthy()
    expect(prepare.textContent).toContain('(1)')
  })
})

/**
 * No button in the panel may submit a form it happens to be drawn inside.
 *
 * TalepSignDialog renders the grid inside its <form onSubmit={handleSign}>, and
 * `Button` sets no `type` of its own — so every thumb in it was a submit button,
 * and a per-parça click on a split sipariş round also fired the whole-order
 * approve.
 */
describe('ParcaApprovalGrid — buttons never submit a surrounding form', () => {
  const expectAllTyped = () => {
    const all = $$('button')
    expect(all.length).toBeGreaterThan(0)
    for (const b of all) expect(b.getAttribute('type')).toBe('button')
  }

  it('on the decision rows and the bulk pair', () => {
    render(
      <ParcaApprovalGrid
        project={{ demo_parca_approvals: [], demo_parca_rejections: [] }}
        kind="demo"
        snapshotParcalar={['KAPAK', 'KUTU']}
        onApproveParcalar={() => {}}
        onRejectParcalar={() => {}}
        onBulkReject={() => {}}
      />,
    )
    expectAllTyped()
  })

  it('on the whole-round receipt pair', () => {
    render(
      <ParcaApprovalGrid
        project={{ demo_parca_approvals: [], demo_parca_rejections: [] }}
        kind="demo"
        snapshotParcalar={['KAPAK', 'KUTU']}
        roundAwaitsReceipt
        onApproveParcalar={() => {}}
        onBulkReceive={() => {}}
        onBulkNotReceived={() => {}}
      />,
    )
    expectAllTyped()
  })

  it('on the baskı prepare button', () => {
    render(
      <ParcaApprovalGrid
        project={{ baski_parca_preparers: {}, baski_parca_approvals: {} }}
        kind="baski_onay"
        snapshotParcalar={['KAPAK', 'KUTU']}
        onApproveParcalar={() => {}}
        onPrepareSheet={() => {}}
      />,
    )
    expectAllTyped()
  })

  it('on the per-parça receipt of an unfinished round', () => {
    render(
      <ParcaApprovalGrid
        project={{ demo_parca_approvals: [], demo_parca_rejections: [] }}
        kind="demo"
        snapshotParcalar={['KAPAK', 'KUTU']}
        parcaRows={[{
          parca: 'KAPAK', state: 'pending', owner_role: null,
          delivered_at: '2026-09-08T09:00:00Z', received_at: null,
        }]}
        onApproveParcalar={() => {}}
        onReceiveParca={() => {}}
      />,
    )
    expectAllTyped()
  })
})
