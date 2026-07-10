import { useState, useEffect, useId, useRef } from 'react'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
const YZ_LOGO_WHITE = '/yz_whitelogo.svg'
const YZ_LOGO_BLACK = '/yz_blacklogo.svg'
import { useNavigate } from 'react-router-dom'
import { Eye, EyeOff } from 'lucide-react'
import { useAuth } from '../hooks/useAuth.js'
import { Button } from '../components/ui/button.jsx'
import { Card, CardContent } from '../components/ui/card.jsx'
import { Input } from '../components/ui/input.jsx'
import { Label } from '../components/ui/label.jsx'
import { cn } from '../lib/utils.js'

/* ─── demo data ──────────────────────────────────────────────────────── */
const DEMO_USERS = [
  { email: 'aysenur@yukselenzeka.com',            name: 'Ayşenur Kanak',     role: 'Takım Lideri', initials: 'AY' },
  { email: 'aylin@yukselenzeka.com',              name: 'Aylin Ulu',          role: 'Tasarımcı',    initials: 'AU' },
  { email: 'feyza@yukselenzeka.com',              name: 'Feyza Küçükkurt',   role: 'Tasarımcı',    initials: 'FK' },
  { email: 'nur@yukselenzeka.com',                name: 'Nur Ekincioğlu',    role: 'Tasarımcı',    initials: 'NE' },
  { email: 'sumeyye.arslanturk@yukselenzeka.com', name: 'Sümeyye Arslantürk',role: 'Tasarımcı',    initials: 'SA' },
  { email: 'oktay@yukselenzeka.com',              name: 'Oktay Şahin',        role: 'Matbaa',       initials: 'OŞ' },
  { email: 'esra@yukselenzeka.com',               name: 'Esra Kılıç',     role: 'Satış Ekibi',  initials: 'EK' },
]
const DEMO_PASSWORD = '123456'

/* ─── Splash ─────────────────────────────────────────────────────────── */
function SplashScreen({ onDone }) {
  const reduce = useReducedMotion()
  useEffect(() => {
    if (reduce) { onDone(); return }
    const t = setTimeout(onDone, 2000)
    return () => clearTimeout(t)
  }, [onDone, reduce])
  if (reduce) return null
  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center bg-primary"
      role="presentation"
      exit={{ opacity: 0, transition: { duration: 0.6, ease: [0.4, 0, 0.2, 1] } }}
    >
      <motion.img
        src={YZ_LOGO_WHITE} alt="Yükselen Zeka"
        width={96} height={96}
        loading="eager" decoding="async"
        style={{ height: 96, width: 'auto' }}
        initial={{ opacity: 0, scale: 0.7, filter: 'blur(10px)' }}
        animate={{ opacity: 1, scale: 1,   filter: 'blur(0px)'  }}
        transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
      />
    </motion.div>
  )
}


/* ─── Login ──────────────────────────────────────────────────────────── */
export default function Login() {
  const { login, loading } = useAuth()
  const navigate = useNavigate()

  const [showSplash, setShowSplash] = useState(false)
  const [email, setEmail]           = useState('')
  const [password, setPassword]     = useState('')
  const [showPw, setShowPw]         = useState(false)
  const [error, setError]           = useState('')
  const [exiting, setExiting]       = useState(false)

  async function submit(mail, pass) {
    setError('')
    if (!mail.trim() || !pass) { setError('Lütfen e-posta ve şifrenizi girin.'); return }
    try   { await login(mail, pass); setExiting(true) }
    catch (err) { setError(err.message || 'Giriş yapılamadı. Lütfen tekrar deneyin.') }
  }

  function handleSubmit(e) { e.preventDefault(); submit(email, password) }
  function pick(u) { setEmail(u.email); setPassword(DEMO_PASSWORD); setError(''); submit(u.email, DEMO_PASSWORD) }

  return (
    <>
      <AnimatePresence>
        {showSplash && <SplashScreen key="splash" onDone={() => setShowSplash(false)} />}
      </AnimatePresence>

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
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                    aria-label={showPw ? 'Şifreyi gizle' : 'Şifreyi göster'}
                  >
                    {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {/* Remember + Forgot */}
              <div className="flex items-center justify-between">
                <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-600 select-none">
                  <input type="checkbox" className="h-4 w-4 rounded border-gray-300 accent-red-500" />
                  30 gün hatırla
                </label>
                <button type="button" className="text-sm font-medium text-red-500 hover:text-red-600 transition-colors">
                  Şifremi unuttum?
                </button>
              </div>

              {/* Submit */}
              <motion.button
                type="submit" disabled={loading || exiting}
                whileTap={{ scale: 0.97 }}
                className="mt-1 flex w-full items-center justify-center gap-2 rounded-lg bg-red-500 py-2.5 text-sm font-semibold text-white hover:bg-red-600 disabled:opacity-60 transition-colors"
              >
                {loading ? <Spinner /> : 'Giriş Yap'}
              </motion.button>
            </form>

            {/* Quick login */}
            <div className="mt-6">
              <div className="grid grid-cols-2 gap-2">
                {DEMO_USERS.map(u => (
                  <button
                    key={u.email} type="button" onClick={() => pick(u)}
                    className="flex items-center gap-2 rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 text-left hover:border-red-200 hover:bg-red-50 transition-colors"
                  >
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-red-500 text-xs font-bold text-white">
                      {u.initials}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-xs font-medium text-gray-800">{u.name}</span>
                      <span className="block truncate text-xs text-gray-400">{u.role}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>

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
