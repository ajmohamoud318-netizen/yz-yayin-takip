import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth.js'

/**
 * Login screen — Turkish UI, clean & professional.
 * Backend not built yet: auth runs against the mock layer in api.js.
 * Sample accounts (şifre: 123456):
 *   aysenur@yukselenzeka.com  (Takım Lideri)
 *   elif@yukselenzeka.com     (Tasarımcı)
 *   oktay@yukselenzeka.com    (Matbaa)
 */
export default function Login() {
  const { login, loading } = useAuth()
  const navigate = useNavigate()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    if (!email.trim() || !password) {
      setError('Lütfen e-posta ve şifrenizi girin.')
      return
    }
    try {
      await login(email, password)
      navigate('/', { replace: true })
    } catch (err) {
      setError(err.message || 'Giriş yapılamadı. Lütfen tekrar deneyin.')
    }
  }

  return (
    <div className="min-h-full flex flex-col lg:flex-row">
      {/* Left brand panel */}
      <div className="relative hidden lg:flex lg:w-1/2 bg-brand-700 text-white overflow-hidden">
        <div className="absolute inset-0 opacity-20">
          <div className="absolute -top-24 -left-24 h-96 w-96 rounded-full bg-brand-400 blur-3xl" />
          <div className="absolute bottom-0 right-0 h-96 w-96 rounded-full bg-brand-900 blur-3xl" />
        </div>
        <div className="relative z-10 flex flex-col justify-between p-12 xl:p-16">
          <div className="flex items-center gap-3">
            <Logo className="h-10 w-10" />
            <span className="text-lg font-semibold tracking-tight">YZ Yayın Takip</span>
          </div>
          <div className="max-w-md">
            <h1 className="text-3xl xl:text-4xl font-bold leading-tight">
              Tüm yayın sürecini tek ekrandan takip edin.
            </h1>
            <p className="mt-4 text-brand-100 leading-relaxed">
              Projeler, tasarımcılar ve aşamalar gerçek zamanlı olarak bir arada.
              Tasarımdan satışa kadar her adım kontrol altında.
            </p>
          </div>
          <p className="text-sm text-brand-200">
            Yükselen Zeka · İç Yayın Takip Sistemi
          </p>
        </div>
      </div>

      {/* Right form panel */}
      <div className="flex flex-1 items-center justify-center px-6 py-12 lg:w-1/2">
        <div className="w-full max-w-sm">
          {/* Mobile logo */}
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <Logo className="h-9 w-9 text-brand-600" />
            <span className="text-lg font-semibold text-slate-900">YZ Yayın Takip</span>
          </div>

          <h2 className="text-2xl font-bold text-slate-900">Giriş Yap</h2>
          <p className="mt-1 text-sm text-slate-500">
            Hesabınıza erişmek için bilgilerinizi girin.
          </p>

          <form onSubmit={handleSubmit} className="mt-8 space-y-5" noValidate>
            {error && (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700"
              >
                <svg className="mt-0.5 h-4 w-4 shrink-0" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9 9a1 1 0 012 0v4a1 1 0 11-2 0V9zm1-4a1 1 0 100 2 1 1 0 000-2z" clipRule="evenodd" />
                </svg>
                <span>{error}</span>
              </div>
            )}

            <div>
              <label htmlFor="email" className="block text-sm font-medium text-slate-700">
                E-posta
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="ornek@yukselenzeka.com"
                className="mt-1.5 block w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-slate-900 placeholder:text-slate-400 shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-slate-700">
                Şifre
              </label>
              <div className="relative mt-1.5">
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="block w-full rounded-lg border border-slate-300 px-3.5 py-2.5 pr-11 text-slate-900 placeholder:text-slate-400 shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((s) => !s)}
                  className="absolute inset-y-0 right-0 flex items-center px-3 text-slate-400 hover:text-slate-600"
                  aria-label={showPassword ? 'Şifreyi gizle' : 'Şifreyi göster'}
                >
                  {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 text-sm text-slate-600">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500/30"
                />
                Beni hatırla
              </label>
              <button
                type="button"
                className="text-sm font-medium text-brand-600 hover:text-brand-700"
              >
                Şifremi unuttum
              </button>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-500/40 disabled:cursor-not-allowed disabled:opacity-60"
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

          {/* Demo helper — remove once the real backend is connected. */}
          <div className="mt-8 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-500">
            <p className="font-medium text-slate-600">Demo hesapları (şifre: 123456)</p>
            <p className="mt-1">aysenur@yukselenzeka.com · Takım Lideri</p>
            <p>elif@yukselenzeka.com · Tasarımcı</p>
            <p>oktay@yukselenzeka.com · Matbaa</p>
          </div>
        </div>
      </div>
    </div>
  )
}

/* --- small inline icons (keep the page dependency-free) --- */
function Logo({ className = '' }) {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="currentColor" className="text-brand-600" />
      <path d="M9 22V10h3l4 6 4-6h3v12h-3v-7l-4 6-4-6v7H9z" fill="white" />
    </svg>
  )
}
function Eye({ className = '' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}
function EyeOff({ className = '' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 3l18 18M10.6 10.6a3 3 0 004.2 4.2M9.9 4.6A9.8 9.8 0 0112 5c6.5 0 10 7 10 7a17 17 0 01-3.4 4.3M6.6 6.6A17 17 0 002 12s3.5 7 10 7a9.7 9.7 0 004-.9" />
    </svg>
  )
}
