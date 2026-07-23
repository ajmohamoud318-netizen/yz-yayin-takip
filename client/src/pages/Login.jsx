import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
const YZ_LOGO_BLACK = '/yz_blacklogo.svg'
import { useNavigate, Link } from 'react-router-dom'
import { Eye, EyeOff } from 'lucide-react'
import { useAuth } from '../hooks/useAuth.js'

/* ─── Login ──────────────────────────────────────────────────────────── */
export default function Login() {
  const { login, loading } = useAuth()
  const navigate = useNavigate()

  const [email, setEmail]           = useState('')
  const [password, setPassword]     = useState('')
  const [showPw, setShowPw]         = useState(false)
  const [remember, setRemember]     = useState(false)
  const [error, setError]           = useState('')
  const [exiting, setExiting]       = useState(false)

  async function submit(mail, pass) {
    setError('')
    if (!mail.trim() || !pass) { setError('Lütfen e-posta ve şifrenizi girin.'); return }
    try   { await login(mail, pass, { remember }); setExiting(true) }
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
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                    aria-label={showPw ? 'Şifreyi gizle' : 'Şifreyi göster'}
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
                    onChange={(e) => setRemember(e.target.checked)}
                    className="h-4 w-4 rounded border-gray-300 accent-red-500"
                  />
                  30 gün hatırla
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
                {loading ? <Spinner /> : 'Giriş Yap'}
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
