import { USE_MOCK } from '../../config.js'
import { delay } from '../store.js'

/** Run mock logic with simulated latency, or delegate to HTTP. */
export async function mockOrHttp(mockFn, httpFn) {
  if (USE_MOCK) {
    await delay()
    return mockFn()
  }
  return httpFn()
}

export async function mockOrHttpFast(mockFn, httpFn) {
  if (USE_MOCK) {
    await delay(150)
    return mockFn()
  }
  return httpFn()
}
