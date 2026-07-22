import { statusKeyForProject, groupKeyForProject } from './project-status.js'

describe('statusKeyForProject', () => {
  it('maps satışta to yellow', () => {
    expect(statusKeyForProject({ stage: 'satista', progress: 100 })).toBe('yellow')
  })
  it('maps production stages to pink', () => {
    expect(statusKeyForProject({ stage: 'uretimde' })).toBe('pink')
    expect(statusKeyForProject({ stage: 'gumruk' })).toBe('pink')
  })
  it('maps ozalit stages to blue', () => {
    expect(statusKeyForProject({ stage: 'ozalit_teslim' })).toBe('blue')
    expect(statusKeyForProject({ stage: 'ozalit_onay' })).toBe('blue')
  })
  // "Demo aşamasında" (green) means: the second demo cycle is in
  // flight — the leader has already approved the first demo, the
  // designer finished to 100%, and re-sent the demo for the leader
  // to send to Ozalit. The first demo cycle (leader hasn't approved
  // yet) reads purple — the project is clearly past tasarim but the
  // design isn't necessarily finished. demo_onay at <100% on the
  // first cycle (held) also reads purple — the team leader can tell
  // at a glance which projects are stuck waiting on the designer.
  it('maps first-cycle demo_teslim to devam eden regardless of progress', () => {
    expect(statusKeyForProject({ stage: 'demo_teslim', progress: 0 })).toBe('purple')
    expect(statusKeyForProject({ stage: 'demo_teslim', progress: 50 })).toBe('purple')
    expect(statusKeyForProject({ stage: 'cin_demo_teslim', progress: 100 })).toBe('purple')
  })
  it('maps first-cycle demo_onay at <100% (held) to devam eden', () => {
    expect(statusKeyForProject({ stage: 'demo_onay', progress: 25 })).toBe('purple')
    expect(statusKeyForProject({ stage: 'cin_demo_onay', progress: 50 })).toBe('purple')
  })
  it('maps second-cycle demo_teslim / demo_onay to green', () => {
    const approved = {
      history: [
        { action: 'approve', to_stage: 'demo_onay' },
      ],
    }
    expect(statusKeyForProject({ ...approved, stage: 'demo_teslim', progress: 100 })).toBe('green')
    expect(statusKeyForProject({ ...approved, stage: 'demo_onay', progress: 100 })).toBe('green')
    expect(statusKeyForProject({ stage: 'cin_demo_teslim', progress: 100, history: [
      { action: 'approve', to_stage: 'cin_demo_onay' },
    ] })).toBe('green')
  })
  it('maps tasarim with progress 0 to orange (yeni proje)', () => {
    expect(statusKeyForProject({ stage: 'tasarim', progress: 0 })).toBe('orange')
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
