// SpecFormFooter while the sheet is still loading.
//
// The dialog hides the sheet behind a placeholder until its load finishes
// (useSpecSheet → sheetReady): before that, the state is the previous sheet or
// the blank catalog template, and flashing it was the "glimpse of the wrong
// form". The footer stays on screen through the load, so it has to wait too —
// "İşlemi Başlatın" exists to be pressed AFTER reading the sheet, and a send
// or an approve pressed early would act on a document nobody has seen.
//
// Same no-react-testing-library approach as __parca_change_request_ui.test.jsx.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'

import SpecFormFooter from './SpecFormFooter.jsx'
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

const printer = { id: 'u-mat', name: 'yukselen zeka', role: 'printer' }
const leader = { id: 'u-lead', name: 'Aylin Ulu', role: 'team_leader' }

function render(over = {}) {
  act(() => {
    root.render(
      <SpecFormFooter
        variant={VARIANTS.demo}
        user={printer}
        order={null}
        mode="view"
        busy={false}
        readOnly
        printable
        missingRequired={[]}
        incompleteSpec={[]}
        noParcaSelected={false}
        onClose={() => {}}
        onPrint={() => {}}
        onSave={() => {}}
        notifyEdit={null}
        noChangesToSend={false}
        onStartWork={() => {}}
        startingWork={false}
        onAdvance={() => {}}
        onApprove={() => {}}
        {...over}
      />,
    )
  })
}
const button = (label) => Array.from(container.querySelectorAll('button'))
  .find((b) => (b.textContent ?? '').trim() === label)

describe('SpecFormFooter — while the sheet loads', () => {
  it('holds "İşlemi Başlatın" without claiming anything is in flight', () => {
    render({ loading: true })

    expect(button('İşlemi Başlatın')?.disabled).toBe(true)
    // Not "İşleniyor…": nothing has been pressed.
    expect(button('İşleniyor…')).toBeUndefined()
    expect(button('Yazdırın')?.disabled).toBe(true)
    // Closing is always allowed.
    expect(button('Kapatın')?.disabled).toBe(false)
  })

  it('releases it once the sheet is on screen', () => {
    render({ loading: false })

    expect(button('İşlemi Başlatın')?.disabled).toBe(false)
    expect(button('Yazdırın')?.disabled).toBe(false)
  })

  it('holds a send, with its own label rather than "Gönderiliyor…"', () => {
    render({ loading: true, user: leader, mode: 'advance', readOnly: false, onStartWork: undefined })

    expect(button('Demo İsteyin')?.disabled).toBe(true)
    expect(button('Gönderiliyor…')).toBeUndefined()
  })

  it('holds an approve', () => {
    render({ loading: true, user: leader, mode: 'approve', onStartWork: undefined })

    expect(button('Onaylayın')?.disabled).toBe(true)
  })
})
