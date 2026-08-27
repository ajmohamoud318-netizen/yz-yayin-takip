import { useCallback, useEffect, useState } from 'react'

const STORAGE_KEY = 'yz-theme'

/**
 * Theme preference with three values:
 *   • 'light'  — always light
 *   • 'dark'   — always dark
 *   • 'system' — follow OS prefers-color-scheme (default for new users)
 *
 * The actual `dark` class lives on <html> so Tailwind's `darkMode: 'class'`
 * (tailwind.config.js) picks it up app-wide. We never write inline styles —
 * just toggle the class and let CSS do the rest.
 *
 * Why a separate hook (instead of a context): the class lives on <html>,
 * which means *every* component can already observe it via `MutationObserver`
 * if it needs to. A hook that owns the source of truth + a single `set` is
 * enough — no provider, no prop-drilling, no re-render storms.
 *
 * The OS preference is read once at boot via `matchMedia`, then re-evaluated
 * when the user changes their system theme while the tab is open.
 */
function readStored() {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (v === 'light' || v === 'dark' || v === 'system') return v
  } catch {
    /* localStorage may be blocked — fall through to system */
  }
  return 'system'
}

function systemPrefersDark() {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

function applyTheme(pref) {
  const dark = pref === 'dark' || (pref === 'system' && systemPrefersDark())
  if (typeof document !== 'undefined') {
    document.documentElement.classList.toggle('dark', dark)
  }
}

/**
 * Synchronous variant used at boot (main.jsx) — runs before React mounts so
 * the first paint already matches the stored preference. Reads localStorage
 * directly; same precedence as the hook's `readStored`.
 */
export function applyStoredTheme() {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (v === 'light' || v === 'dark' || v === 'system') {
      applyTheme(v)
      return
    }
  } catch {
    /* ignore */
  }
  applyTheme('system')
}

export function useTheme() {
  const [pref, setPref] = useState(readStored)

  // Apply on mount and whenever the preference or OS setting changes.
  useEffect(() => {
    applyTheme(pref)
    try {
      localStorage.setItem(STORAGE_KEY, pref)
    } catch {
      /* ignore */
    }
    if (typeof window === 'undefined' || !window.matchMedia) return undefined
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => {
      // Only the 'system' mode reacts to OS flips; explicit light/dark wins.
      if (pref === 'system') applyTheme('system')
    }
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [pref])

  const set = useCallback((next) => {
    if (next !== 'light' && next !== 'dark' && next !== 'system') return
    setPref(next)
  }, [])

  // Derived value — what the user is actually seeing right now.
  const resolved = pref === 'system' ? (systemPrefersDark() ? 'dark' : 'light') : pref

  return { pref, resolved, set }
}