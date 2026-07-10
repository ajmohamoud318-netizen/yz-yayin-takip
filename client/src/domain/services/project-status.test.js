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
  it('maps demo stages to green', () => {
    expect(statusKeyForProject({ stage: 'demo_teslim' })).toBe('green')
    expect(statusKeyForProject({ stage: 'cin_demo_onay' })).toBe('green')
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
