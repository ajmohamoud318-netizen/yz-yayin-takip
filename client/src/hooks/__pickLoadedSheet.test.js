/**
 * `pickLoadedSheet` — which copy of a spec sheet a load opens on.
 *
 * The regression: the matbaa's "İşlemi Başlatın" viewer (mode='view') read
 * this browser's localStorage blob before the round's server snapshot, and the
 * matbaa's browser keeps the sheet of the last round THEY delivered. A new
 * round therefore opened on the old spec instead of the one just requested.
 *
 * The hook itself is heavy (api, snapshot fetch, localStorage), so the rule is
 * exercised here in isolation — same approach as __narrowToApproved.test.js.
 */

import { describe, it, expect } from 'vitest'

import { pickLoadedSheet } from './useSpecSheet.js'

const sheet = (isinAdi, stamps = {}) => ({
  form: { isinAdi, ...stamps },
  customRows: [],
  selectedComponents: [{ id: isinAdi, component: isinAdi, rows: [] }],
})

// What the round was sent with — the server's attempt-scoped snapshot.
const requested = sheet('2. tur KUTU')
// What this browser saved last: the round the matbaa delivered before.
const lastDelivered = sheet('1. tur KUTU', { teslimEdenKisi: 'Matbaa', matbaaYetkilisi: 'Matbaa' })

describe('pickLoadedSheet', () => {
  it('opens a read-only viewer on the requested round, not the browser copy', () => {
    const picked = pickLoadedSheet({
      mode: 'view', notifyOnSave: false, readOnly: true, current: requested, carried: lastDelivered,
    })
    expect(picked).toBe(requested)
  })

  it("keeps an editor's plain viewer on their personal draft, stamps stripped", () => {
    const picked = pickLoadedSheet({
      mode: 'view', notifyOnSave: false, readOnly: false, current: requested, carried: lastDelivered,
    })
    expect(picked.form.isinAdi).toBe('1. tur KUTU')
    expect(picked.form.teslimEdenKisi).toBeUndefined()
  })

  it('falls back to the carried copy, stamps stripped, when the round has no snapshot', () => {
    const picked = pickLoadedSheet({
      mode: 'view', notifyOnSave: false, readOnly: true, current: null, carried: lastDelivered,
    })
    expect(picked.form.isinAdi).toBe('1. tur KUTU')
    expect(picked.form.matbaaYetkilisi).toBeUndefined()
  })

  it('lets the round win on every path that is not an editable plain viewer', () => {
    for (const flags of [
      { mode: 'advance', notifyOnSave: false, readOnly: true },
      { mode: 'advance', notifyOnSave: false, readOnly: false },
      { mode: 'view', notifyOnSave: true, readOnly: false },
      { mode: 'approve', notifyOnSave: false, readOnly: true },
    ]) {
      expect(pickLoadedSheet({ ...flags, current: requested, carried: lastDelivered })).toBe(requested)
    }
  })

  it('returns null when neither copy exists', () => {
    expect(pickLoadedSheet({ mode: 'view', readOnly: true, current: null, carried: null })).toBeNull()
    expect(pickLoadedSheet({ mode: 'view', readOnly: false, current: null, carried: null })).toBeNull()
  })
})
