/**
 * The app-wide rule: a spec sheet sent for approval is a RECORD, not a draft.
 *
 * Wherever the app asks someone to decide on a sheet — the leader's
 * "KUTU · Onaylayın", the leader's "KUTU · Reddedin", the designer's
 * "KUTU · Gönderin" — the document on screen is the one that was produced
 * against and is now being signed. It opens locked:
 *
 *   • an edit under Onaylayın rewrites the record of what was actually
 *     printed, silently: the approve advances the round past every path that
 *     tells the matbaa a sheet changed;
 *   • an edit under Reddedin sends the matbaa a different file than the one
 *     they worked from, under a reason written about the old one.
 *
 * `VARIANTS.ozalit` states this for `mode='approve'` and `isRejectToMatbaaReview`
 * for the reject-to-matbaa handoff — but the per-parça decisions open at
 * `mode='view'` (they reuse the footer slot the matbaa's "İşlemi Başlatın"
 * uses), so no role/mode table can see them. The caller passes the decision
 * instead; `isDecisionReview` turns it into the lock.
 *
 * Two halves have to hold together, so both are tested here:
 *   1. the sheet renders as a document — no inputs, no add/remove row;
 *   2. the footer drops "Taslağı Kaydedin" with it (VARIANTS.demo sets
 *      saveRequiresEditable false, which would otherwise leave a save button
 *      under a form nobody may type into) while keeping the decision button.
 *
 * Same no-react-testing-library approach as __spec_sheet_scope.test.jsx.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'

import SpecFormFooter from './SpecFormFooter.jsx'
import SpecSheetBody from './SpecSheetBody.jsx'
import { VARIANTS, isDecisionReview } from '@/lib/spec-form-variants'
import { decisionScopeCopy } from '@/lib/spec-form-scope'

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

const leader = { id: 'u-lead', role: 'team_leader' }

describe('isDecisionReview — the sheet was opened to be decided on', () => {
  it('is false for a sheet opened to be authored or merely read', () => {
    expect(isDecisionReview(null)).toBe(false)
    expect(isDecisionReview(undefined)).toBe(false)
    // A cleared decision must not keep the lock on by accident.
    expect(isDecisionReview({})).toBe(false)
  })

  it('is true for every per-parça decision the app offers', () => {
    expect(isDecisionReview({ action: 'approve', parcalar: ['KUTU'] })).toBe(true)
    expect(isDecisionReview({ action: 'reject', parcalar: ['KUTU'] })).toBe(true)
    expect(isDecisionReview({ action: 'review', parcalar: ['KUTU'] })).toBe(true)
  })

  // Regression — the bug this rule exists to fix. The demo variant's pure
  // rule leaves the sheet editable for a leader at mode='view' (that is the
  // ordinary viewer, and the sanctioned "Gönderilen Demoyu Düzenleyin" path
  // rides on it), so the Onaylayın / Reddedin sheets arrived with live
  // inputs, a "+ Satır Ekleyin" and per-row delete buttons on the document
  // the leader was about to sign.
  it('locks a sheet the variant table would leave editable', () => {
    expect(VARIANTS.demo.isReadOnly({ mode: 'view', user: leader })).toBe(false)
    expect(isDecisionReview({ action: 'approve', parcalar: ['KUTU'] })).toBe(true)
  })
})

const comp = (component) => ({
  id: component,
  component,
  rows: [{ id: `${component}-1`, label: 'KUTU AÇIK EBAT', value: '20x30' }],
})

function renderSheet(props) {
  act(() => {
    root.render(
      <SpecSheetBody
        variant={VARIANTS.demo}
        project={{ id: 'p1', title: 'X KUTU' }}
        user={leader}
        form={{ isinAdi: 'X KUTU', demoIstemTarihi: '8 Eylül 2026', demoIsteyenKisi: 'Ayşenur Kanak' }}
        onChange={() => {}}
        readOnly={false}
        systemRowReadOnly
        shownAttemptNo={1}
        customRows={[]}
        onAddCustomRow={() => {}}
        onUpdateCustomRow={() => {}}
        onRemoveCustomRow={() => {}}
        onMoveCustomRow={() => {}}
        catalogComponents={[comp('KUTU')]}
        selectedComponents={[comp('KUTU')]}
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

describe('the sheet under a decision renders as a document', () => {
  it('has live inputs while it is being authored (the control case)', () => {
    const el = renderSheet({ readOnly: false })
    expect(el.querySelectorAll('input, textarea').length).toBeGreaterThan(0)
    expect(el.textContent).toContain('Satır Ekleyin')
  })

  it('has no input, no add-row and no per-row controls once locked', () => {
    const el = renderSheet({ readOnly: true })
    expect(el.querySelectorAll('input, textarea').length).toBe(0)
    expect(el.textContent).not.toContain('Satır Ekleyin')
    // The values are still on screen — it is a document, not a blank.
    expect(el.textContent).toContain('20x30')
    expect(el.textContent).toContain('KUTU')
  })
})

function renderFooter(props) {
  act(() => {
    root.render(
      <SpecFormFooter
        variant={VARIANTS.demo}
        user={leader}
        order={null}
        mode="view"
        busy={false}
        readOnly
        printable={false}
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
        startWorkLabel="KUTU · Onaylayın"
        {...props}
      />,
    )
  })
  return [...container.querySelectorAll('button')].map((b) => b.textContent)
}

describe('the footer under a decision', () => {
  // VARIANTS.demo.saveRequiresEditable is false, so a locked demo sheet keeps
  // its save button — harmless on the ordinary viewer, a lie under a decision.
  it('offers "Taslağı Kaydedin" on an ordinary locked viewer', () => {
    const labels = renderFooter({ decisionReview: false, startWorkLabel: null })
    expect(labels.some((l) => l.includes('Taslağı Kaydedin'))).toBe(true)
  })

  it('drops the draft save but keeps the decision button', () => {
    const labels = renderFooter({ decisionReview: true })
    expect(labels.some((l) => l.includes('Taslağı Kaydedin'))).toBe(false)
    expect(labels.some((l) => l.includes('KUTU · Onaylayın'))).toBe(true)
    // …and the way out still says what it is: nothing here can be cancelled.
    expect(labels.some((l) => l.includes('Kapatın'))).toBe(true)
  })

  it('keeps a reject decision button too', () => {
    const labels = renderFooter({ decisionReview: true, startWorkLabel: 'KUTU · Reddedin' })
    expect(labels.some((l) => l.includes('Taslağı Kaydedin'))).toBe(false)
    expect(labels.some((l) => l.includes('KUTU · Reddedin'))).toBe(true)
  })
})

/**
 * The second half of the rule: a sheet that has been WIDENED past the decision
 * must keep saying what the decision covers.
 *
 * The banner offers "Tüm parçaları gösterin" and reading the round before
 * signing one parça is legitimate — but once taken, the sheet shows blocks the
 * footer button does not cover, and on a phone that button is several screens
 * below them. The action never widens with the view (commitParcaSheet posts
 * the parçalar the row's button was clicked for), so this is about leaving
 * nothing for the reader to remember, not about a hole in the commit path.
 */
