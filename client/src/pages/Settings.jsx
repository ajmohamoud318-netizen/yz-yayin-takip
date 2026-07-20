import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Camera, Check, Eye, EyeOff, KeyRound, LoaderCircle, LogOut, Mail, Pencil, ShieldCheck, User } from 'lucide-react'
import { toast } from 'sonner'

import { useAuth } from '@/hooks/useAuth'

const AVATAR_FIXED_RE = /\/api\/users\/me\/avatar\/file/

import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import api, { ROLE_LABELS, API_ORIGIN } from '@/api'
import { initials } from '@/lib/utils'
import { cn } from '@/lib/utils'

/**
 * Turn a stored avatar URL into one the <img> tag can render.
 *
 * - Already-absolute URLs pass through.
 * - Data-URLs (mock mode) pass through.
 * - Relative `/api/...` URLs get the backend origin prepended so the
 *   request hits the Fastify host, not the SPA host.
 * - Legacy `/api/users/me/avatar/file` (owner route that requires a
 *   custom header <img> can't carry) is rewritten to the public UUID path
 *   using the currently signed-in user's id.
 */
function avatarSrc(url, currentUserId) {
  if (!url) return url
  if (/^(https?:|data:)/i.test(url)) return url
  if (AVATAR_FIXED_RE.test(url) && currentUserId) {
    return `${API_ORIGIN}/api/users/${encodeURIComponent(currentUserId)}/avatar/file`
  }
  if (url.startsWith('/')) return `${API_ORIGIN}${url}`
  return `${API_ORIGIN}/${url}`
}

export default function Settings() {
  const { user, logout, updateUser } = useAuth()

  const navigate = useNavigate()
  const fileInputRef = useRef(null)

  // Avatar upload state
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const [removingAvatar, setRemovingAvatar] = useState(false)

  async function handleAvatarChange(e) {
    const file = e.target.files?.[0]
    // Always reset the input so re-picking the same file fires onChange.
    e.target.value = ''
    if (!file) return
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      toast.error('Desteklenen formatlar: JPEG, PNG, WebP.')
      return
    }
    if (file.size > 2 * 1024 * 1024) {
      toast.error('Dosya 2 MB sınırını aşıyor.')
      return
    }
    setUploadingAvatar(true)
    try {
      const { avatarUrl } = await api.uploadAvatar(file)
      updateUser({ avatar_url: avatarUrl, avatar_updated_at: new Date().toISOString() })
      toast.success('Profil fotoğrafın güncellendi.')
    } catch (err) {
      toast.error(err?.message || 'Fotoğraf yüklenemedi.')
    } finally {
      setUploadingAvatar(false)
    }
  }

  async function handleRemoveAvatar() {
    setRemovingAvatar(true)
    try {
      await api.deleteAvatar()
      updateUser({ avatar_url: null, avatar_updated_at: null })
      toast.success('Profil fotoğrafı kaldırıldı.')
    } catch (err) {
      toast.error(err?.message || 'Fotoğraf kaldırılamadı.')
    } finally {
      setRemovingAvatar(false)
    }
  }

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
            <div className="relative shrink-0">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadingAvatar}
                aria-label="Profil fotoğrafını düzenle"
                className="group relative block rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card"
              >
                <Avatar className="h-14 w-14 ring-2 ring-background shadow-sm transition-opacity group-hover:opacity-90">
                  {user?.avatar_url ? (
                    <img
                      src={avatarSrc(user.avatar_url, user?.id)}
                      alt={user?.name ? `${user.name} profil fotoğrafı` : 'Profil fotoğrafı'}
                      className="h-full w-full rounded-full object-cover"
                    />
                  ) : (
                    <AvatarFallback className="bg-primary/10 text-lg font-semibold text-primary">
                      {initials(user?.name)}
                    </AvatarFallback>
                  )}
                </Avatar>
                <span className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-full bg-black/35 text-white opacity-0 transition-opacity group-hover:opacity-100">
                  {uploadingAvatar ? (
                    <LoaderCircle className="h-5 w-5 animate-spin" />
                  ) : (
                    <Camera className="h-5 w-5" />
                  )}
                </span>
              </button>
              {/* Always-visible "edit avatar" affordance — small floating
                  badge anchored to the bottom-right of the avatar circle.
                  Opens the same file picker the hover overlay does. */}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadingAvatar || removingAvatar}
                aria-label="Profil fotoğrafını düzenle"
                title="Profil fotoğrafını düzenle"
                className={cn(
                  'absolute -bottom-1 -right-1 grid h-7 w-7 place-items-center rounded-full',
                  'border-2 border-card bg-primary text-primary-foreground shadow-sm',
                  'transition-transform hover:scale-105 hover:bg-primary/90 active:scale-95',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card',
                  'disabled:opacity-60 disabled:pointer-events-none',
                )}
              >
                {uploadingAvatar ? (
                  <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Pencil className="h-3.5 w-3.5" />
                )}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={handleAvatarChange}
              />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-base font-semibold">{user?.name}</p>
              <p className="truncate text-sm text-muted-foreground">{user?.email}</p>
              <span className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                <ShieldCheck className="h-3 w-3" />
                {ROLE_LABELS[user?.role] ?? user?.role}
              </span>
            </div>
          </div>

          {(user?.avatar_url || uploadingAvatar) && (
            <div className="mt-4 flex items-center justify-end gap-2 border-t border-border/60 pt-4">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadingAvatar || removingAvatar}
              >
                <Camera className="h-4 w-4" />
                Fotoğrafı değiştir
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-destructive hover:bg-destructive/5 hover:text-destructive"
                onClick={handleRemoveAvatar}
                disabled={removingAvatar || uploadingAvatar}
              >
                {removingAvatar ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
                Kaldır
              </Button>
            </div>
          )}
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
