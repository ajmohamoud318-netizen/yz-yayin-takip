/**
 * Tests for the duplicate-title rule.
 *
 * Two live projects may not share a title (migration 063 + the checks in
 * project-service/admin.js). These lock in what "share a title" means, so
 * the JS guard and the SQL index can't drift into disagreeing about which
 * pairs are the same book.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  normaliseProjectTitle,
  isTitleConflictError,
  titleConflictMessage,
  TITLE_UNIQUE_INDEX,
} from './project-title.js'

const same = (a, b) => normaliseProjectTitle(a) === normaliseProjectTitle(b)

describe('normaliseProjectTitle', () => {
  it('ignores surrounding and repeated whitespace', () => {
    assert.ok(same('  Deneme   Kitap ', 'Deneme Kitap'))
    assert.ok(same('Deneme\tKitap', 'Deneme Kitap'))
    assert.ok(same('Deneme\n\nKitap', 'Deneme Kitap'))
  })

  it('ignores case', () => {
    assert.ok(same('MATEMATİK 5', 'matematik 5'))
  })

  it('folds case in the Turkish locale', () => {
    // To a Turkish reader these are one book, and only tr-TR lowercasing
    // agrees — the default locale leaves IŞIK as "işik".
    assert.ok(same('IŞIK Serisi', 'ışık serisi'))
    assert.ok(same('İLK Adım', 'ilk adım'))
  })

  it('folds all four Turkish i forms onto one key', () => {
    // The caps form of a title only carries the dotted İ when it was typed
    // on a Turkish layout. A phone set to English, or a paste out of Excel,
    // gives the ASCII I — and this team is almost all phones, so that is
    // how a double entry actually arrives.
    assert.ok(same('Matematik 5', 'MATEMATIK 5'))
    assert.ok(same('Fen Bilimleri', 'FEN BILIMLERI'))
    assert.ok(same('kitap', 'KITAP'))
    assert.ok(same('İlk Adım', 'Ilk Adım'))
    assert.equal(normaliseProjectTitle('IİıiI'), 'iiiii')
  })

  it('accepts that ı/i-only pairs can no longer coexist', () => {
    // Deliberate trade, documented in project-title.js: real Turkish words
    // differ this way, but a book catalog colliding on one is far rarer
    // than someone typing the caps title without a Turkish keyboard.
    assert.ok(same('Ilık', 'İlik'))
  })

  it('composes decomposed input before comparing', () => {
    // "ü" pasted as u + combining diaeresis must not read as a new title.
    assert.ok(same('Türkçe', 'Tu\u0308rkçe'))
  })

  it('keeps genuinely different titles apart', () => {
    assert.ok(!same('Matematik 5', 'Matematik 6'))
    assert.ok(!same('Fen Bilimleri', 'Fen Bilgisi'))
  })

  it('treats blank-ish input as one empty key', () => {
    // Callers short-circuit on the empty key rather than matching every
    // untitled row against every other; the schema already rejects ''.
    assert.equal(normaliseProjectTitle('   '), '')
    assert.equal(normaliseProjectTitle(null), '')
    assert.equal(normaliseProjectTitle(undefined), '')
  })
})

describe('isTitleConflictError', () => {
  it('recognises the unique index firing', () => {
    assert.ok(isTitleConflictError({ code: '23505', constraint: TITLE_UNIQUE_INDEX }))
  })

  it('ignores a unique violation on some other constraint', () => {
    // A future unique index on projects must not be reported as a
    // duplicate *title* — that would put a misleading 409 on the screen.
    assert.ok(!isTitleConflictError({ code: '23505', constraint: 'projects_pkey' }))
  })

  it('ignores non-unique-violation errors and non-errors', () => {
    assert.ok(!isTitleConflictError({ code: '23503', constraint: TITLE_UNIQUE_INDEX }))
    assert.ok(!isTitleConflictError(new Error('boom')))
    assert.ok(!isTitleConflictError(null))
    assert.ok(!isTitleConflictError(undefined))
  })
})

describe('titleConflictMessage', () => {
  it('quotes the stored title and names the stage when known', () => {
    const msg = titleConflictMessage('Matematik 5', 'Ozalit Onay')
    assert.match(msg, /"Matematik 5"/)
    assert.match(msg, /Ozalit Onay/)
  })

  it('omits the stage clause when there is none', () => {
    const msg = titleConflictMessage('Matematik 5')
    assert.match(msg, /"Matematik 5"/)
    assert.ok(!msg.includes('()'))
  })

  it('stays readable when the clashing title is unknown', () => {
    // The race path only knows the title the caller was handed, which for a
    // patch that never touched `title` is undefined. Must not render '""'.
    const msg = titleConflictMessage(undefined)
    assert.ok(!msg.includes('""'), msg)
    assert.match(msg, /zaten var/)
  })
})
