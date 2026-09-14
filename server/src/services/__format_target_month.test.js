import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { formatTargetMonthTr } from './project-service/admin.js'

describe('formatTargetMonthTr', () => {
  it('prints a 1st-of-month DATE as month + year', () => {
    assert.equal(formatTargetMonthTr('2026-11-01'), 'Kasım 2026')
  })

  it('prints a mid-month DATE with the day', () => {
    assert.equal(formatTargetMonthTr('2026-11-15'), '15 Kasım 2026')
  })

  it('does not shift a Turkey-local midnight Date back a day', () => {
    assert.equal(
      formatTargetMonthTr(new Date('2026-11-01T00:00:00+03:00')),
      'Kasım 2026',
    )
  })

  it('keeps a UTC-midnight Date on the stored calendar day', () => {
    assert.equal(formatTargetMonthTr(new Date('2026-11-01T00:00:00.000Z')), 'Kasım 2026')
  })
})
