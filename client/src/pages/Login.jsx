import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
const YZ_LOGO_BLACK = '/yz_blacklogo.svg'
import { useNavigate, Link } from 'react-router-dom'
import { Mail, ArrowRight } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '../hooks/useAuth.js'

/**
 * Magic-link sign-in.
 *
 *   1. User enters their email.
 *   2. POST /api/auth/magic — server emails a 15-minute one-time link
 *      via Resend.
 *   3. The user clicks the link in their inbox, which lands them on
 *      /auth/magic?token=… — the server consumes the token, creates
 *      a Redis session, sets the yz_sid cookie, and 302-redirects
 *      to the dashboard.
 *   4. MagicCallback.jsx confirms the session via GET /api/auth/me
 *      and routes the user home.
 *
 * The dev panel is intentionally gone — local dev now uses the
 * server's /auth/dev-login endpoint (see useAuth.loginAsUser). If
 * you need to log in as a seed user without going through email,
 * call `useAuth().loginAsUser('u-aysenur')` from the browser
 * console.
 */
export default function Login() {
  const { login, loading } = useAuth()
  const navigate = useNavigate()

  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)
  const [exiting, setExiting] = useState(false)

  async function submit(mail) {
    setError('')
    if (!mail.trim()) { setError('Lütfen e-posta adresinizi girin.'); return }
    try {
      await login(mail.trim())
      setSent(true)
      toast.success('Giriş bağlantısı e-postana gönderildi. Lütfen gelen kutusunu kontrol et.')
    } catch (err) {
      setError(err.message || 'Giriş bağlantısı gönderilemedi. Lütfen tekrar deneyin.')
    }
  }

  function handleSubmit(e) {
    e.preventDefault()
    submit(email)
  }

  return (
    <>
      <motion.div
        className="flex min-h-full flex-col items-center justify-center bg-white px-8 py-12"
        animate={exiting
          ? { opacity: 0, x: 20, transition: { duration: 0.28 } }
          : { opacity: 1, x: 0 }
        }
      >
        <div className="mb-8">
          <img src={YZ_LOGO_BLACK} alt="Yükselen Zeka" className="h-10 w-auto" />
        </div>

        <div className="w-full max-w-sm">
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

          {sent ? (
            <div className="space-y-4 rounded-xl border bg-muted/30 p-5 text-center">
              <span className="mx-auto grid h-10 w-10 place-items-center rounded-full bg-primary/10 text-primary">
                <Mail className="h-5 w-5" />
              </span>
              <h1 className="text-base font-semibold">Gelen kutusunu kontrol et</h1>
              <p className="text-sm text-muted-foreground">
                <span className="font-medium text-foreground">{email}</span> adresine
                tek kullanımlık bir giriş bağlantısı gönderdik. 15 dakika içinde aç.
              </p>
              <button
                type="button"
                onClick={() => { setSent(false); setEmail(''); }}
                className="text-sm font-medium text-primary hover:underline"
              >
                Yanlış adres mi? Yeniden dene
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} noValidate className="space-y-5">
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-gray-700">E-posta</label>
                <div className="relative">
                  <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                  <input
                    type="email" autoComplete="email" value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="ornek@yukselenzeka.com"
                    className="block w-full rounded-lg border border-gray-200 bg-white pl-9 pr-3 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 outline-none transition focus:border-red-400 focus:ring-2 focus:ring-red-100"
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  Giriş bağlantısı e-postana gönderilecek. Şifre gerekmez.
                </p>
              </div>

              <motion.button
                type="submit" disabled={loading || exiting}
                whileTap={{ scale: 0.97 }}
                className="mt-1 flex w-full items-center justify-center gap-2 rounded-lg bg-red-500 py-2.5 text-sm font-semibold text-white hover:bg-red-600 disabled:opacity-60 transition-colors"
              >
                {loading ? <Spinner /> : <>Giriş bağlantısı gönder <ArrowRight className="h-4 w-4" /></>}
              </motion.button>
            </form>
          )}

          <p className="mt-6 text-center text-xs text-muted-foreground">
            Şifreni mi unuttun?{' '}
            <Link to="/forgot-password" className="font-medium text-primary hover:underline">
              Sıfırla
            </Link>
          </p>
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