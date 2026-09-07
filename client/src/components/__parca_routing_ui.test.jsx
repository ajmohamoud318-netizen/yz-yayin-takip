// Per-parça routing UI (migration 074).
//
// The three surfaces the feature adds, and the rules each one has to hold:
//
//   ParcaRejectDialog   — the leader must name the responsible party; there is
//                         no default, because guessing sends real work to the
//                         wrong desk.
//   ParcaJobCard        — the matbaa's queue row is a PARÇA, not a project, and
//                         its two states mirror the project-level ladder.
//   ParcaReturnedPanel  — the designer sees what came back to them, why, and
//                         the two roads out; parçalar held by someone else are
//                         visible but inert.
//
// Same no-react-testing-library approach as __approvals_parca.test.jsx: render
// into a container and assert against the DOM.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { MemoryRouter } from 'react-router-dom'

import ParcaRejectDialog from './ParcaRejectDialog.jsx'
import ParcaJobCard from './ParcaJobCard.jsx'
import ParcaReturnedPanel from './ParcaReturnedPanel.jsx'
import ParcaJobGroup from './ParcaJobGroup.jsx'

vi.mock('sonner', () => ({ toast: { success: () => {}, error: () => {} } }))

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
  act(() => { root.render(<MemoryRouter>{node}</MemoryRouter>) })
}

