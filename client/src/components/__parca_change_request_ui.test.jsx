// The per-parça change-request handshake, both sides of it (migration 077).
//
//   ParcaChangeRequestPanel — the leader's view of the sheet the matbaa holds:
//                             which parçalar are still theirs to edit, which
//                             are on the press, and the ask that is the only
//                             way to reach the latter.
//   ParcaJobCard            — the printer's answer. A pending ask replaces the
//                             work button rather than joining it, and a parça
//                             owing a correction offers no work at all.
//
// Same no-react-testing-library approach as __parca_routing_ui.test.jsx.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { MemoryRouter } from 'react-router-dom'

import ParcaChangeRequestPanel, { heldParcalar } from './ParcaChangeRequestPanel.jsx'
import ParcaJobCard from './ParcaJobCard.jsx'

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
function text() { return document.body.textContent ?? '' }
function buttons() { return Array.from(document.body.querySelectorAll('button')) }
function buttonByText(re) { return buttons().find((b) => re.test(b.textContent ?? '')) }
function click(el) {
  act(() => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
}

const held = (parca, over = {}) => ({
  parca, state: 'with_matbaa', owner_role: 'printer', gate: 'demo', attempt: 1,
  started_at: null, fix_pending: false, change_requested_at: null, ...over,
})
const onPress = (parca, over = {}) => held(parca, {
  state: 'in_round', started_at: '2026-09-01T10:00:00Z', ...over,
})

describe('ParcaChangeRequestPanel', () => {
  it('renders nothing when the matbaa holds no parça of this round', () => {
    render(
      <ParcaChangeRequestPanel
        rows={[held('KUTU', { state: 'approved', owner_role: null })]}
        canAct onRequestChange={() => {}}
      />,
    )
    expect(text()).toBe('')
  })

  // The regression the snapshotParcalar prop exists for: routing rows are
  // materialised on first action, so a round where the matbaa started KUTU and
  // touched nothing else has exactly ONE row — and a panel reading only rows
  // showed a one-parça sheet, hiding the two the leader could still edit.
  it('fills in the parçalar that have no routing row yet', () => {
    render(
      <ParcaChangeRequestPanel
        rows={[onPress('KUTU')]}
        snapshotParcalar={[{ component: 'KUTU' }, { component: 'KİTAP' }, { component: 'KILAVUZ' }]}
        canAct onRequestChange={() => {}}
      />,
    )
    expect(text()).toContain('KİTAP')
    expect(text()).toContain('KILAVUZ')
    expect(text()).toContain('henüz başlanmadı')
    // Still only the started one can be asked about.
    expect(buttons().filter((b) => /Değişiklik İste/.test(b.textContent ?? ''))).toHaveLength(1)
  })

  it('does not resurrect a parça that has already left the matbaa', () => {
    render(
      <ParcaChangeRequestPanel
        rows={[onPress('KUTU'), held('KİTAP', { state: 'pending', owner_role: null, delivered_at: 'x' })]}
        snapshotParcalar={['KUTU', 'KİTAP']}
        canAct onRequestChange={() => {}}
      />,
    )
    // KİTAP was delivered — it is not "waiting to be started", and listing it
    // as such would tell the leader they can still change something the matbaa
    // has already handed back.
    expect(text()).not.toContain('KİTAP')
  })

  it('stays quiet on a single-parça round the header already covers', () => {
    render(
      <ParcaChangeRequestPanel
        rows={[]} snapshotParcalar={['KUTU']} canAct onRequestChange={() => {}}
      />,
    )
    expect(text()).toBe('')
  })

  it('offers the ask only on the parça that is actually on the press', () => {
    render(
      <ParcaChangeRequestPanel
        rows={[onPress('KUTU'), held('KİTAP')]}
        canAct onRequestChange={() => {}}
      />,
    )
    // Both are listed — a leader looking at a locked KUTU needs to know
    // whether the rest of the sheet is locked too.
    expect(text()).toContain('KUTU')
    expect(text()).toContain('KİTAP')
    expect(buttons().filter((b) => /Değişiklik İste/.test(b.textContent ?? ''))).toHaveLength(1)
  })

  it('sends the parça and the note the leader typed', () => {
    const calls = []
    render(
      <ParcaChangeRequestPanel
        rows={[onPress('KUTU')]}
        canAct onRequestChange={(parca, note) => calls.push([parca, note])}
      />,
    )
    click(buttonByText(/Değişiklik İste/))
    const box = document.body.querySelector('textarea')
    expect(box).toBeTruthy()
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype, 'value',
      ).set
      setter.call(box, '  kapak rengi yanlış  ')
      box.dispatchEvent(new Event('input', { bubbles: true }))
    })
    click(buttonByText(/Talebi Gönderin/))
    expect(calls).toEqual([['KUTU', 'kapak rengi yanlış']])
  })

  it('shows a pending ask back to the leader, with no second ask on offer', () => {
    render(
      <ParcaChangeRequestPanel
        rows={[onPress('KUTU', {
          change_requested_at: '2026-09-02T09:00:00Z',
          change_requested_note: 'kapak rengi yanlış',
        })]}
        canAct onRequestChange={() => {}}
      />,
    )
    expect(text()).toContain('matbaanın yanıtı bekleniyor')
    // The note is read back: it may have been written days ago on another
    // device, and "waiting" means little without it.
    expect(text()).toContain('kapak rengi yanlış')
    expect(buttonByText(/Değişiklik İste/)).toBeUndefined()
  })

  it('tells the leader when an accepted request has left them owing a fix', () => {
    render(
      <ParcaChangeRequestPanel
        rows={[held('KUTU', { fix_pending: true })]}
        canAct onRequestChange={() => {}}
      />,
    )
    expect(text()).toContain('Talebiniz kabul edildi')
    expect(buttonByText(/Değişiklik İste/)).toBeUndefined()
  })

  // The row used to announce the debt and offer no way to pay it: the only
  // route was the header's whole-sheet button, which opens every parça and
  // says nothing about which one the matbaa is waiting on.
  it('offers the way to send that correction, naming the parça', () => {
    const calls = []
    render(
      <ParcaChangeRequestPanel
        rows={[held('KUTU', { fix_pending: true })]}
        canAct onRequestChange={() => {}}
        onSendFix={(parca, gate) => calls.push([parca, gate])}
      />,
    )
    const btn = buttonByText(/KUTU Formunu Düzenleyin/)
    expect(btn).toBeTruthy()
    click(btn)
    // The gate rides along so the caller opens the right sheet — a project can
    // carry both a demo and an ozalit round.
    expect(calls).toEqual([['KUTU', 'demo']])
  })

  it('offers it on the ozalit leg with that gate', () => {
    const calls = []
    render(
      <ParcaChangeRequestPanel
        rows={[held('KAPAK', { fix_pending: true, gate: 'ozalit' })]}
        canAct onRequestChange={() => {}}
        onSendFix={(parca, gate) => calls.push([parca, gate])}
      />,
    )
    click(buttonByText(/KAPAK Formunu Düzenleyin/))
    expect(calls).toEqual([['KAPAK', 'ozalit']])
  })

  it('does not offer it on a parça that owes nothing', () => {
    render(
      <ParcaChangeRequestPanel
        rows={[onPress('KUTU'), held('KİTAP')]}
        canAct onRequestChange={() => {}} onSendFix={() => {}}
      />,
    )
    expect(buttonByText(/Formunu Düzenleyin/)).toBeUndefined()
  })

  it('does not offer it to someone who may not act', () => {
    render(
      <ParcaChangeRequestPanel
        rows={[held('KUTU', { fix_pending: true })]}
        canAct={false} onRequestChange={() => {}} onSendFix={() => {}}
      />,
    )
    expect(buttonByText(/Formunu Düzenleyin/)).toBeUndefined()
  })

  it('shows the round read-only to someone who may not act', () => {
    render(
      <ParcaChangeRequestPanel rows={[onPress('KUTU')]} canAct={false} onRequestChange={() => {}} />,
    )
    expect(text()).toContain('KUTU')
    expect(buttonByText(/Değişiklik İste/)).toBeUndefined()
  })
})

