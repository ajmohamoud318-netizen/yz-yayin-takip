import { USE_MOCK } from '../../config.js'
import { delay } from '../store.js'

/**
 * Transport selector. The composition root (`create-api.js`) sets this
 * once at boot — either to `'mock'` (default) or `'http'`. Routes that
 * still call `mockOrHttp(mockFn, httpFn)` then resolve the right branch
 * without each call site having to know about `USE_MOCK`.
 *
 * Keeping the call-site shape (`(mockFn, httpFn) => …`) is what lets us
 * flip between transports without churning every use-case / repo.
 */
let transport = USE_MOCK ? 'mock' : 'http'

export function setTransport(next) {
  transport = next === 'http' ? 'http' : 'mock'
}

export function getTransport() {
  return transport
}

/** Run mock logic with simulated latency, or delegate to HTTP. */
export async function mockOrHttp(mockFn, httpFn) {
  if (transport === 'mock') {
    await delay()
    return mockFn()
  }
  return httpFn()
}

export async function mockOrHttpFast(mockFn, httpFn) {
  if (transport === 'mock') {
    await delay(150)
    return mockFn()
  }
  return httpFn()
}