// Dialogs portal out of the container, so query the whole document.
function text() { return document.body.textContent ?? '' }
function buttons() {
  return Array.from(document.body.querySelectorAll('button'))
}
function buttonByText(re) {
  return buttons().find((b) => re.test(b.textContent ?? ''))
}
function click(el) {
  act(() => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
}

const project = { id: 'p-1', title: 'Zeka Küpü 6. Sınıf Türkçe Soru Bankası' }

describe('ParcaRejectDialog', () => {
  it('names every parça being rejected', () => {
    render(
      <ParcaRejectDialog
        open project={project} parcalar={['KUTU', 'KİTAP']} onConfirm={() => {}} onOpenChange={() => {}}
      />,
    )
    expect(text()).toContain('KUTU')
    expect(text()).toContain('KİTAP')
    // The project is context, so it is named too.
    expect(text()).toContain('Zeka Küpü 6. Sınıf Türkçe Soru Bankası')
  })

  it('offers both responsible parties with neither pre-selected', () => {
    render(
      <ParcaRejectDialog
        open project={project} parcalar={['KUTU']} onConfirm={() => {}} onOpenChange={() => {}}
      />,
    )
    const designer = buttonByText(/Tasarımcı/)
    const matbaa = buttonByText(/Matbaa/)
    expect(designer).toBeTruthy()
    expect(matbaa).toBeTruthy()
    // Choosing wrong routes real work to the wrong desk, so nothing is chosen
    // for the leader.
    expect(designer.getAttribute('aria-pressed')).toBe('false')
    expect(matbaa.getAttribute('aria-pressed')).toBe('false')
  })

  it('keeps submit disabled until BOTH a party and a reason are given', () => {
    render(
      <ParcaRejectDialog
        open project={project} parcalar={['KUTU']} onConfirm={() => {}} onOpenChange={() => {}}
      />,
    )
    const submit = buttonByText(/^Reddedin$/)
    expect(submit.disabled).toBe(true)

    // A party alone is not enough — the reject schema requires a reason.
    click(buttonByText(/Matbaa/))
    expect(buttonByText(/^Reddedin$/).disabled).toBe(true)
  })

  it('marks the chosen party as pressed', () => {
    render(
      <ParcaRejectDialog
        open project={project} parcalar={['KUTU']} onConfirm={() => {}} onOpenChange={() => {}}
      />,
    )
    click(buttonByText(/Matbaa/))
    expect(buttonByText(/Matbaa/).getAttribute('aria-pressed')).toBe('true')
    expect(buttonByText(/Tasarımcı/).getAttribute('aria-pressed')).toBe('false')
  })

  it('renders nothing when there are no parçalar to reject', () => {
    render(
      <ParcaRejectDialog open project={project} parcalar={[]} onConfirm={() => {}} onOpenChange={() => {}} />,
    )
    expect(buttonByText(/^Reddedin$/)).toBeFalsy()
  })
})

describe('ParcaJobCard', () => {
  const base = {
    project_id: 'p-1', project_title: 'Zeka Küpü 6. Sınıf', parca: 'KUTU',
    gate: 'demo', state: 'with_matbaa', attempt: 2, reason: 'baskı lekeli',
  }

  it('leads with the parça, not the project', () => {
    render(<ParcaJobCard row={base} onAct={() => {}} onNavigate={() => {}} />)
    expect(text()).toContain('KUTU')
    expect(text()).toContain('Zeka Küpü 6. Sınıf')
  })

  it('offers Başlatın before work has begun', () => {
    render(<ParcaJobCard row={base} onAct={() => {}} onNavigate={() => {}} />)
    expect(buttonByText(/İşlemi Başlatın/)).toBeTruthy()
    expect(buttonByText(/Teslim Edin/)).toBeFalsy()
  })

  it('offers Teslim Edin once the round is under way', () => {
    render(<ParcaJobCard row={{ ...base, state: 'in_round' }} onAct={() => {}} onNavigate={() => {}} />)
    expect(buttonByText(/Teslim Edin/)).toBeTruthy()
    expect(buttonByText(/İşlemi Başlatın/)).toBeFalsy()
  })

  it('shows why the parça came back — otherwise they are guessing', () => {
    render(<ParcaJobCard row={base} onAct={() => {}} onNavigate={() => {}} />)
    expect(text()).toContain('baskı lekeli')
  })

  it('shows the round number when it is a repeat', () => {
    render(<ParcaJobCard row={base} onAct={() => {}} onNavigate={() => {}} />)
    expect(text()).toContain('2. tur')
  })

  it('hands the whole row to the action, so the caller can open the right sheet', () => {
    let got = null
    render(<ParcaJobCard row={base} onAct={(r) => { got = r }} onNavigate={() => {}} />)
    click(buttonByText(/İşlemi Başlatın/))
    expect(got?.parca).toBe('KUTU')
    expect(got?.project_id).toBe('p-1')
  })
})

describe('ParcaReturnedPanel', () => {
  const mine = { parca: 'KİTAP', state: 'with_designer', owner_role: 'designer', reason: 'kerning bozuk', attempt: 2 }
  const atMatbaa = { parca: 'KUTU', state: 'in_round', owner_role: 'printer' }

  it('renders nothing when no parça is out', () => {
    render(<ParcaReturnedPanel rows={[{ parca: 'KUTU', state: 'approved' }]} onRequestRound={() => {}} />)
    expect(text()).not.toContain('Parça durumu')
  })

  it('shows the designer what came back and why', () => {
    render(<ParcaReturnedPanel rows={[mine]} canAct onRequestRound={() => {}} />)
    expect(text()).toContain('KİTAP')
    expect(text()).toContain('kerning bozuk')
    expect(text()).toContain('1 parça sizde')
  })

  it('shows parçalar held elsewhere, but without actions', () => {
    // The point of the feature is parallel work: a designer who cannot see the
    // matbaa's parça cannot tell whether the project waits on them or not.
    render(<ParcaReturnedPanel rows={[atMatbaa]} canAct onRequestRound={() => {}} />)
    expect(text()).toContain('KUTU')
    expect(text()).toContain('Matbaada')
    expect(buttonByText(/Revize Bitti/)).toBeFalsy()
  })

  it('offers no action at all to someone who may not act', () => {
    render(<ParcaReturnedPanel rows={[mine]} canAct={false} onRequestRound={() => {}} />)
    expect(text()).toContain('KİTAP')
    expect(buttonByText(/Revize Bitti/)).toBeFalsy()
  })

  it('does not offer the route until the sheet has been read', () => {
    // "Revize Bitti, Gönderin" opens the spec form; it does NOT reveal the two
    // roads on its own. The designer is about to put work back into the
    // pipeline, so they see what they are sending first — the same rule the
    // matbaa's İşlemi Başlatın and the leader's per-parça Onayla follow.
    const reviewed = []
    render(
      <ParcaReturnedPanel
        rows={[mine]} canAct onReview={(p) => reviewed.push(p)} onRequestRound={() => {}}
      />,
    )
    expect(buttonByText(/Matbaadan İsteyin/)).toBeFalsy()
    click(buttonByText(/Revize Bitti/))
    // Still not offered — the parent opens the sheet and reports back.
    expect(buttonByText(/Matbaadan İsteyin/)).toBeFalsy()
    expect(reviewed).toEqual(['KİTAP'])
  })

  it('offers both roads once the parent reports the sheet read', () => {
    render(
      <ParcaReturnedPanel
        rows={[mine]} canAct reviewedParca="KİTAP" onReview={() => {}} onRequestRound={() => {}}
      />,
    )
    expect(buttonByText(/Matbaadan İsteyin/)).toBeTruthy()
    expect(buttonByText(/Ekran Onayı İsteyin/)).toBeTruthy()
  })

  it('reveals the route only for the parça that was actually reviewed', () => {
    const other = { parca: 'KUTU', state: 'with_designer', owner_role: 'designer' }
    render(
      <ParcaReturnedPanel
        rows={[mine, other]} canAct reviewedParca="KİTAP"
        onReview={() => {}} onRequestRound={() => {}}
      />,
    )
    // One reviewed row shows the two roads; the other still shows its single
    // "Revize Bitti" button — reading KİTAP's sheet says nothing about KUTU.
    expect(buttons().filter((b) => /Matbaadan İsteyin/.test(b.textContent ?? '')).length).toBe(1)
    expect(buttons().filter((b) => /Revize Bitti/.test(b.textContent ?? '')).length).toBe(1)
  })

  it('passes the chosen route through', () => {
    const calls = []
    render(
      <ParcaReturnedPanel
        rows={[mine]} canAct reviewedParca="KİTAP"
        onReview={() => {}} onRequestRound={(p, r) => calls.push([p, r])}
      />,
    )
    click(buttonByText(/Ekran Onayı İsteyin/))
    expect(calls).toEqual([['KİTAP', 'ekran']])
  })

  it('sends a physical round to the matbaa', () => {
    const calls = []
    render(
      <ParcaReturnedPanel
        rows={[mine]} canAct reviewedParca="KİTAP"
        onReview={() => {}} onRequestRound={(p, r) => calls.push([p, r])}
      />,
    )
    click(buttonByText(/Matbaadan İsteyin/))
    expect(calls).toEqual([['KİTAP', 'physical']])
  })
})

/**
 * ParcaJobGroup — the matbaa's choice between doing a whole sheet in one pass
 * and picking parçalar off it individually.
 *
 * The rule underneath all of these: whatever they do NOT act on stays theirs.
 * The group never acts on a parça the printer did not pick, and the bulk
 * buttons are always scoped and counted so "Hepsini" can't quietly mean
 * something other than what is on screen.
 */
describe('ParcaJobGroup', () => {
  const row = (parca, state) => ({
    project_id: 'p-1', project_title: 'Zeka Küpü 6. Sınıf', parca,
    gate: 'demo', state, attempt: 1,
  })

  it('offers a bulk start when several parçalar are unstarted', () => {
    render(
      <ParcaJobGroup
        projectId="p-1" projectTitle="Zeka Küpü 6. Sınıf"
        rows={[row('KİTAP', 'with_matbaa'), row('KUTU', 'with_matbaa')]}
        onAct={() => {}} onActAll={() => {}} onNavigate={() => {}}
      />,
    )
    expect(buttonByText(/Hepsini Başlatın \(2\)/)).toBeTruthy()
    expect(buttonByText(/Hepsini Teslim Edin/)).toBeFalsy()
  })

  it('offers a bulk deliver once several are under way', () => {
    render(
      <ParcaJobGroup
        projectId="p-1" projectTitle="Zeka Küpü"
        rows={[row('KİTAP', 'in_round'), row('KUTU', 'in_round')]}
        onAct={() => {}} onActAll={() => {}} onNavigate={() => {}}
      />,
    )
    expect(buttonByText(/Hepsini Teslim Edin \(2\)/)).toBeTruthy()
  })

  it('keeps every parça individually actionable alongside the bulk button', () => {
    render(
      <ParcaJobGroup
        projectId="p-1" projectTitle="Zeka Küpü"
        rows={[row('KİTAP', 'with_matbaa'), row('KUTU', 'with_matbaa')]}
        onAct={() => {}} onActAll={() => {}} onNavigate={() => {}}
      />,
    )
    // Two per-parça buttons plus the one bulk button.
    const starts = buttons().filter((b) => /İşlemi Başlatın/.test(b.textContent ?? ''))
    expect(starts.length).toBe(2)
    expect(buttonByText(/Hepsini Başlatın/)).toBeTruthy()
  })

  it('scopes each bulk button to only the parçalar in that state', () => {
    // A mixed group: one started, two not. Neither bulk button may act on the
    // other state's parçalar.
    const rows = [row('KİTAP', 'in_round'), row('KUTU', 'with_matbaa'), row('KILAVUZ', 'with_matbaa')]
    let got = null
    render(
      <ParcaJobGroup
        projectId="p-1" projectTitle="Zeka Küpü" rows={rows}
        onAct={() => {}} onActAll={(r) => { got = r }} onNavigate={() => {}}
      />,
    )
    // Only two are unstarted, so the bulk start says 2 — not 3.
    expect(buttonByText(/Hepsini Başlatın \(2\)/)).toBeTruthy()
    // And only one is started, so no bulk deliver at all (a lone parça has its
    // own button already).
    expect(buttonByText(/Hepsini Teslim Edin/)).toBeFalsy()
    click(buttonByText(/Hepsini Başlatın/))
    expect(got.map((r) => r.parca).sort()).toEqual(['KILAVUZ', 'KUTU'])
  })

  it('drops the group chrome for a single parça — it IS the job', () => {
    render(
      <ParcaJobGroup
        projectId="p-1" projectTitle="Zeka Küpü" rows={[row('KUTU', 'with_matbaa')]}
        onAct={() => {}} onActAll={() => {}} onNavigate={() => {}}
      />,
    )
    expect(buttonByText(/Hepsini/)).toBeFalsy()
    expect(buttonByText(/İşlemi Başlatın/)).toBeTruthy()
  })

  it('renders nothing at all when the project owes no parça', () => {
    render(
      <ParcaJobGroup projectId="p-1" projectTitle="Zeka Küpü" rows={[]}
        onAct={() => {}} onActAll={() => {}} onNavigate={() => {}} />,
    )
    expect(text()).not.toContain('Zeka Küpü')
  })
})
