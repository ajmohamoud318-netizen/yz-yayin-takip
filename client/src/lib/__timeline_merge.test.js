import { describe, it, expect } from 'vitest'
import { buildTimeline, historyMeta, rowText } from './project-history.js'

/**
 * Consecutive-repeat merging, and the note/heading split that goes with it.
 *
 * The timeline this replaces printed one row per event and let the note win
 * over the heading, so a leader who corrected the demo sheet seven times got
 * seven identical lines — each carrying its own form button, all opening the
 * same snapshot — and a change request reasoned 'kaaa' became a row that
 * said nothing at all.
 */

let n = 0
const at = (clock, over = {}) => ({
  id: `h${n++}`,
  action: 'system',
  created_at: `2026-08-25T${clock}:00`,
  done_by_name: 'Ayşenur',
  demoAttemptAt: 1,
  ozalitAttemptAt: 1,
  ...over,
})

const edit = (clock, over = {}) =>
  at(clock, { event: 'demo_form_edited', note: 'Demo formu güncellendi', ...over })

/** All rows of the day, whether they were folded into a run or not. */
const rowsOf = (days) =>
  days.flatMap((d) => d.nodes.flatMap((node) => (node.type === 'run' ? node.rows : node)))

describe('buildTimeline — consecutive repeats', () => {
  it('merges a back-to-back run into one row that keeps the count', () => {
    const rows = rowsOf(buildTimeline([edit('11:35'), edit('11:46'), edit('11:57')]))
    expect(rows).toHaveLength(1)
    expect(rows[0].count).toBe(3)
    expect(rows[0].firstAt).toContain('11:35')
    expect(rows[0].lastAt).toContain('11:57')
  })

  it('keeps the newest entry, whose attempt slot the form button opens', () => {
    const rows = rowsOf(buildTimeline([edit('11:35'), edit('11:57', { id: 'newest' })]))
    expect(rows[0].entry.id).toBe('newest')
  })

  it('does not merge rows whose notes differ', () => {
    const rows = rowsOf(
      buildTimeline([
        at('09:16', { event: 'demo_change_requested', note: 'kaaa' }),
        at('09:50', { event: 'demo_change_requested', note: 'hgdgdg' }),
      ]),
    )
    expect(rows).toHaveLength(2)
  })

  it('does not merge across an actor change', () => {
    const rows = rowsOf(buildTimeline([edit('11:35'), edit('11:46', { done_by_name: 'Aylin' })]))
    expect(rows).toHaveLength(2)
  })

  it('does not merge two rounds — their form buttons open different slots', () => {
    const rows = rowsOf(buildTimeline([edit('11:35'), edit('11:46', { demoAttemptAt: 2 })]))
    expect(rows).toHaveLength(2)
  })

  it('never merges across midnight — a merged row prints one day’s clock', () => {
    const days = buildTimeline([
      edit('23:58'),
      { ...edit('00:04'), created_at: '2026-08-26T00:04:00' },
    ])
    expect(days).toHaveLength(2)
    expect(rowsOf(days).every((r) => r.count === 1)).toBe(true)
  })

  it('leaves an interrupted repeat as two rows', () => {
    const rows = rowsOf(
      buildTimeline([
        edit('10:04'),
        at('11:30', { event: 'demo_started', note: 'Matbaa demo çalışmasına başladı' }),
        edit('11:35'),
      ]),
    )
    expect(rows.map((r) => r.count)).toEqual([1, 1, 1])
  })

  it('counts events, not rows, in the folded run’s summary', () => {
    // Four kinds, seven events — enough rows to stay folded (threshold 3).
    // All of them genuinely bookkeeping: the demo round's own lifecycle is
    // 'major' now and would break the run rather than join it.
    const days = buildTimeline([
      at('08:45', { event: 'subtask_progress', note: 'Kapak, sayfa 12/40' }),
      at('09:16', { event: 'subtask_done', note: 'Kapak' }),
      at('09:20', { event: 'demo_change_accepted', note: 'Matbaa değişiklik talebini kabul etti' }),
      edit('11:35'),
      edit('11:46'),
      edit('11:57'),
      edit('12:39'),
    ])
    const run = days[0].nodes[0]
    expect(run.type).toBe('run')
    expect(run.rows).toHaveLength(4)
    expect(run.total).toBe(7)
  })

  /**
   * The reported regression: a day spent entirely in a demo negotiation —
   * matbaa starts, leader asks for a change, matbaa accepts one and declines
   * the next — was every-row-'minor', so the run swallowed all of it and the
   * whole day rendered as one grey summary line.
   */
  it('never folds a whole day of demo negotiation behind one summary', () => {
    const days = buildTimeline([
      at('08:45', { event: 'demo_started', note: 'Matbaa demo çalışmasına başladı' }),
      at('08:45', { event: 'demo_change_requested', note: 'sayfa sayisi yanlis girildi' }),
      at('08:46', { event: 'demo_change_accepted', note: 'Matbaa değişiklik talebini kabul etti' }),
      at('09:16', { event: 'demo_change_requested', note: 'kaaa' }),
      at('09:16', { event: 'demo_change_declined', note: 'Matbaa değişiklik talebini reddetti' }),
      edit('10:04'),
      edit('10:27'),
    ])
    const { nodes } = days[0]
    expect(nodes.length).toBeGreaterThan(1)

    // The rejection is a node of its own, not a line inside a fold.
    const declined = nodes.find((n) => n.type === 'entry' && n.entry.event === 'demo_change_declined')
    expect(declined).toBeDefined()

    // …and the reason the leader typed reaches the reader at full width.
    const requested = nodes.find(
      (n) => n.type === 'entry' && n.entry.event === 'demo_change_requested',
    )
    expect(rowText(requested.entry, requested.meta).detail).toBe('sayfa sayisi yanlis girildi')
  })
})

