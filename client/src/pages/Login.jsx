import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth.js'

/**
 * Login screen — pink card design, Turkish UI.
 * Backend not built yet: auth runs against the mock layer in api.js.
 * Quick-login buttons autofill credentials for each demo account (şifre: 123456).
 */
const DEMO_USERS = [
  { email: 'aysenur@yukselenzeka.com', name: 'Ayşenur Kanak', role: 'Takım Lideri', initials: 'AY' },
  { email: 'aylin@yukselenzeka.com', name: 'Aylin Ulu', role: 'Tasarımcı', initials: 'AU' },
  { email: 'feyza@yukselenzeka.com', name: 'Feyza Küçükkurt', role: 'Tasarımcı', initials: 'FK' },
  { email: 'nur@yukselenzeka.com', name: 'Nur Ekincioğlu', role: 'Tasarımcı', initials: 'NE' },
  { email: 'sumeyye.arslanturk@yukselenzeka.com', name: 'Sümeyye Arslantürk', role: 'Tasarımcı', initials: 'SA' },
  { email: 'oktay@yukselenzeka.com', name: 'Oktay Şahin', role: 'Matbaa', initials: 'OŞ' },
  { email: 'esra@yukselenzeka.com', name: 'Esra Kılıçkan', role: 'Satış Ekibi', initials: 'EK' },
]
const DEMO_PASSWORD = '123456'

export default function Login() {
  const { login, loading } = useAuth()
  const navigate = useNavigate()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  async function submit(mail, pass) {
    setError('')
    if (!mail.trim() || !pass) {
      setError('Lütfen e-posta ve şifrenizi girin.')
      return
    }
    try {
      await login(mail, pass)
      navigate('/', { replace: true })
    } catch (err) {
      setError(err.message || 'Giriş yapılamadı. Lütfen tekrar deneyin.')
    }
  }

  function handleSubmit(e) {
    e.preventDefault()
    submit(email, password)
  }

  function pick(user) {
    setEmail(user.email)
    setPassword(DEMO_PASSWORD)
    setError('')
    submit(user.email, DEMO_PASSWORD)
  }

  return (
    <div className="min-h-full flex items-center justify-center bg-gradient-to-br from-pink-100 via-rose-50 to-pink-200 px-4 py-12">
      <div className="absolute -top-20 -left-20 h-80 w-80 rounded-full bg-pink-300/30 blur-3xl" />
      <div className="absolute bottom-0 right-0 h-80 w-80 rounded-full bg-rose-300/30 blur-3xl" />

      <div className="relative z-10 w-full max-w-md">
        {/* Card */}
        <div className="rounded-3xl bg-white px-8 py-10 shadow-xl shadow-rose-200/50">
          <div className="mb-8 text-center">
            <h1 className="text-2xl font-bold text-slate-800">YZ Yayın Takip</h1>
            <p className="mt-1 text-sm text-slate-400">Hesabınıza giriş yapın</p>
          </div>

          {error && (
            <div
              role="alert"
              className="mb-5 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700"
            >
              <svg className="mt-0.5 h-4 w-4 shrink-0" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9 9a1 1 0 012 0v4a1 1 0 11-2 0V9zm1-4a1 1 0 100 2 1 1 0 000-2z" clipRule="evenodd" />
              </svg>
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-6" noValidate>
            {/* Username / email */}
            <div className="flex items-center gap-3 border-b border-slate-200 pb-2 focus-within:border-rose-400">
              <UserIcon className="h-5 w-5 shrink-0 text-slate-400" />
              <input
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="E-posta"
                className="w-full bg-transparent text-slate-700 placeholder:text-slate-400 focus:outline-none"
              />
            </div>

            {/* Password */}
            <div className="flex items-center gap-3 border-b border-slate-200 pb-2 focus-within:border-rose-400">
              <LockIcon className="h-5 w-5 shrink-0 text-slate-400" />
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Şifre"
                className="w-full bg-transparent text-slate-700 placeholder:text-slate-400 focus:outline-none"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="flex w-full items-center justify-center gap-2 rounded-full bg-gradient-to-r from-rose-400 to-pink-500 px-4 py-3 font-semibold text-white shadow-md shadow-rose-300/50 transition hover:from-rose-500 hover:to-pink-600 focus:outline-none focus:ring-2 focus:ring-rose-400/40 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading && (
                <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                </svg>
              )}
              {loading ? 'Giriş yapılıyor...' : 'Giriş Yap'}
            </button>
          </form>

          {/* Quick-login user chips */}
          <div className="mt-8">
            <p className="mb-3 text-center text-xs font-medium uppercase tracking-wide text-slate-400">
              Hızlı giriş
            </p>
            <div className="grid grid-cols-2 gap-3">
              {DEMO_USERS.map((u) => (
                <button
                  key={u.email}
                  type="button"
                  onClick={() => pick(u)}
                  className="flex items-center gap-3 rounded-2xl border border-slate-100 bg-rose-50/50 px-3 py-2.5 text-left transition hover:border-rose-200 hover:bg-rose-50 focus:outline-none focus:ring-2 focus:ring-rose-300/50"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-rose-400 to-pink-500 text-xs font-bold text-white">
                    {u.initials}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-slate-700">{u.name}</span>
                    <span className="block truncate text-xs text-slate-400">{u.role}</span>
                  </span>
                </button>
              ))}
            </div>
            <p className="mt-3 text-center text-xs text-slate-400">
              Bir kullanıcıya tıklayın, otomatik giriş yapılır.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

/* --- inline icons (keep the page dependency-free) --- */
function UserIcon({ className = '' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21v-1a6 6 0 016-6h4a6 6 0 016 6v1" />
    </svg>
  )
}
function LockIcon({ className = '' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 018 0v4" />
    </svg>
  )
}
