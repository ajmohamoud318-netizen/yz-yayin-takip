/**
 * Pass (baskı) management helpers — the core of the Pass 2 / reprint loop.
 *
 * Split out of `mock-project.repository.js` so the repo can stay focused on
 * persistence while the pass state machine is in one testable file.
 */

import { PASS_KIND, defaultPassKindFor } from '../../../domain/index.js'
import { uid } from './id.js'

/**
 * Build the closed-pass archive from the current project state. Pure function:
 * the project itself is the only input.
 *
 * @param {object} project  the project at the moment we close the pass
 * @param {object} buildProjectDetail  mapper used to materialise history/subtasks
 *                                     if the project doesn't already carry them
 */
export function buildArchivedPass(project, buildProjectDetail) {
  const history = project.history ?? buildProjectDetail(project).history
  const subtasks = project.subtasks ?? buildProjectDetail(project).subtasks
  const number = project.pass_number ?? 1
  return {
    number,
    kind: project.pass_kind ?? defaultPassKindFor(number),
    stage_reached: 'satista',
    demo_attempt: project.demo_attempt ?? 0,
    ozalit_attempt: project.ozalit_attempt ?? 0,
    assignees: project.assignees ?? [],
    subtasks,
    history,
    opened_at: project.pass_opened_at ?? project.created_at ?? null,
    closed_at: new Date().toISOString(),
  }
}

/**
 * Build the new-project state after closing the current pass and starting
 * the next one. Returns the new project + the first history entry for it.
 *
 *   • kind defaults to PASS_KIND.REPRINT
 *   • counters reset (demo_attempt=0, ozalit_attempt=0)
 *   • history is replaced with a single `reopen` entry (a fresh timeline)
 *   • the closed pass is appended to `passes[]`
 */
export function buildReopenedProject(project, buildProjectDetail, { kind = PASS_KIND.REPRINT, trigger = {} } = {}) {
  if (project.stage !== 'satista') {
    return { project, reopened: false }
  }
  const now = new Date().toISOString()
  const closingNumber = project.pass_number ?? 1
  const archivedPass = buildArchivedPass(project, buildProjectDetail)
  const newNumber = closingNumber + 1

  const reopenEntry = {
    id: uid(`${project.id}-hreopen`),
    action: 'reopen',
    from_stage: 'satista',
    to_stage: 'uretime_hazir',
    done_by_name: trigger.by_name ?? 'Esra Kılıç',
    created_at: now,
    pass_number: newNumber,
    pass_kind: kind,
    order_id: trigger.order_id ?? null,
    note: trigger.note ?? `${newNumber}. baskı için yeni tur açıldı — ${trigger.by_name ?? 'Satış'} talebi`,
  }

  return {
    project: {
      ...project,
      stage: 'uretime_hazir',
      pass_number: newNumber,
      pass_kind: kind,
      pass_opened_at: now,
      demo_attempt: 0,
      ozalit_attempt: 0,
      last_reject_reason: null,
      last_reject_type: null,
      // Reprint keeps the existing (completed) design — progress stays 100.
      progress: 100,
      passes: [...(project.passes ?? []), archivedPass],
      history: [reopenEntry],
      updated_at: now,
    },
    reopened: true,
  }
}
