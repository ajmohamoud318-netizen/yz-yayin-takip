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
  it('mirrors the server: pages subtasks count as done when pages_done >= total_pages', () => {
    // Same logic as `server/src/domain/progress.js#subtaskProgress`.
    // The client function existed for the optimistic `progress` write
    // back into the store; it has to agree with the server or the
    // dashboard progress bar would briefly disagree with the header.
    const subs = [
      { kind: 'pages', pages_done: 5, total_pages: 5, is_done: false },
      { kind: 'pages', pages_done: 4, total_pages: 10, is_done: false },
    ]
    // 1 of 2 done = 50%
    expect(subtaskProgress(subs)).toBe(50)
  })
  it('treats sticker-count subtasks the same way as pages', () => {
    const subs = [
      { kind: 'sticker-count', stickers_done: 3, total_stickers: 3, is_done: false },
      { kind: 'sticker-count', stickers_done: 0, total_stickers: 5, is_done: false },
    ]
    // 1 of 2 done = 50%
    expect(subtaskProgress(subs)).toBe(50)
  })
  it('handles a mix of check + pages + sticker-count', () => {
    const subs = [
      { kind: 'check',         is_done: true },
      { kind: 'pages',         pages_done: 5, total_pages: 5, is_done: false },
      { kind: 'sticker-count', stickers_done: 10, total_stickers: 10, is_done: false },
      { kind: 'check',         is_done: false },
    ]
    // 3 of 4 done = 75%
    expect(subtaskProgress(subs)).toBe(75)
  })
  it('treats pages with total_pages = 0 as never done', () => {
    // A misconfigured "Sayfa Sayısı" subtask with total_pages=0 should
    // not trivially count as 100% complete. The server has the same
    // guard via `(s.total_pages ?? 0) > 0`.
    expect(
      isSubtaskDone({ kind: 'pages', pages_done: 0, total_pages: 0 }),
    ).toBe(false)
    expect(
      isSubtaskDone({ kind: 'sticker-count', stickers_done: 0, total_stickers: 0 }),
    ).toBe(false)
  })
})