describe('decisionScopeCopy', () => {
  it('is null for every non-decision opening of the sheet', () => {
    expect(decisionScopeCopy(null)).toBe(null)
    expect(decisionScopeCopy(undefined)).toBe(null)
    expect(decisionScopeCopy({})).toBe(null)
  })

  it('names what will happen, per decision', () => {
    expect(decisionScopeCopy({ action: 'approve' }).verb).toBe('onaylanacak')
    expect(decisionScopeCopy({ action: 'reject' }).verb).toBe('reddedilecek')
    expect(decisionScopeCopy({ action: 'review' }).verb).toBe('gönderilecek')
  })

  it('gives both sides of the marking, so no block is left unlabelled', () => {
    for (const action of ['approve', 'reject', 'review']) {
      const copy = decisionScopeCopy({ action })
      expect(copy.inScope).toBeTruthy()
      expect(copy.outScope).toBeTruthy()
      expect(copy.inScope).not.toBe(copy.outScope)
    }
  })
})

const APPROVE = decisionScopeCopy({ action: 'approve' })

describe('a widened decision sheet marks every block', () => {
  it('says nothing while the sheet is still narrowed to the decision', () => {
    // Every block on screen IS the decision; the strips would be noise.
    const el = renderSheet({
      readOnly: true,
      selectedComponents: [comp('KUTU')],
      decisionParcalar: ['KUTU'],
      decisionNotes: APPROVE,
    })
    expect(el.textContent).not.toContain(APPROVE.inScope)
    expect(el.textContent).not.toContain(APPROVE.outScope)
  })

  it('marks the decided block and the context blocks once widened', () => {
    const el = renderSheet({
      readOnly: true,
      catalogComponents: [comp('KİTAP'), comp('KUTU'), comp('KILAVUZ')],
      selectedComponents: [comp('KİTAP'), comp('KUTU'), comp('KILAVUZ')],
      decisionParcalar: ['KUTU'],
      decisionNotes: APPROVE,
    })
    expect(el.textContent).toContain(APPROVE.inScope)
    expect(el.textContent).toContain(APPROVE.outScope)
    // One block is being decided; the other two are context.
    expect([...el.querySelectorAll('p')].filter((n) => n.textContent === APPROVE.inScope).length).toBe(1)
    expect([...el.querySelectorAll('p')].filter((n) => n.textContent === APPROVE.outScope).length).toBe(2)
  })

  it('matches parça names the way the rest of the app does (Turkish fold)', () => {
    // A KILAVUZ that came back from the queue as "Kılavuz" must still find its
    // block — the same reason scopeComponents and the locked-parça set fold.
    const el = renderSheet({
      readOnly: true,
      catalogComponents: [comp('KİTAP'), comp('KILAVUZ')],
      selectedComponents: [comp('KİTAP'), comp('KILAVUZ')],
      decisionParcalar: ['Kılavuz'],
      decisionNotes: APPROVE,
    })
    expect([...el.querySelectorAll('p')].filter((n) => n.textContent === APPROVE.inScope).length).toBe(1)
  })

  it('marks nothing on a bulk decision — the scope is the whole sheet', () => {
    const el = renderSheet({
      readOnly: true,
      catalogComponents: [comp('KİTAP'), comp('KUTU')],
      selectedComponents: [comp('KİTAP'), comp('KUTU')],
      decisionParcalar: ['KİTAP', 'KUTU'],
      decisionNotes: APPROVE,
    })
    expect(el.textContent).not.toContain(APPROVE.outScope)
    expect(el.textContent).not.toContain(APPROVE.inScope)
  })
})
