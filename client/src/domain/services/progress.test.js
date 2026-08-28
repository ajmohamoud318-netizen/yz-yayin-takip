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
  it('weights pages/sticker-count subtasks by their counters, not just is_done', () => {
    // The progress bar tracks partial page work — `is_done` is just a
    // derived display flag for the chip grid (it flips true only when
    // every page is done). The counter on the subtask row is what moves
    // the project progress.
    const subs = [
      // 5/5 pages but is_done hasn't been recomputed yet — still 100% contribution.
      { kind: 'pages', pages_done: 5, total_pages: 5, is_done: false },
      // 3/3 stickers, is_done=true. 100%.
      { kind: 'sticker-count', stickers_done: 3, total_stickers: 3, is_done: true },
    ]
    expect(subtaskProgress(subs)).toBe(100)
  })

  it('moves the progress bar as designers check pages off one by one', () => {
    // 4 subtasks: 1 check done, 1 check not done, 1 pages half done, 1 pages quarter done.
    // Score: 1 + 0 + 0.5 + 0.25 = 1.75 / 4 = 43.75% → 44.
    const subs = [
      { kind: 'check', is_done: true },
      { kind: 'check', is_done: false },
      { kind: 'pages', pages_done: 24, total_pages: 48, is_done: false },
      { kind: 'pages', pages_done: 8, total_pages: 32, is_done: false },
    ]
    expect(subtaskProgress(subs)).toBe(44)
  })

  it('clamps pages_done above total_pages to 1 (defensive against bad data)', () => {
    // If a subtask has pages_done > total_pages for any reason (the
    // route guards against this on write, but the function should not
    // poison progress with NaN if it ever happens). 50/48 is clamped to
    // 1; the sibling check subtask contributes 0.
    const subs = [
      { kind: 'pages', pages_done: 50, total_pages: 48, is_done: true },
      { kind: 'check', is_done: false },
    ]
    expect(subtaskProgress(subs)).toBe(50)
  })

  it('falls back to is_done for pages subtasks missing total_pages', () => {
    // A misconfigured pages subtask with total_pages=0 can't compute a
    // ratio — falls back to the boolean instead of NaN-poisoning the sum.
    const subs = [
      { kind: 'pages', pages_done: 0, total_pages: 0, is_done: true },
      { kind: 'check', is_done: false },
    ]
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
