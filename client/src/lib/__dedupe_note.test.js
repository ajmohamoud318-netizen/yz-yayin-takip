import { describe, it, expect } from 'vitest'
import { dedupeNote } from './project-history.js'

/**
 * Note/label de-duplication across the copy switch.
 *
 * App copy now separates clauses with a comma instead of an em dash, but
 * `stage_history` is append-only: every note written before the switch still
 * carries ' — '. Both spellings therefore have to keep deduping, or the
 * timeline starts printing 'Demo Teslim Edildi / Demo teslim edildi — onaya
 * gönderildi' for every row logged before today.
 */
describe('dedupeNote', () => {
  it('strips a heading echoed with the new comma separator', () => {
    expect(dedupeNote('Demo teslim edildi, onaya gönderildi', 'Demo Teslim Edildi'))
      .toBe('Onaya gönderildi')
  })

  it('still strips the em dash spelling written before the switch', () => {
    expect(dedupeNote('Demo teslim edildi — onaya gönderildi', 'Demo Teslim Edildi'))
      .toBe('Onaya gönderildi')
  })

  it('drops a note that is nothing but the heading', () => {
    expect(dedupeNote('Proje oluşturuldu', 'Proje Oluşturuldu')).toBeNull()
  })

  it('leaves a note that merely starts with a similar word', () => {
    // No separator after the heading → not an echo, so nothing may be cut.
    const note = 'Demo teslim edildikten sonra revize istendi'
    expect(dedupeNote(note, 'Demo Teslim Edildi')).toBe(note)
  })

  it('keeps a comma-carrying note that does not echo the heading', () => {
    const note = 'Ozalit istendi, matbaa teslimi bekleniyor'
    expect(dedupeNote(note, 'Demo Onaylandı')).toBe(note)
  })
})
