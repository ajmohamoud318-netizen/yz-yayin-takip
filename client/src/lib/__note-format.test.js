import { describe, it, expect } from 'vitest'
import {
  looksLikeHtml, markdownToHtml, sanitizeNoteHtml, htmlToText,
  bodyToEditorHtml, isEmptyNoteBody, sanitizeNoteTitleHtml, NOTE_TITLE_MAX,
} from './note-format.js'

describe('note-format', () => {
  it('detects HTML bodies vs markdown', () => {
    expect(looksLikeHtml('<p>Merhaba</p>')).toBe(true)
    expect(looksLikeHtml('sadece **kalın**')).toBe(false)
  })

  it('renders bold, italic, underline and lists from markdown', () => {
    const html = markdownToHtml('**kalın** ve *italik* ve __altı__\n- bir\n- iki\n1. birinci')
    expect(html).toContain('<strong>kalın</strong>')
    expect(html).toContain('<em>italik</em>')
    expect(html).toContain('<u>altı</u>')
    expect(html).toContain('<ul><li>bir</li><li>iki</li></ul>')
    expect(html).toContain('<ol><li>birinci</li></ol>')
  })

  it('strips raw img tags even when they look like markdown', () => {
    expect(markdownToHtml('<img src=x onerror=alert(1)>')).toBe('')
  })

  it('strips scripts and unsafe images from pasted HTML', () => {
    const dirty = '<p onclick="alert(1)">ok</p><script>alert(1)</script><img src="x">'
    const clean = sanitizeNoteHtml(dirty)
    expect(clean).toContain('<p>ok</p>')
    expect(clean).not.toContain('onclick')
    expect(clean).not.toContain('script')
    expect(clean).not.toContain('alert')
    expect(clean).not.toContain('img')
    expect(sanitizeNoteHtml('<img src="/api/target-project-ideas/abc/images/xyz">'))
      .toContain('src="/api/target-project-ideas/abc/images/xyz"')
    expect(sanitizeNoteHtml('<img src="/api/target-project-ideas/abc/images/xyz" style="width: 280px; height: 40px">'))
      .toContain('width: 280px')
    expect(sanitizeNoteHtml('<img src="/api/target-project-ideas/abc/images/xyz" style="width: 280px">'))
      .not.toContain('height')
    expect(isEmptyNoteBody('<img src="/api/target-project-ideas/abc/images/xyz">')).toBe(false)
  })

  it('keeps bullet marker classes on lists', () => {
    expect(sanitizeNoteHtml('<ul class="note-ul-arrow extra"><li>a</li></ul>'))
      .toBe('<ul class="note-ul-arrow"><li>a</li></ul>')
    expect(sanitizeNoteHtml('<ul class="note-check"><li class="checked">x</li></ul>'))
      .toContain('class="note-check"')
  })

  it('keeps highlight marker color on lists', () => {
    const html = sanitizeNoteHtml(
      '<ul class="note-ul-mark extra" style="--note-mark: #BBF7D0; color: red"><li>a</li></ul>',
    )
    expect(html).toContain('class="note-ul-mark"')
    expect(html).toContain('--note-mark')
    expect(html).toContain('#BBF7D0')
    expect(html).not.toContain('color')
    expect(sanitizeNoteHtml('<ul class="note-ul-mark" style="--note-mark: #000000"><li>a</li></ul>'))
      .not.toContain('--note-mark')
  })

  it('keeps text-align on paragraphs', () => {
    const html = sanitizeNoteHtml('<p style="text-align:center; color:red">hey</p>')
    expect(html).toContain('text-align')
    expect(html).toContain('center')
    expect(html).not.toContain('color')
  })

  it('treats empty tags as an empty body', () => {
    expect(isEmptyNoteBody('<p><br></p>')).toBe(true)
    expect(isEmptyNoteBody('<p>not</p>')).toBe(false)
    expect(htmlToText('<p>Merhaba <strong>dünya</strong></p>')).toBe('Merhaba dünya')
  })

  it('passes HTML through bodyToEditorHtml after sanitizing', () => {
    expect(bodyToEditorHtml('<p class="x">Hey</p>')).toBe('<p>Hey</p>')
    expect(bodyToEditorHtml('**Hey**')).toBe('<p><strong>Hey</strong></p>')
  })

  it('keeps highlight spans and bold in titles while unwrapping blocks', () => {
    const html = sanitizeNoteTitleHtml(
      '<p><span style="background-color: #FFE58F"><strong>hey</strong></span></p>',
    )
    expect(html).toContain('<strong>hey</strong>')
    expect(html).toContain('background-color')
    expect(html).toContain('#FFE58F')
    expect(html).not.toContain('<p>')
    expect(sanitizeNoteTitleHtml('<div>Hello</div>')).toBe('Hello')
  })

  it('strips images and lists from titles and caps plain text', () => {
    expect(sanitizeNoteTitleHtml('<ul><li>a</li></ul>')).not.toMatch(/<(ul|li)\b/i)
    expect(sanitizeNoteTitleHtml('<img src="/api/target-project-ideas/abc/images/xyz">'))
      .not.toContain('<img')
    const long = 'x'.repeat(NOTE_TITLE_MAX + 50)
    expect(htmlToText(sanitizeNoteTitleHtml(long)).length).toBe(NOTE_TITLE_MAX)
  })
})
