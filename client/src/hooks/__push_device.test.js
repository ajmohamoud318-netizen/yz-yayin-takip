import { describe, it, expect, afterEach, vi } from 'vitest'
import { isMobileDevice } from './usePushNotifications.js'

/**
 * Which devices are offered push setup.
 *
 * Push exists to reach people away from a screen; at a desk the app is open
 * and polling. The classification is deliberately generous towards "mobile" —
 * a misclassified phone hides the feature from someone on the print floor,
 * a misclassified desktop shows one dismissible row.
 */

function stubDevice({ ua, touchPoints = 0, coarse = false, platform = 'Win32' }) {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(ua)
  vi.spyOn(navigator, 'platform', 'get').mockReturnValue(platform)
  // jsdom's Navigator has no maxTouchPoints at all (unlike userAgent/platform),
  // so there's no existing getter for vi.spyOn to wrap — define it outright and
  // remove it in afterEach instead of restoring a mock that was never there.
  Object.defineProperty(navigator, 'maxTouchPoints', { value: touchPoints, configurable: true })
  vi.spyOn(window, 'matchMedia').mockImplementation((q) => ({
    matches: q === '(pointer: coarse)' ? coarse : false,
    media: q,
    addEventListener() {},
    removeEventListener() {},
  }))
}

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15'
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/124 Mobile Safari/537.36'
const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124 Safari/537.36'
const WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36'

describe('isMobileDevice', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    delete navigator.maxTouchPoints
  })

  it('treats phones as mobile', () => {
    stubDevice({ ua: IPHONE, touchPoints: 5, coarse: true })
    expect(isMobileDevice()).toBe(true)

    stubDevice({ ua: ANDROID, touchPoints: 5, coarse: true })
    expect(isMobileDevice()).toBe(true)
  })

  it('treats an iPad reporting itself as a Mac as mobile', () => {
    // iPadOS 13+ ships a desktop Safari UA; maxTouchPoints is the only tell.
    stubDevice({ ua: MAC, platform: 'MacIntel', touchPoints: 5, coarse: true })
    expect(isMobileDevice()).toBe(true)
  })

  it('treats an Android tablet with no "Mobile" in the UA as mobile', () => {
    stubDevice({
      ua: 'Mozilla/5.0 (Linux; Android 13; SM-X200) AppleWebKit/537.36 Chrome/124 Safari/537.36',
      touchPoints: 5,
      coarse: true,
    })
    expect(isMobileDevice()).toBe(true)
  })

  it('treats plain desktops as desktop', () => {
    stubDevice({ ua: MAC, platform: 'MacIntel', touchPoints: 0 })
    expect(isMobileDevice()).toBe(false)

    stubDevice({ ua: WINDOWS, touchPoints: 0 })
    expect(isMobileDevice()).toBe(false)
  })

  it('treats a touchscreen laptop as desktop', () => {
    // The regression this guards: maxTouchPoints > 0 alone would flip a Surface
    // or a touch-enabled ThinkPad to mobile. Its PRIMARY pointer is the
    // trackpad, so `pointer: coarse` is false and it stays desktop.
    stubDevice({ ua: WINDOWS, touchPoints: 10, coarse: false })
    expect(isMobileDevice()).toBe(false)
  })
})
