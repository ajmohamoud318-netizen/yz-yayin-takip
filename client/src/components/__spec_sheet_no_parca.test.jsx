// A sheet whose parça picker has nothing ticked.
//
// With Ürün Bilgileri on the project, the parçalar ARE the form: ticking one
// box replaces the İŞİN ADI + custom-rows body with the parça blocks. Leaving
// that body on screen while every box was unticked offered a second, phantom
// way to spec the product — a full form (job name, "Satır Ekleyin", künye)
// that no send gate would ever let through. So the sheet waits for the pick.
//
// The fallback body itself is NOT gone: a product with no Ürün Bilgileri has
// no picker and no parçalar, and its custom rows are the whole spec.
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
  return container.textContent
}

describe('SpecSheetBody — nothing ticked in the parça picker', () => {
  it('shows no form body at all, just the picker and why', () => {
    const text = render({ selectedComponents: [] })
    expect(text).toContain('Parçalar (ürün bilgilerinden)')
    expect(text).toContain('Önce parça seçin')
    // The body it replaces: the job name row, the add-row control, the künye.
    expect(text).not.toContain('İŞİN ADI')
    expect(text).not.toContain('Satır Ekleyin')
    expect(text).not.toContain('DEMO İSTEM TARİHİ')
  })

  it('brings the whole sheet back the moment one parça is ticked', () => {
    const text = render({ selectedComponents: [comp('KUTU')] })
    expect(text).not.toContain('Önce parça seçin')
    expect(text).toContain('KUTU')
    expect(text).toContain('DEMO İSTEM TARİHİ')
  })

  it('keeps the custom-row body for a product with no Ürün Bilgileri', () => {
    // No catalog, so no picker and nothing to pick: these rows are the spec.
    const text = render({
      catalogComponents: [],
      selectedComponents: [],
      customRows: [{ id: 'r1', label: 'SAYFA SAYISI', value: '128' }],
    })
    expect(text).not.toContain('Önce parça seçin')
    expect(text).toContain('İŞİN ADI')
    expect(text).toContain('SAYFA SAYISI')
  })

  it('keeps the custom-row body on a read-only sheet that carries one', () => {
    // A snapshot saved before the project had parçalar, reopened by the matbaa
    // or from Geçmiş: there is no picker to answer, so hiding what the sheet
    // actually says would leave the reader an empty document.
    const text = render({
      readOnly: true,
      selectedComponents: [],
      customRows: [{ id: 'r1', label: 'CİLT', value: 'Amerikan' }],
    })
    expect(text).not.toContain('Önce parça seçin')
    expect(text).toContain('CİLT')
  })
})
