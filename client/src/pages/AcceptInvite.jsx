import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowRight, BookOpen, Check, KeyRound } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

/**
 * Stand-alone page reached from an email invitation link.
 * For now (mock mode) it just validates the password length and bounces
 * to the login page — once the backend is wired, it will call
 * POST /api/auth/accept-invite with the token from the URL.
 */
export default function AcceptInvite() {
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')

  function handleSubmit(e) {
    e.preventDefault()
    if (password.length < 5) {
      setError('Şifre en az 5 karakter olmalı.')
      return
    }
    if (password !== confirm) {
      setError('Şifreler eşleşmiyor.')
      return
    }
    setError('')
    setDone(true)
    toast.success('Şifreniz belirlendi. Giriş yapabilirsiniz.')
    setTimeout(() => navigate('/login', { replace: true }), 1500)
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
            {token
              ? `Davet token'ı algılandı. Hesabınızı aktifleştirmek için bir şifre belirleyin.`
              : 'Demo mod: davet linki olmadan da şifre belirleyebilirsiniz.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {done ? (
            <div className="space-y-3 rounded-lg border bg-emerald-50 p-4 text-center">
              <span className="mx-auto grid h-10 w-10 place-items-center rounded-full bg-emerald-100 text-emerald-700">
                <Check className="h-5 w-5" />
              </span>
              <p className="text-sm font-medium text-emerald-700">Şifre belirlendi!</p>
              <p className="text-xs text-muted-foreground">Giriş sayfasına yönlendiriliyorsunuz…</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                  {error}
                </div>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="pw">Yeni Şifre</Label>
                <Input
                  id="pw"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pw2">Şifre (Tekrar)</Label>
                <Input
                  id="pw2"
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                />
              </div>
              <Button type="submit" className="w-full" size="lg">
                <KeyRound className="h-4 w-4" />
                Şifreyi Belirle
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
