import {
  PASS_KIND,
  PASS_KIND_LABEL,
  isPassKind,
  defaultPassKindFor,
} from './passes.js'

describe('PASS_KIND', () => {
  it('freezes the enum (values are stable)', () => {
    expect(PASS_KIND.FIRST_EDITION).toBe('first_edition')
    expect(PASS_KIND.REPRINT).toBe('reprint')
    expect(PASS_KIND.REDESIGN).toBe('redesign')
  })
  it('has a label for every kind', () => {
    for (const k of Object.values(PASS_KIND)) {
      expect(PASS_KIND_LABEL[k]).toBeTruthy()
    }
  })
})

describe('isPassKind', () => {
  it('accepts every defined kind', () => {
    for (const k of Object.values(PASS_KIND)) expect(isPassKind(k)).toBe(true)
  })
  it('rejects unknown values', () => {
    expect(isPassKind('unknown')).toBe(false)
    expect(isPassKind(null)).toBe(false)
    expect(isPassKind(undefined)).toBe(false)
    expect(isPassKind(42)).toBe(false)
  })
})

describe('defaultPassKindFor', () => {
  it('pass 1 is first_edition', () => {
    expect(defaultPassKindFor(1)).toBe(PASS_KIND.FIRST_EDITION)
  })
  it('pass 2+ defaults to reprint', () => {
    expect(defaultPassKindFor(2)).toBe(PASS_KIND.REPRINT)
    expect(defaultPassKindFor(7)).toBe(PASS_KIND.REPRINT)
  })
  it('treats missing/0 as pass 1', () => {
    expect(defaultPassKindFor(undefined)).toBe(PASS_KIND.FIRST_EDITION)
    expect(defaultPassKindFor(null)).toBe(PASS_KIND.FIRST_EDITION)
    expect(defaultPassKindFor(0)).toBe(PASS_KIND.FIRST_EDITION)
  })
})
