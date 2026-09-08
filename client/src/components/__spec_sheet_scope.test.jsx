// A narrowed sheet, rendered (migration 074).
//
// Every per-parça button in the app opens the spec sheet first — the matbaa's
// "KUTU · İşlemi Başlatın", the leader's "KUTU · Onaylayın", the designer's
// "KUTU · Gönderin" — and the document then has to say what the button says.
// SpecFormDialog decides WHICH blocks that is (lib/spec-form-scope.js); these
// are the two rules the sheet itself has to hold once it has been told:
//
//   • it shows the parça blocks it was given, and no others;
//   • the parça picker goes away while it is narrowed — that control governs
//     the whole selection, so above a one-parça view it would tick three boxes
//     and contradict the document under it.
//
// Same no-react-testing-library approach as __parca_routing_ui.test.jsx.

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
const ALL = [comp('KİTAP'), comp('KUTU'), comp('KILAVUZ')]

function render(props) {
  act(() => {
    root.render(
      <SpecSheetBody
        variant={VARIANTS.demo}
        project={{ id: 'p1', title: 'Test Kitabı' }}
        user={{ id: 'u1', role: 'team_leader' }}
        form={{ isinAdi: 'Test Kitabı', demoIstemTarihi: '', demoIsteyenKisi: '' }}
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
  return container.textContent
}

describe('SpecSheetBody — a sheet narrowed to one parça', () => {
  it('shows every parça of the round when nothing narrows it', () => {
    const text = render({})
    expect(text).toContain('KİTAP')
    expect(text).toContain('KUTU')
    expect(text).toContain('KILAVUZ')
  })

  it('shows only the parça it was given', () => {
    const text = render({ selectedComponents: [comp('KUTU')], hideParcaPicker: true })
    expect(text).toContain('KUTU')
    expect(text).not.toContain('KİTAP')
    expect(text).not.toContain('KILAVUZ')
  })

  it('drops the parça picker while narrowed — it governs the whole selection', () => {
    expect(render({})).toContain('Parçalar (ürün bilgilerinden)')
    expect(render({ selectedComponents: [comp('KUTU')], hideParcaPicker: true }))
      .not.toContain('Parçalar (ürün bilgilerinden)')
  })

  it('keeps the picker on a full sheet the editor may still re-tick', () => {
    // hideParcaPicker is the dialog's narrowing flag, not a permission: an
    // un-narrowed sheet (including one the reader toggled back to "tümü")
    // keeps its picker.
    expect(render({ hideParcaPicker: false })).toContain('Parçalar (ürün bilgilerinden)')
  })
})
