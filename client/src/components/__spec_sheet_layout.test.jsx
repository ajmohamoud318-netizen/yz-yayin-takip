// How the parça blocks are laid out on screen.
//
// One rule, and it is about reading a form rather than about CSS: a pair of
// parçalar sits side by side (the count is then simply visible, and each card
// still has the width for "SETTEKİ KİTAP SAYISI" on one line), and a round of
// three or more runs down the sheet instead. This dialog is max-w-2xl, so a
// third column would leave each card near 200px — and wrapping the third card
// under the first two reads as an afterthought of the pair, when the three are
// equals.
//
// The "Parça n/N" pill follows the same line: it is the counter for a stacked
// sheet, so it appears at every width once the cards stack, and stays a
// phone-only badge while they are side by side.
//
// Same no-react-testing-library approach as __spec_sheet_scope.test.jsx.

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

function render(selectedComponents) {
  act(() => {
    root.render(
      <SpecSheetBody
        variant={VARIANTS.demo}
        project={{ id: 'p1', title: 'Test Kitabı' }}
        user={{ id: 'u1', role: 'printer' }}
        form={{ isinAdi: 'Test Kitabı', demoIstemTarihi: '', demoIsteyenKisi: '' }}
        onChange={() => {}}
        readOnly
        systemRowReadOnly
        shownAttemptNo={1}
        customRows={[]}
        onAddCustomRow={() => {}}
        onUpdateCustomRow={() => {}}
        onRemoveCustomRow={() => {}}
        onMoveCustomRow={() => {}}
        catalogComponents={selectedComponents}
        selectedComponents={selectedComponents}
        onToggleComponent={() => {}}
        onSelectAllComponents={() => {}}
        onClearComponents={() => {}}
        onAddComponentRow={() => {}}
        onUpdateComponentRow={() => {}}
        onRemoveComponentRow={() => {}}
        onMoveComponentRow={() => {}}
      />,
    )
  })
  return container
}

// The one grid on the sheet is the parça grid.
const parcaGrid = (el) => el.querySelector('div.grid.grid-cols-1')
const parcaBadges = (el) =>
  [...el.querySelectorAll('span')].filter((s) => /^Parça \d+\/\d+$/.test(s.textContent))

describe('SpecSheetBody — parça card layout', () => {
  it('puts two parçalar side by side', () => {
    expect(parcaGrid(render([comp('KİTAP'), comp('KUTU')])).className).toContain('sm:grid-cols-2')
  })

  it('stacks three or more, so no card is a leftover of the row above', () => {
    const grid = parcaGrid(render([comp('KİTAP'), comp('KUTU'), comp('KILAVUZ')]))
    expect(grid.className).not.toContain('sm:grid-cols-2')
    expect(grid.className).toContain('grid-cols-1')
  })

  it('keeps the "Parça n/N" counter at every width once the cards stack', () => {
    const badges = parcaBadges(render([comp('KİTAP'), comp('KUTU'), comp('KILAVUZ')]))
    expect(badges.map((b) => b.textContent)).toEqual(['Parça 1/3', 'Parça 2/3', 'Parça 3/3'])
    badges.forEach((b) => expect(b.className).not.toContain('sm:hidden'))
  })

  it('keeps it phone-only while the pair is side by side', () => {
    const badges = parcaBadges(render([comp('KİTAP'), comp('KUTU')]))
    expect(badges).toHaveLength(2)
    badges.forEach((b) => expect(b.className).toContain('sm:hidden'))
  })

  it('has no counter on a lone parça — nothing to count', () => {
    expect(parcaBadges(render([comp('KİTAP')]))).toHaveLength(0)
  })
})
