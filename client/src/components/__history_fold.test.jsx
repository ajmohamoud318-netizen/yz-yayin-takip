// Regression test for a fold swallowing an entire day.
//
// ProjectHistory folds a run of 3+ consecutive 'minor' rows behind one
// summary node. On a day whose every event was minor there was no major row
// to break the run, so the fold became the day: the panel rendered a single
// grey summary line for the whole day and nothing else.
//
// lib/project-history.js fixes the classification (a demo negotiation is not
// bookkeeping — see __timeline_merge.test.js). This test locks the structural
// half: whatever the weights say in future, a fold may hide rows from a day
// but may never BE the day.
import { describe, it, expect, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'

import ProjectHistory from './ProjectHistory.jsx'

// framer-motion's AnimatePresence keeps exiting children mounted for the
// length of their transition, which would make "is it collapsed?" a race.
// The layout/animation behaviour is not what this test is about.
vi.mock('framer-motion', () => ({
  motion: new Proxy({}, { get: () => ({ children, ...p }) => {
    const { layout, initial, animate, exit, transition, ...rest } = p
    return <div {...rest}>{children}</div>
  } }),
  AnimatePresence: ({ children }) => <>{children}</>,
  useReducedMotion: () => true,
}))

let n = 0
const at = (clock, over) => ({
  id: `h${n++}`,
  action: 'system',
  created_at: `2026-08-25T${clock}:00`,
  done_by_name: 'Ayşenur',
  demoAttemptAt: 1,
  ozalitAttemptAt: 1,
  ...over,
})

const subtask = (clock, note) => at(clock, { event: 'subtask_progress', note })

function render(entries) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  act(() => root.render(<ProjectHistory entries={entries} projectType="TR" />))
  return host
}

describe('ProjectHistory — a fold may not be the whole day', () => {
  it('opens the run when nothing else happened that day', () => {
    const host = render([
      subtask('08:45', 'Kapak, sayfa 12/40'),
      subtask('09:16', 'İç sayfa, sayfa 30/40'),
      subtask('10:04', 'Arka kapak, sayfa 38/40'),
    ])
    const toggle = host.querySelector('[aria-expanded]')
    expect(toggle).not.toBeNull()
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    // The rows themselves are on screen, not just their count.
    expect(host.textContent).toContain('Kapak, sayfa 12/40')
  })

  it('leaves it collapsed when the day has a major row to read first', () => {
    const host = render([
      at('08:30', { event: 'demo_started', note: 'Matbaa demo çalışmasına başladı' }),
      subtask('08:45', 'Kapak, sayfa 12/40'),
      subtask('09:16', 'İç sayfa, sayfa 30/40'),
      subtask('10:04', 'Arka kapak, sayfa 38/40'),
    ])
    const toggle = host.querySelector('[aria-expanded]')
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(host.textContent).toContain('Demo Çalışması Başlatıldı')
    expect(host.textContent).not.toContain('Kapak, sayfa 12/40')
  })
})
