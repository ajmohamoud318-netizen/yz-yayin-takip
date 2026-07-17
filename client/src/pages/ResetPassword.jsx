import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, BookOpen, Check, Eye, EyeOff, KeyRound, AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

import api from '@/api.js'

/**
 * Reset-password page.
 *
 * Reads `?token=...` from the URL. On submit:
 *   1. POST /auth/reset-password with { token, password }.
 *   2. The server bcrypt-hashes the password, marks the token used,
 *      and returns a session token. We stash it and bounce to the
 *      dashboard — same auto-login UX as AcceptInvite.
 *
 * The token in the URL is what the user clicked from the email. If
 * there's no token, render a "link missing" panel that sends them
 * back to /forgot-password.
 */
export default function ResetPassword() {
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  const navigate = useNavigate()

  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  // Guard: if there's no token in the URL, don't render the form at all.
  useEffect(() => {
    if (!token) setError('Bu bağlantıda sıfırlama token\'ı yok. Lütfen e-postandaki bağlantıya tıkla.')
  }, [token])

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    if (!token) return
    if (password.length < 8) {
      setError('Yeni şifre en az 8 karakter olmalı.')
      return
    }
    if (password !== confirm) {
      setError('Şifreler eşleşmiyor.')
      return
    }
    setSubmitting(true)
    try {
      await api.resetPassword(token, password)
      setDone(true)
      toast.success('Şifren sıfırlandı. Giriş yapıldı.')
      setTimeout(() => navigate('/', { replace: true }), 1200)
    } catch (err) {
      // 410 → token expired or used; 404 → unknown token. Both cases
      // get a friendly "ask for a new link" message.
      const status = err?.status
      if (status === 410 || status === 404) {
        setError('Bu sıfırlama bağlantısının süresi dolmuş ya da kullanılmış. Yenisini iste.')
      } else {
        setError(err?.message || 'Şifre sıfırlanamadı. Lütfen tekrar deneyin.')
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="grid min-h-screen place-items-center bg-muted/30 px-4 py-10">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-3 text-center">
          <span className="mx-auto grid h-10 w-10 place-items-center rounded-lg bg-primary text-primary-foreground">
            <BookOpen className="h-5 w-5" />
          </span>
          <CardTitle className="text-xl">Yeni Şifre Belirle</CardTitle>
          <CardDescription>
            Yeni şifreni gir. Şifre sıfırlandıktan sonra otomatik olarak giriş yapacaksın.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {done ? (
            <div className="space-y-3 rounded-lg border bg-emerald-50 p-4 text-center">
              <span className="mx-auto grid h-10 w-10 place-items-center rounded-full bg-emerald-100 text-emerald-700">
                <Check className="h-5 w-5" />
              </span>
              <p className="text-sm font-medium text-emerald-700">Şifren sıfırlandı!</p>
              <p className="text-xs text-muted-foreground">Uygulamaya yönlendiriliyorsun…</p>
            </div>
          ) : !token ? (
            <div className="space-y-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-center">
              <span className="mx-auto grid h-10 w-10 place-items-center rounded-full bg-destructive/10 text-destructive">
                <AlertTriangle className="h-5 w-5" />
              </span>
              <p className="text-sm font-medium text-destructive">
                Bu bağlantıda sıfırlama token&apos;ı yok.
              </p>
              <p className="text-xs text-muted-foreground">
                E-postandaki sıfırlama bağlantısına tıklamalısın.
              </p>
              <Button asChild variant="outline" size="sm" className="w-full">
                <Link to="/forgot-password">Yeni sıfırlama bağlantısı iste</Link>
              </Button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                  {error}
                </div>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="reset-password">Yeni şifre</Label>
                <div className="relative">
                  <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="reset-password"
                    type={showPw ? 'text' : 'password'}
                    autoComplete="new-password"
                    placeholder="En az 8 karakter"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="pl-9 pr-10"
                    required
                    minLength={8}
                    disabled={submitting}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground hover:bg-muted"
                    aria-label={showPw ? 'Şifreyi gizle' : 'Şifreyi göster'}
                  >
                    {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="reset-confirm">Yeni şifre (tekrar)</Label>
                <Input
                  id="reset-confirm"
                  type={showPw ? 'text' : 'password'}
                  autoComplete="new-password"
                  placeholder="Aynı şifreyi tekrar gir"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                  minLength={8}
                  disabled={submitting}
                />
              </div>

              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting ? 'Sıfırlanıyor…' : 'Yeni şifreyi kaydet'}
              </Button>

              <div className="text-center text-sm text-muted-foreground">
                <Link to="/login" className="hover:text-primary">
                  <ArrowLeft className="mr-1 inline h-3 w-3" />
                  Giriş sayfasına dön
                </Link>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  )
}