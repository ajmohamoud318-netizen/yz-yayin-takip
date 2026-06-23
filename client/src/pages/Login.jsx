import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Eye, EyeOff } from 'lucide-react'
import { useAuth } from '../hooks/useAuth.js'
import { Button } from '../components/ui/button.jsx'

/**
 * Login screen — glassmorphism design, Turkish UI.
 * A frosted-glass card floats over a soft rose/violet gradient with blurred
 * color blobs that refract through the glass. Backend not built yet: auth runs
 * against the mock layer in api.js. Quick-login buttons autofill credentials
 * for each demo account (şifre: 123456).
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
  const [showPassword, setShowPassword] = useState(false)
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
    <div className="relative flex min-h-full items-center justify-center overflow-hidden bg-gradient-to-br from-teal-100 via-cyan-100 to-emerald-200 px-4 py-12">
      {/* Blurred color blobs — the glass refracts these */}
      <div className="pointer-events-none absolute -top-24 -left-24 h-96 w-96 rounded-full bg-teal-400/40 blur-3xl" />
      <div className="pointer-events-none absolute top-1/3 -right-24 h-96 w-96 rounded-full bg-cyan-400/40 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-32 left-1/4 h-96 w-96 rounded-full bg-emerald-300/40 blur-3xl" />

      <div className="relative z-10 w-full max-w-md">
        {/* Frosted glass card */}
        <div className="rounded-3xl border border-white/40 bg-white/55 px-8 py-10 shadow-2xl shadow-teal-900/10 backdrop-blur-2xl">
          <div className="mb-8 text-center">
            <h1 className="text-2xl text-foreground">YZ Yayın Takip</h1>
            <p className="mt-1 text-sm text-muted-foreground">Hesabınıza giriş yapın</p>
          </div>

          {error && (
            <div
              role="alert"
              className="mb-5 flex items-start gap-2 rounded-xl border border-red-300/60 bg-red-50/80 px-3 py-2.5 text-sm text-red-700 backdrop-blur-sm"
            >
              <svg className="mt-0.5 h-4 w-4 shrink-0" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9 9a1 1 0 012 0v4a1 1 0 11-2 0V9zm1-4a1 1 0 100 2 1 1 0 000-2z" clipRule="evenodd" />
              </svg>
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5" noValidate>
            {/* Email */}
            <div className="space-y-1.5">
              <label htmlFor="login-email" className="text-sm font-medium text-foreground">
                E-posta
              </label>
              <div className="flex items-center gap-3 rounded-xl border border-white/50 bg-white/40 px-3.5 transition-colors focus-within:border-ring focus-within:bg-white/60">
                <UserIcon className="h-5 w-5 shrink-0 text-muted-foreground" />
                <input
                  id="login-email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="ornek@yukselenzeka.com"
                  className="h-11 w-full bg-transparent text-foreground placeholder:text-muted-foreground/70 focus:outline-none"
                />
              </div>
            </div>

            {/* Password */}
            <div className="space-y-1.5">
              <label htmlFor="login-password" className="text-sm font-medium text-foreground">
                Şifre
              </label>
              <div className="flex items-center gap-3 rounded-xl border border-white/50 bg-white/40 px-3.5 transition-colors focus-within:border-ring focus-within:bg-white/60">
                <LockIcon className="h-5 w-5 shrink-0 text-muted-foreground" />
                <input
                  id="login-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••"
                  className="h-11 w-full bg-transparent text-foreground placeholder:text-muted-foreground/70 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Şifreyi gizle' : 'Şifreyi göster'}
                  aria-pressed={showPassword}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-white/50 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <Button type="submit" size="lg" loading={loading} className="w-full">
              {loading ? 'Giriş yapılıyor...' : 'Giriş Yap'}
            </Button>
          </form>

          {/* Quick-login user chips */}
          <div className="mt-8">
            <p className="mb-3 text-center text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Hızlı giriş
            </p>
            <div className="grid grid-cols-2 gap-3">
              {DEMO_USERS.map((u) => (
                <button
                  key={u.email}
                  type="button"
                  onClick={() => pick(u)}
                  className="flex items-center gap-3 rounded-2xl border border-white/40 bg-white/30 px-3 py-2.5 text-left backdrop-blur-sm transition-colors hover:border-white/60 hover:bg-white/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground shadow-sm">
                    {u.initials}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-foreground">{u.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">{u.role}</span>
                  </span>
                </button>
              ))}
            </div>
            <p className="mt-3 text-center text-xs text-muted-foreground">
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
