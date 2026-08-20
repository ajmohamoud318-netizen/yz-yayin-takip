import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowRight, BookOpen, Check, KeyRound, Mail, AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

import api from '@/api.js'
import { setAuthToken } from '@/infrastructure/http/client.js'

const ROLE_LABEL = {
  team_leader: 'Takım Lideri',
  designer: 'Tasarımcı',
  printer: 'Matbaa',
  satis: 'Satış Ekibi',
}

/**
 * Stand-alone page reached from an email invitation link.
 *
 * Flow:
 *   1. Read `?token=...` from the URL.
 *   2. Call `api.previewInvite(token)` to render the invitee's name +
 *      role at the top of the form.
 *   3. On submit, call `api.acceptInvite(token, password)` which sets
 *      the password server-side and returns a session token. We stash
 *      the token and bounce to the dashboard — no second login step.
 *
 * If there's no token in the URL the form is still rendered but submit
 * will reject — the invitee must arrive from the email link.
 */
export default function AcceptInvite() {
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [preview, setPreview] = useState(null)
  const [previewError, setPreviewError] = useState(null)

  useEffect(() => {
    if (!token) return
    let cancelled = false
    api.previewInvite(token)
      .then((data) => { if (!cancelled) setPreview(data) })
      .catch((err) => {
        if (cancelled) return
        setPreviewError(err?.message || 'Davet linki geçersiz veya süresi dolmuş.')
      })
    return () => { cancelled = true }
  }, [token])

  async function handleSubmit(e) {
    e.preventDefault()
    if (!token) {
      setError('Davet linki eksik. Lütfen e-postanızdaki linke tıklayın.')
      return
    }
    if (password.length < 8) {
      setError('Şifre en az 8 karakter olmalı.')
      return
    }
    if (password !== confirm) {
      setError('Şifreler eşleşmiyor.')
      return
    }
    setError('')
    setSubmitting(true)
    try {
      const res = await api.acceptInvite(token, password)
      if (res?.token) setAuthToken(res.token)
      setDone(true)
      toast.success('Şifreniz belirlendi. Hoş geldiniz!')
      setTimeout(() => navigate('/', { replace: true }), 1200)
    } catch (err) {
      setError(err?.message || 'Şifre belirlenemedi. Lütfen tekrar deneyin.')
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
          <CardTitle className="text-xl">Davet Kabul</CardTitle>
          <CardDescription>
            {preview?.name
              ? `${preview.name} için şifre belirleyin (${ROLE_LABEL[preview.role] ?? preview.role}).`
              : token
                ? 'Hesabınızı aktifleştirmek için bir şifre belirleyin.'
                : 'Davet linki bulunamadı. Lütfen e-postanızdaki davet bağlantısını kullanın.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {previewError ? (
            <div className="space-y-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-center">
              <span className="mx-auto grid h-10 w-10 place-items-center rounded-full bg-destructive/10 text-destructive">
                <AlertTriangle className="h-5 w-5" />
              </span>
              <p className="text-sm font-medium text-destructive">{previewError}</p>
              <p className="text-xs text-muted-foreground">
                Yeni bir davet için takım liderinizle iletişime geçin.
              </p>
              <Button asChild variant="outline" size="sm" className="w-full">
                <Link to="/login">Giriş sayfasına dönün</Link>
              </Button>
            </div>
          ) : done ? (
            <div className="space-y-3 rounded-lg border bg-emerald-50 p-4 text-center">
              <span className="mx-auto grid h-10 w-10 place-items-center rounded-full bg-emerald-100 text-emerald-700">
                <Check className="h-5 w-5" />
              </span>
              <p className="text-sm font-medium text-emerald-700">Şifre belirlendi!</p>
              <p className="text-xs text-muted-foreground">Uygulamaya yönlendiriliyorsunuz…</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                  {error}
                </div>
              )}
              {preview?.email && (
                <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                  <Mail className="h-4 w-4" />
                  <span>{preview.email}</span>
                </div>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="pw">Yeni Şifre</Label>
                <Input
                  id="pw"
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
                <p className="text-xs text-muted-foreground">En az 8 karakter.</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pw2">Şifre (Tekrar)</Label>
                <Input
                  id="pw2"
                  type="password"
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                />
              </div>
              <Button type="submit" className="w-full" size="lg" disabled={submitting}>
                <KeyRound className="h-4 w-4" />
                {submitting ? 'Belirleniyor…' : 'Şifreyi Belirleyin'}
                <ArrowRight className="h-4 w-4" />
              </Button>
            </form>
          )}

          <p className="mt-6 text-center text-xs text-muted-foreground">
            Zaten hesabınız var mı?{' '}
            <Link to="/login" className="font-medium text-primary hover:underline">
              Giriş yapın
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
