import { statusKeyForProject, statusKeyForStage, groupKeyForProject } from './project-status.js'

describe('statusKeyForStage', () => {
  it('matches statusKeyForProject for every stage a project has started on', () => {
    const stages = [
      'tasarim', 'demo_teslim', 'demo_onay', 'ozalit_teslim', 'ozalit_onay', 'baski_onay',
      'cin_demo_teslim', 'cin_demo_onay', 'cin_baski_onay', 'baskida', 'gumruk', 'satista',
    ]
    for (const stage of stages) {
      expect(statusKeyForStage(stage)).toBe(statusKeyForProject({ stage, progress: 50 }))
    }
  })
  it('paints the tasarım column purple — gray is a %0 project, not a stage', () => {
    expect(statusKeyForStage('tasarim')).toBe('purple')
    expect(statusKeyForStage(undefined)).toBe('purple')
  })
})

describe('statusKeyForProject', () => {
  it('maps satışta to yellow', () => {
    expect(statusKeyForProject({ stage: 'satista', progress: 100 })).toBe('yellow')
  })
  it('maps production stages to pink', () => {
    expect(statusKeyForProject({ stage: 'baskida' })).toBe('pink')
    expect(statusKeyForProject({ stage: 'gumruk' })).toBe('pink')
  })
  it('maps ozalit/baskı onayı stages to blue', () => {
    expect(statusKeyForProject({ stage: 'ozalit_teslim' })).toBe('blue')
    expect(statusKeyForProject({ stage: 'ozalit_onay' })).toBe('blue')
    expect(statusKeyForProject({ stage: 'baski_onay' })).toBe('blue')
    expect(statusKeyForProject({ stage: 'cin_baski_onay' })).toBe('blue')
  })
  it('gives each demo stage its own color', () => {
    expect(statusKeyForProject({ stage: 'demo_teslim', progress: 50 })).toBe('orange')
    expect(statusKeyForProject({ stage: 'demo_onay', progress: 50 })).toBe('cyan')
    expect(statusKeyForProject({ stage: 'cin_demo_teslim', progress: 50 })).toBe('lime')
    expect(statusKeyForProject({ stage: 'cin_demo_onay', progress: 50 })).toBe('teal')
  })
  // The old rule painted a first-round demo purple — the same as tasarım in
  // progress — so a project entering demo didn't change color at all. The
  // demo color now depends on the stage alone: not progress, not round.
  it('ignores progress and earlier demo approvals on demo stages', () => {
    const approved = { history: [{ action: 'approve', to_stage: 'demo_onay' }] }
    expect(statusKeyForProject({ stage: 'demo_teslim', progress: 0 })).toBe('orange')
    expect(statusKeyForProject({ ...approved, stage: 'demo_teslim', progress: 100 })).toBe('orange')
    expect(statusKeyForProject({ ...approved, stage: 'demo_onay', progress: 0 })).toBe('cyan')
    expect(statusKeyForProject({ ...approved, stage: 'demo_onay', progress: 100 })).toBe('cyan')
  })
  it('maps retired production stages to pink, not the demo teal', () => {
    expect(statusKeyForProject({ stage: 'uretime_hazir', progress: 100 })).toBe('pink')
    expect(statusKeyForProject({ stage: 'uretimde', progress: 100 })).toBe('pink')
  })
  it('maps tasarim with progress 0 to gray (yeni proje)', () => {
    expect(statusKeyForProject({ stage: 'tasarim', progress: 0 })).toBe('gray')
  })
  it('maps tasarim with any progress to purple (devam eden)', () => {
    expect(statusKeyForProject({ stage: 'tasarim', progress: 1 })).toBe('purple')
    expect(statusKeyForProject({ stage: 'tasarim', progress: 50 })).toBe('purple')
  })
})

describe('groupKeyForProject', () => {
  it('groups untouched tasarim projects as yeni_proje', () => {
    expect(groupKeyForProject({ stage: 'tasarim', progress: 0 })).toBe('yeni_proje')
  })
  it('groups anything with progress > 0 (or any non-tasarim stage) as devam_eden', () => {
    expect(groupKeyForProject({ stage: 'tasarim', progress: 25 })).toBe('devam_eden')
    expect(groupKeyForProject({ stage: 'demo_teslim', progress: 100 })).toBe('devam_eden')
    expect(groupKeyForProject({ stage: 'satista', progress: 100 })).toBe('devam_eden')
  })
})
