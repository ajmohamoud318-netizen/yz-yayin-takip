import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
const YZ_LOGO_BLACK = '/yz_blacklogo.svg'
import { useNavigate, Link } from 'react-router-dom'
import { Eye, EyeOff } from 'lucide-react'
import { useAuth } from '../hooks/useAuth.js'

/* ─── Login ──────────────────────────────────────────────────────────── */
// The "30 gün hatırla" tick — and the e-mail it was used with — are
// remembered across visits. Without this a refresh reset the box to
// unchecked and, after a logout, the form came back completely empty even
// for users who had opted in. The password is deliberately NOT stored:
// plain-text passwords in localStorage are readable by anyone at the
// machine (and by any injected script); the browser's own password
// manager handles that part via the autocomplete attributes.
const REMEMBER_PREF_KEY  = 'yz_remember_pref'
const REMEMBER_EMAIL_KEY = 'yz_remember_email'

function loadRememberPref() {
  try { return localStorage.getItem(REMEMBER_PREF_KEY) === '1' } catch { return false }
}
function loadRememberedEmail() {
  try { return localStorage.getItem(REMEMBER_EMAIL_KEY) ?? '' } catch { return '' }
}

export default function Login() {
  const { login, loading, isAuthenticated } = useAuth()
  const navigate = useNavigate()

  const [email, setEmail]           = useState(loadRememberedEmail)
  const [password, setPassword]     = useState('')
  const [showPw, setShowPw]         = useState(false)
  const [remember, setRemember]     = useState(loadRememberPref)
  const [error, setError]           = useState('')
  const [exiting, setExiting]       = useState(false)

  /**
   * Already signed in? Don't sit on the login form.
   *
   * Normally nobody reaches /login with a live session. But the session check
   * has a deadline now (BOOTSTRAP_MAX_MS): if the API is slow to answer on a
   * cold PWA launch, <RequireAuth> stops waiting and sends the user here while
   * the check is still in flight. When it lands a moment later the user IS
   * authenticated — and without this they'd be staring at a login form,
   * retyping a password they didn't need. `exiting` is excluded so this never
   * races the post-login exit animation, which does its own navigate.
   */
  useEffect(() => {
    if (isAuthenticated && !exiting) navigate('/', { replace: true })
  }, [isAuthenticated, exiting, navigate])

  function toggleRemember(checked) {
    setRemember(checked)
    try {
      localStorage.setItem(REMEMBER_PREF_KEY, checked ? '1' : '0')
      // Opting out also forgets the stored e-mail.
      if (!checked) localStorage.removeItem(REMEMBER_EMAIL_KEY)
    } catch { /* ignore */ }
  }

  async function submit(mail, pass) {
    setError('')
    if (!mail.trim() || !pass) { setError('Lütfen e-posta ve şifrenizi girin.'); return }
    try {
      await login(mail, pass, { remember })
      try {
        if (remember) localStorage.setItem(REMEMBER_EMAIL_KEY, mail.trim())
        else localStorage.removeItem(REMEMBER_EMAIL_KEY)
      } catch { /* ignore */ }
      setExiting(true)
    }
    catch (err) { setError(err.message || 'Giriş yapılamadı. Lütfen tekrar deneyin.') }
  }

  function handleSubmit(e) { e.preventDefault(); submit(email, password) }

  return (
    <>
      <motion.div
        className="flex min-h-full flex-col items-center justify-center bg-white px-8 py-12"
        animate={exiting
          ? { opacity: 0, x: 20, transition: { duration: 0.28 } }
          : { opacity: 1, x: 0 }
        }
        onAnimationComplete={() => { if (exiting) navigate('/', { replace: true }) }}
      >
        {/* Logo */}
        <div className="mb-8">
          <img src={YZ_LOGO_BLACK} alt="Yükselen Zeka" className="h-10 w-auto" />
        </div>

          <div className="w-full max-w-sm">

            {/* Error */}
            <AnimatePresence>
              {error && (
                <motion.div
                  key="err" role="alert"
                  className="mb-5 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700"
                  initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                >
                  {error}
                </motion.div>
              )}
            </AnimatePresence>

            <form onSubmit={handleSubmit} noValidate className="space-y-5">
              {/* Email */}
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-gray-700">E-posta</label>
                <input
                  type="email" autoComplete="email" value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="ornek@yukselenzeka.com"
                  className="block w-full rounded-lg border border-gray-200 bg-white px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 outline-none transition focus:border-red-400 focus:ring-2 focus:ring-red-100"
                />
              </div>

              {/* Password */}
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-gray-700">Şifre</label>
                <div className="relative">
                  <input
                    type={showPw ? 'text' : 'password'} autoComplete="current-password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="••••••"
                    className="block w-full rounded-lg border border-gray-200 bg-white px-3.5 py-2.5 pr-10 text-sm text-gray-900 placeholder:text-gray-400 outline-none transition focus:border-red-400 focus:ring-2 focus:ring-red-100"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw(v => !v)}
                    className="absolute right-1 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-md text-gray-400 transition-colors hover:text-gray-600"
                    aria-label={showPw ? 'Şifreyi gizleyin' : 'Şifreyi gösterin'}
                  >
                    {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {/* Remember + Forgot */}
              <div className="flex items-center justify-between">
                <label htmlFor="remember" className="flex cursor-pointer items-center gap-2 text-sm text-gray-600 select-none">
                  <input
                    id="remember"
                    type="checkbox"
                    checked={remember}
                    onChange={(e) => toggleRemember(e.target.checked)}
                    className="h-4 w-4 rounded border-gray-300 accent-red-500"
                  />
                  30 gün hatırlayın
                </label>
                <Link
                  to="/forgot-password"
                  className="text-sm font-medium text-red-500 hover:text-red-600 transition-colors"
                >
                  Şifremi unuttum?
                </Link>
              </div>

              {/* Submit */}
              <motion.button
                type="submit" disabled={loading || exiting}
                whileTap={{ scale: 0.97 }}
                className="mt-1 flex w-full items-center justify-center gap-2 rounded-lg bg-red-500 py-2.5 text-sm font-semibold text-white hover:bg-red-600 disabled:opacity-60 transition-colors"
              >
                {loading ? <Spinner /> : 'Giriş Yapın'}
              </motion.button>
            </form>

          </div>
        </motion.div>
    </>
  )
}

/* ─── helpers ────────────────────────────────────────────────────────── */
function Spinner() {
  return (
    <svg className="h-4 w-4 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  )
}