describe('rowText', () => {
  const text = (entry, opts) => rowText(entry, historyMeta(entry), opts)

  it('leads with the heading and keeps a typed reason under it', () => {
    expect(text(at('09:16', { event: 'demo_change_requested', note: 'kaaa' })))
      .toEqual({ title: 'Değişiklik İstendi', detail: 'kaaa' })
  })

  it('drops a note that only restates its heading in other words', () => {
    expect(
      text(at('09:20', { event: 'demo_change_accepted', note: 'Matbaa değişiklik talebini kabul etti' })),
    ).toEqual({ title: 'Değişiklik Kabul Edildi', detail: null })
  })

  it('lets a subtask note stand alone in a dense row, and pair up in a full one', () => {
    const sub = at('10:12', { event: 'subtask_progress', note: 'Kapak, sayfa 12/40' })
    expect(text(sub, { dense: true })).toEqual({ title: 'Kapak, sayfa 12/40', detail: null })
    expect(text(sub)).toEqual({ title: 'Alt Görev İlerlemesi', detail: 'Kapak, sayfa 12/40' })
  })
})

describe('historyMeta — demo/ozalit round lifecycle', () => {
  it('files the change-request negotiation under Onaylar, not Alt Görevler', () => {
    for (const event of [
      'demo_started', 'ozalit_started',
      'demo_change_requested', 'ozalit_change_requested',
      'demo_change_accepted', 'demo_change_declined',
      'ekran_demo_requested',
    ]) {
      expect(historyMeta({ action: 'system', event }).group).toBe('approval')
    }
  })

  it('no longer labels a matbaa start as a stage advance', () => {
    const meta = historyMeta({ action: 'system', event: 'demo_started' })
    expect(meta.label).toBe('Demo Çalışması Başlatıldı')
    expect(meta.label).not.toBe('İlerletildi')
  })

  it('treats a cancel as a pipeline moment — it moves the project back', () => {
    expect(historyMeta({ action: 'system', event: 'demo_cancelled' }).weight).toBe('major')
  })

  /**
   * Weight and tone have to agree. A row painted 'negative' or 'pending' is
   * by definition something the reader has to act on, and folding it behind
   * a neutral summary is the contradiction this locks shut.
   */
  it('gives the negotiation the weight its tone already claimed', () => {
    for (const event of [
      'demo_started', 'ozalit_started',
      'demo_change_requested', 'ozalit_change_requested',
      'demo_change_declined', 'ozalit_change_declined',
      'ekran_demo_requested',
    ]) {
      expect(historyMeta({ action: 'system', event }).weight).toBe('major')
    }
  })

  it('keeps the "evet" half of a request/answer pair as bookkeeping', () => {
    // Its question is already a major row directly above it.
    expect(historyMeta({ action: 'system', event: 'demo_change_accepted' }).weight).toBe('minor')
    expect(historyMeta({ action: 'system', event: 'demo_form_edited' }).weight).toBe('minor')
  })
})

describe('merged rows keep every snapshot', () => {
  it('carries all of the merged entries, oldest first', () => {
    // Each correction writes its own sheet (migration 052), so a merged row
    // has to hand the reader one link per version — merging the rows must not
    // merge the sheets.
    const rows = rowsOf(
      buildTimeline([
        edit('11:35', { demo_id: 'd1' }),
        edit('11:46', { demo_id: 'd2' }),
        edit('11:57', { demo_id: 'd3' }),
      ]),
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].entries.map((e) => e.demo_id)).toEqual(['d1', 'd2', 'd3'])
    // …and still speaks as the newest of them.
    expect(rows[0].entry.demo_id).toBe('d3')
  })
})