// The synthesised half of the panel's list carries fields nothing renders, and
// `gate` is the one that matters: a project can carry both a demo and an ozalit
// round, and every caller that acts on a parça branches on it to decide which
// sheet to open. Left undefined, `gate === 'ozalit'` quietly takes the demo
// branch — the wrong sheet, on the leg where it is hardest to notice.
describe('heldParcalar — what the matbaa is holding', () => {
  it('stamps the round gate on parçalar that have no routing row', () => {
    const { held } = heldParcalar([], ['KUTU', 'KİTAP'], 'ozalit')
    expect(held.map((r) => r.gate)).toEqual(['ozalit', 'ozalit'])
  })

  it('does the same on the demo leg', () => {
    const { held } = heldParcalar([], ['KUTU', 'KİTAP'], 'demo')
    expect(held.every((r) => r.gate === 'demo')).toBe(true)
  })

  it('never leaves a synthesised row without one', () => {
    // The regression: an undefined gate is indistinguishable from 'demo' at
    // every `gate === 'ozalit'` branch downstream.
    const { held } = heldParcalar([onPress('KUTU')], ['KUTU', 'KİTAP'], 'ozalit')
    expect(held.every((r) => r.gate !== undefined)).toBe(true)
  })

  it('leaves a real row’s own gate alone', () => {
    // Routed rows come from the API with a gate already on them; the panel's
    // prop is a fallback for the rows that have none, not an override.
    const { held } = heldParcalar([onPress('KUTU', { gate: 'demo' })], ['KUTU'], 'ozalit')
    expect(held.find((r) => r.parca === 'KUTU').gate).toBe('demo')
  })

  it('reports the untouched half so a one-parça round can be told apart', () => {
    const { held, untouched } = heldParcalar([], ['KUTU'], 'demo')
    expect(held).toHaveLength(1)
    expect(untouched).toHaveLength(1)
  })
})

