import { subtaskProgress, isSubtaskDone } from './progress.js'

describe('subtaskProgress', () => {
  it('returns 0 for empty / missing input', () => {
    expect(subtaskProgress([])).toBe(0)
    expect(subtaskProgress(null)).toBe(0)
    expect(subtaskProgress(undefined)).toBe(0)
  })
  it('returns 0 when nothing is done', () => {
    expect(subtaskProgress([{ is_done: false }, { is_done: false }])).toBe(0)
  })
  it('returns 100 when all are done', () => {
    expect(subtaskProgress([{ is_done: true }, { is_done: true }])).toBe(100)
  })
  it('rounds partial progress', () => {
    // 1 of 3 done = 33.33% → 33
    expect(subtaskProgress([{ is_done: true }, { is_done: false }, { is_done: false }])).toBe(33)
    // 2 of 3 done = 66.66% → 67
    expect(subtaskProgress([{ is_done: true }, { is_done: true }, { is_done: false }])).toBe(67)
  })
  it('treats pages/sticker-count subtasks the same as check — is_done is what counts', () => {
    // `kind` no longer changes "done"-ness: pages/sticker-count subtasks
    // dropped their counter (pages_done/total_pages) in favor of a plain
    // checkbox, same as every other subtask.
    const subs = [
      { kind: 'pages', pages_done: 5, total_pages: 5, is_done: false },
      { kind: 'sticker-count', stickers_done: 3, total_stickers: 3, is_done: true },
    ]
    // 1 of 2 done = 50%
    expect(subtaskProgress(subs)).toBe(50)
  })
  it('excludes "Yazılım" from progress entirely — selecting it never blocks 100%', () => {
    const subs = [
      { title: 'Kapak', is_done: true },
      { title: 'Kutu', is_done: true },
      { title: 'Yazılım', is_done: false },
    ]
    // 2 of 2 counted (Kapak, Kutu) done = 100%, Yazılım is ignored either way.
    expect(subtaskProgress(subs)).toBe(100)
  })
  it('isSubtaskDone ignores kind entirely', () => {
    expect(isSubtaskDone({ kind: 'pages', is_done: true })).toBe(true)
    expect(isSubtaskDone({ kind: 'sticker-count', is_done: false })).toBe(false)
    expect(isSubtaskDone(null)).toBe(false)
  })
})
