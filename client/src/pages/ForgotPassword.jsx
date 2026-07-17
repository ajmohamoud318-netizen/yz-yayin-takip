import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, BookOpen, Check, KeyRound, Mail } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

import api from '@/api.js'

/**
 * Forgot-password page.
 *
 * Single email field. On submit:
 *   1. POST /auth/forgot-password with the email.
 *   2. The server always returns 200 — even when the email isn't in the
 *      system — so we never leak which addresses exist.
 *   3. Show the success state with a green check + a "check your inbox"
 *      hint, regardless of whether the address was actually registered.
 *
 * A real outbound email only goes out if the address matched an active
 * user. The success screen's copy doesn't claim otherwise.
 */
export default function ForgotPassword() {
  const [email, setEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!email.trim()) {
      toast.error('Lütfen e-posta adresini gir.')
      return
    }
    setSubmitting(true)
    try {
      await api.forgotPassword(email.trim())
      setDone(true)
      toast.success('Sıfırlama bağlantısı gönderildi.')
    } catch (err) {
      // The server is supposed to always return 200, so a real failure
      // here means a network error or a 429 rate limit. Show the user
      // something useful either way.
      toast.error(err?.message || 'İstek gönderilemedi. Lütfen tekrar deneyin.')
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
          <CardTitle className="text-xl">Şifremi Unuttum</CardTitle>
          <CardDescription>
            Hesabınla ilişkili e-posta adresini gir. Sana şifre sıfırlama bağlantısı gönderelim.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {done ? (
            <div className="space-y-3 rounded-lg border bg-emerald-50 p-4 text-center">
              <span className="mx-auto grid h-10 w-10 place-items-center rounded-full bg-emerald-100 text-emerald-700">
                <Check className="h-5 w-5" />
              </span>
              <p className="text-sm font-medium text-emerald-700">Sıfırlama bağlantısı gönderildi</p>
              <p className="text-xs text-muted-foreground">
                Eğer <span className="font-medium">{email}</span> adresi sistemde kayıtlıysa, şifre sıfırlama bağlantısı gönderildi.
                Lütfen gelen kutunu kontrol et. Bağlantı 1 saat geçerlidir.
              </p>
              <div className="flex flex-col gap-2 pt-2">
                <Button asChild variant="outline" size="sm">
                  <Link to="/login">
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    Giriş sayfasına dön
                  </Link>
                </Button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="forgot-email">E-posta</Label>
                <div className="relative">
                  <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="forgot-email"
                    type="email"
                    autoComplete="email"
                    placeholder="ornek@yayin.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="pl-9"
                    required
                    disabled={submitting}
                  />
                </div>
              </div>

              <Button type="submit" className="w-full" disabled={submitting}>
                <KeyRound className="mr-2 h-4 w-4" />
                {submitting ? 'Gönderiliyor…' : 'Sıfırlama bağlantısı gönder'}
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