describe('ParcaJobCard answering a change request', () => {
  const asked = onPress('KUTU', {
    project_id: 'p-1',
    project_title: 'Zeka Küpü',
    change_requested_at: '2026-09-02T09:00:00Z',
    change_requested_by_name: 'Ayşenur',
    change_requested_note: 'kapak rengi yanlış',
  })

  it('shows the ask in the leader’s own words', () => {
    render(<ParcaJobCard row={asked} onAct={() => {}} onRespondChange={() => {}} onNavigate={() => {}} />)
    expect(text()).toContain('Ayşenur')
    expect(text()).toContain('kapak rengi yanlış')
  })

  it('replaces the work button with the two answers', () => {
    render(<ParcaJobCard row={asked} onAct={() => {}} onRespondChange={() => {}} onNavigate={() => {}} />)
    expect(buttonByText(/Kabul Edin/)).toBeTruthy()
    expect(buttonByText(/Reddedin/)).toBeTruthy()
    // Both at once would let the printer deliver the parça in the same breath
    // as agreeing to stop working on it.
    expect(buttonByText(/Teslim Edin/)).toBeUndefined()
  })

  it('reports which answer was given', () => {
    const calls = []
    render(
      <ParcaJobCard row={asked} onAct={() => {}} onNavigate={() => {}}
        onRespondChange={(row, answer) => calls.push([row.parca, answer])} />,
    )
    click(buttonByText(/Kabul Edin/))
    click(buttonByText(/Reddedin/))
    expect(calls).toEqual([['KUTU', 'accept'], ['KUTU', 'decline']])
  })

  it('offers no work on a parça that owes a correction', () => {
    // startParca refuses this outright — an enabled button would be a 400
    // dressed as work.
    const owing = held('KUTU', { project_id: 'p-1', project_title: 'Zeka Küpü', fix_pending: true })
    render(<ParcaJobCard row={owing} onAct={() => {}} onRespondChange={() => {}} onNavigate={() => {}} />)
    expect(text()).toContain('Düzeltilmiş form bekleniyor')
    expect(buttonByText(/Düzeltme Bekleniyor/)?.disabled).toBe(true)
    expect(buttonByText(/İşlemi Başlatın/)).toBeUndefined()
  })

  it('is unchanged on an ordinary parça', () => {
    const plain = onPress('KUTU', { project_id: 'p-1', project_title: 'Zeka Küpü' })
    render(<ParcaJobCard row={plain} onAct={() => {}} onRespondChange={() => {}} onNavigate={() => {}} />)
    expect(buttonByText(/Teslim Edin/)).toBeTruthy()
    expect(buttonByText(/Kabul Edin/)).toBeUndefined()
  })
})
