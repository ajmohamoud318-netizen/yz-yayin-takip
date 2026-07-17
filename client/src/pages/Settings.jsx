import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Check, Eye, EyeOff, KeyRound, LogOut, User } from 'lucide-react'
import { toast } from 'sonner'

import { useAuth } from '@/hooks/useAuth'

import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import api, { ROLE_LABELS } from '@/api'
import { initials } from '@/lib/utils'
import { cn } from '@/lib/utils'

export default function Settings() {
  const { user, logout } = useAuth()

  const navigate = useNavigate()

  // Change-password form state
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [changing, setChanging] = useState(false)
  const [pwError, setPwError] = useState('')
  const [pwDone, setPwDone] = useState(false)

  async function handleChangePassword(e) {
    e.preventDefault()
    setPwError('')
    if (!currentPassword) {
      setPwError('Mevcut şifreni gir.')
      return
    }
    if (newPassword.length < 8) {
      setPwError('Yeni şifre en az 8 karakter olmalı.')
      return
    }
    if (newPassword !== confirmPassword) {
      setPwError('Yeni şifreler eşleşmiyor.')
      return
    }
    if (newPassword === currentPassword) {
      setPwError('Yeni şifre mevcut şifreden farklı olmalı.')
      return
    }
    setChanging(true)
    try {
      await api.changePassword(currentPassword, newPassword)
      setPwDone(true)
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      toast.success('Şifren güncellendi.')
    } catch (err) {
      setPwError(err?.message || 'Şifre güncellenemedi. Lütfen tekrar deneyin.')
    } finally {
      setChanging(false)
    }
  }

  async function handleLogout() {
    await logout()
    navigate('/login', { replace: true })
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Ayarlar</h1>
      </div>

      {/* Profile */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <User className="h-4 w-4" />
            Profil
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4">
            <Avatar className="h-14 w-14">
              <AvatarFallback className="text-lg">{initials(user?.name)}</AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <p className="truncate text-base font-semibold">{user?.name}</p>
              <p className="truncate text-sm text-muted-foreground">{user?.email}</p>
              <span className="mt-1 inline-block rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                {ROLE_LABELS[user?.role] ?? user?.role}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Change password */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <KeyRound className="h-4 w-4" />
            Şifre
          </CardTitle>
        </CardHeader>
        <CardContent>
          {pwDone ? (
            <div className="flex items-start gap-3 rounded-lg border bg-emerald-50 p-3">
              <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-emerald-100 text-emerald-700">
                <Check className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-emerald-700">Şifren güncellendi.</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Bir sonraki girişinde yeni şifreni kullan.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-3"
                  onClick={() => setPwDone(false)}
                >
                  Tekrar değiştir
                </Button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleChangePassword} className="space-y-4">
              {pwError && (
                <div
                  role="alert"
                  className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
                >
                  {pwError}
                </div>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="current-password">Mevcut şifre</Label>
                <div className="relative">
                  <Input
                    id="current-password"
                    type={showPw ? 'text' : 'password'}
                    autoComplete="current-password"
                    placeholder="••••••••"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    className="pr-10"
                    disabled={changing}
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
                <Label htmlFor="new-password">Yeni şifre</Label>
                <Input
                  id="new-password"
                  type={showPw ? 'text' : 'password'}
                  autoComplete="new-password"
                  placeholder="En az 8 karakter"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  minLength={8}
                  disabled={changing}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="confirm-password">Yeni şifre (tekrar)</Label>
                <Input
                  id="confirm-password"
                  type={showPw ? 'text' : 'password'}
                  autoComplete="new-password"
                  placeholder="Aynı şifreyi tekrar gir"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  minLength={8}
                  disabled={changing}
                />
              </div>

              <div className="flex justify-end">
                <Button type="submit" disabled={changing}>
                  <KeyRound className="mr-2 h-4 w-4" />
                  {changing ? 'Güncelleniyor…' : 'Şifreyi güncelle'}
                </Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>

      {/* Account */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <LogOut className="h-4 w-4" />
            Hesap
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Button variant="destructive" onClick={handleLogout} className="w-full sm:w-auto">
            <LogOut className="h-4 w-4" />
            Çıkış Yap
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
