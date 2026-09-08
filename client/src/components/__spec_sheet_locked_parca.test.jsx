// A sheet with one parça already on the press (migration 077).
//
// The leader's "Gönderilen Demoyu Düzenleyin" rewrites the very document the
// matbaa is working from. Once they have started a parça, that parça is no
// longer the leader's to change silently — but the REST of the round still is,
// and the first cut of this guard refused the whole sheet, which took away a
// free edit they were entitled to on every parça nobody had touched.
//
// So the lock is per block: KUTU greys out, KİTAP stays live. The server
// refuses exactly the same set (computeDemoEdit + domain/spec-parca-diff.js),
// so a stale tab cannot get past it either.
//
// Same no-react-testing-library approach as __spec_sheet_no_parca.test.jsx.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'

import SpecSheetBody from './SpecSheetBody.jsx'
import { VARIANTS } from '@/lib/spec-form-variants'

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

const comp = (component) => ({
  id: component,
  component,
  rows: [{ id: `${component}-1`, label: 'KAĞIT', value: '80 gr' }],
})
const ALL = [comp('KİTAP'), comp('KUTU')]

function render(props) {
  act(() => {
    root.render(
      <SpecSheetBody
        variant={VARIANTS.demo}
        project={{ id: 'p1', title: 'Test Kitabı' }}
        user={{ id: 'u1', role: 'team_leader' }}
        form={{ isinAdi: 'Test Kitabı', demoIstemTarihi: '8 Eylül 2026', demoIsteyenKisi: 'Ayşenur' }}
        onChange={() => {}}
        readOnly={false}
        systemRowReadOnly
        shownAttemptNo={1}
        customRows={[]}
        onAddCustomRow={() => {}}
        onUpdateCustomRow={() => {}}
        onRemoveCustomRow={() => {}}
        onMoveCustomRow={() => {}}
        catalogComponents={ALL}
        selectedComponents={ALL}
        onToggleComponent={() => {}}
        onSelectAllComponents={() => {}}
        onClearComponents={() => {}}
        onAddComponentRow={() => {}}
        onUpdateComponentRow={() => {}}
        onRemoveComponentRow={() => {}}
        onMoveComponentRow={() => {}}
        {...props}
      />,
    )
  })
  return container
}

/** Editable value inputs, by the parça card they sit in. */
function inputsPerCard(el) {
  // Each parça renders one card; the last block in it holds the spec rows.
  return Array.from(el.querySelectorAll('[data-print-page], .rounded-lg.border.bg-white'))
    .map((card) => Array.from(card.querySelectorAll('input, textarea')))
}

describe('SpecSheetBody — a parça the matbaa has started', () => {
  it('leaves every block editable when nothing is locked', () => {
    const el = render({ lockedParcalar: [] })
    const editable = Array.from(el.querySelectorAll('input, textarea'))
      .filter((i) => !i.readOnly && !i.disabled)
    expect(editable.length).toBeGreaterThan(0)
    expect(el.textContent).not.toContain('baskısına başladı')
  })

  it('says why the locked block is inert', () => {
    const el = render({ lockedParcalar: ['KUTU'] })
    expect(el.textContent).toContain('Matbaa bu parçanın baskısına başladı')
    // …and that the rest of the sheet is still theirs, which is the whole
    // difference from the all-or-nothing version.
    expect(el.textContent).toContain('Diğer parçaları düzenlemeye devam edebilirsiniz')
  })

  it('offers no "Satır Ekleyin" on the locked parça but keeps it on the others', () => {
    const before = render({ lockedParcalar: [] }).querySelectorAll('button').length
    const after = render({ lockedParcalar: ['KUTU'] }).querySelectorAll('button').length
    // The locked card loses its add-row control; the unlocked one keeps its own.
    expect(after).toBeLessThan(before)
    expect(after).toBeGreaterThan(0)
  })

  it('matches the parça name the Turkish way', () => {
    // 'i'/'İ' and 'ı'/'I' fold the other way round than in en-US — a KİTAP
    // that came back from the queue lower-cased must still find its block.
    const el = render({ lockedParcalar: ['kitap'] })
    expect(el.textContent).toContain('Matbaa bu parçanın baskısına başladı')
  })

  it('locks nothing when the name matches no block on the sheet', () => {
    // A parça renamed in Ürün Bilgileri since the round went out. Greying the
    // whole sheet on a stale name would be worse than greying none of it —
    // the server still refuses a save that touches the real locked parça.
    const el = render({ lockedParcalar: ['KAPAK'] })
    expect(el.textContent).not.toContain('baskısına başladı')
  })
})
