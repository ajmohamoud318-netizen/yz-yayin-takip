import { subtaskProgress } from './progress.js'

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
  it('treats is_done as the only signal (pages subtasks handled elsewhere)', () => {
    // The function intentionally ignores pages_done; pages subtasks mark
    // is_done themselves once their page count is reached (mock layer).
    const subs = [
      { kind: 'pages', pages_done: 5, is_done: false },
      { kind: 'pages', pages_done: 10, is_done: true },
    ]
    expect(subtaskProgress(subs)).toBe(50)
  })
})
