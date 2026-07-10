import { PASS_KIND } from '../../../domain/index.js'
import { buildReopenedProject } from './project-passes.js'

/**
 * Pass (baskı) helper tests. The buildReopenedProject helper only acts when
 * the project is at satista; for any other stage it returns the project
 * unchanged with `reopened: false`. This guards the "first sale stays on the
 * same pass" rule.
 */

function makeProject(overrides = {}) {
  return {
    id: 'p-test',
    type: 'TR',
    stage: 'satista',
    pass_number: 1,
    pass_kind: PASS_KIND.FIRST_EDITION,
    demo_attempt: 2,
    ozalit_attempt: 1,
    progress: 100,
    history: [{ id: 'h1', action: 'create' }],
    assignees: [{ id: 'u-aylin', name: 'Aylin' }],
    subtasks: [{ id: 'st-1', is_done: true }],
    created_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

const buildProjectDetail = (p) => ({ history: p.history ?? [], subtasks: p.subtasks ?? [] })

describe('buildReopenedProject', () => {
  it('is a no-op for projects not at satista (e.g. uretime_hazir)', () => {
    const p = makeProject({ stage: 'uretime_hazir' })
    const { project, reopened } = buildReopenedProject(p, buildProjectDetail, {
      kind: PASS_KIND.REPRINT,
    })
    expect(reopened).toBe(false)
    expect(project).toBe(p)
  })

  it('opens a new pass and resets attempt counters for satista projects', () => {
    const p = makeProject({ stage: 'satista', demo_attempt: 2, ozalit_attempt: 1 })
    const { project, reopened } = buildReopenedProject(p, buildProjectDetail, {
      kind: PASS_KIND.REPRINT,
      trigger: { by_name: 'Esra Kılıç' },
    })
    expect(reopened).toBe(true)
    expect(project.stage).toBe('uretime_hazir')
    expect(project.pass_number).toBe(2)
    expect(project.pass_kind).toBe(PASS_KIND.REPRINT)
    expect(project.demo_attempt).toBe(0)
    expect(project.ozalit_attempt).toBe(0)
    expect(project.progress).toBe(100) // reprint keeps the completed design
  })

  it('archives the closed pass into passes[]', () => {
    const p = makeProject({ stage: 'satista', pass_number: 3 })
    const { project } = buildReopenedProject(p, buildProjectDetail, {
      kind: PASS_KIND.REPRINT,
    })
    expect(project.passes.length).toBe(1)
    const archived = project.passes[0]
    expect(archived.number).toBe(3)
    expect(archived.stage_reached).toBe('satista')
    // Archives capture the counters AT the close — makeProject defaults are
    // demo_attempt:2 / ozalit_attempt:1.
    expect(archived.demo_attempt).toBe(2)
    expect(archived.ozalit_attempt).toBe(1)
  })

  it('starts a fresh history with a single reopen entry', () => {
    const p = makeProject({ stage: 'satista', history: [{ id: 'old' }, { id: 'old2' }] })
    const { project } = buildReopenedProject(p, buildProjectDetail, {
      kind: PASS_KIND.REPRINT,
      trigger: { by_name: 'Esra' },
    })
    expect(project.history.length).toBe(1)
    expect(project.history[0].action).toBe('reopen')
    expect(project.history[0].pass_number).toBe(2)
    expect(project.history[0].note).toMatch(/2\. baskı/)
  })
})
