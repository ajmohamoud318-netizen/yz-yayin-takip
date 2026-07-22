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
  // "Demo aşamasında" (green) means: design is at 100% AND the team
  // leader has approved. demo_teslim (printer hasn't delivered) and
  // demo_onay at <100% (held, waiting on designer) fall through to the
  // devam-eden buckets.
  it('maps demo_teslim to devam eden (not yet approved)', () => {
    expect(statusKeyForProject({ stage: 'demo_teslim', progress: 0 })).toBe('orange')
    expect(statusKeyForProject({ stage: 'demo_teslim', progress: 50 })).toBe('purple')
    expect(statusKeyForProject({ stage: 'cin_demo_teslim', progress: 100 })).toBe('purple')
  })
  it('maps demo_onay at <100% (held) to devam eden', () => {
    expect(statusKeyForProject({ stage: 'demo_onay', progress: 25 })).toBe('purple')
    expect(statusKeyForProject({ stage: 'cin_demo_onay', progress: 50 })).toBe('purple')
  })
  it('maps demo_onay at 100% to green (Demo aşamasında — ready)', () => {
    expect(statusKeyForProject({ stage: 'demo_onay', progress: 100 })).toBe('green')
    expect(statusKeyForProject({ stage: 'cin_demo_onay', progress: 100 })).toBe('green')
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
