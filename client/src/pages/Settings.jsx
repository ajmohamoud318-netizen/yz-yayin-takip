import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Camera, Check, Eye, EyeOff, KeyRound, LoaderCircle, LogOut, Mail, Pencil, ShieldCheck, User } from 'lucide-react'
import { toast } from 'sonner'

import { useAuth } from '@/hooks/useAuth'
import UserAvatar, { avatarSrc } from '@/components/UserAvatar.jsx'

import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import api, { ROLE_LABELS } from '@/api'
import { MAX_SOURCE_BYTES, prepareAvatarFile } from '@/lib/image'
import { initials } from '@/lib/utils'
import { cn } from '@/lib/utils'

export default function Settings() {
  const { user, logout, updateUser } = useAuth()

  const navigate = useNavigate()
  const fileInputRef = useRef(null)

  // Avatar upload state
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const [removingAvatar, setRemovingAvatar] = useState(false)
  // Object URL for the just-picked photo. The upload itself is a round
  // trip, and re-fetching the stored file afterwards is another — showing
  // the local bytes right away means the new face appears the instant it's
  // chosen instead of after the network settles. These are the exact bytes
  // we upload, so it is a preview, not a guess. Kept out of `updateUser`
  // on purpose: a blob: URL is dead after a reload and must never reach
  // the localStorage-mirrored auth user.
  const [preview, setPreview] = useState(null)
  // Revoke on replace and on unmount — the cleanup closes over the URL
  // being replaced, so this is the only place that needs to free one.
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview) }, [preview])

  async function handleAvatarChange(e) {
    const file = e.target.files?.[0]
    // Always reset the input so re-picking the same file fires onChange.
    e.target.value = ''
    if (!file) return
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      toast.error('Desteklenen formatlar: JPEG, PNG, WebP.')
      return
    }
    if (file.size > MAX_SOURCE_BYTES) {
      toast.error('Dosya çok büyük. Lütfen daha küçük bir fotoğraf seç.')
      return
    }
    setUploadingAvatar(true)
    try {
      // Downscale first: a camera-roll photo is several MB, which is both
      // slow to upload on mobile data and over the server's 2 MB cap. The
      // 512×512 JPEG that comes back is a few tens of KB.
      const upload = await prepareAvatarFile(file)
      if (upload.size > 2 * 1024 * 1024) {
        toast.error('Dosya 2 MB sınırını aşıyor.')
        return
      }
      setPreview(URL.createObjectURL(upload))
      const { avatarUrl, avatarUpdatedAt } = await api.uploadAvatar(upload)
      // `avatar_updated_at` is what avatarSrc() turns into the `?v=` cache
      // buster, so it has to change on every upload or the browser keeps
      // serving the previous photo from cache. Prefer the server's stamp;
      // fall back to local time if an older build didn't send one.
      updateUser({
        avatar_url: avatarUrl,
        avatar_updated_at: avatarUpdatedAt ?? new Date().toISOString(),
      })
      toast.success('Profil fotoğrafın güncellendi.')
    } catch (err) {
      // Drop the optimistic preview — nothing was stored.
      setPreview(null)
      toast.error(err?.message || 'Fotoğraf yüklenemedi.')
    } finally {
      setUploadingAvatar(false)
    }
  }

  async function handleRemoveAvatar() {
    setRemovingAvatar(true)
    try {
      await api.deleteAvatar()
      setPreview(null)
      updateUser({ avatar_url: null, avatar_updated_at: null })
      toast.success('Profil fotoğrafı kaldırıldı.')
    } catch (err) {
      toast.error(err?.message || 'Fotoğraf kaldırılamadı.')
    } finally {
      setRemovingAvatar(false)
    }
  }

  // What the big avatar on this page renders: the local pick while it's
  // fresh, otherwise whatever the session says is stored.
  const shownUser = preview ? { ...user, avatar_url: preview, avatar_updated_at: null } : user

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
                {/* 80 px on a phone, 96 px once there's room. This is the
                    one screen where the photo is the subject rather than a
                    label on a row, so it gets to be big enough to actually
                    look at — and big enough to hit without aiming. */}
                <UserAvatar user={shownUser} size="3xl" className="sm:h-24 sm:w-24" />
                {/* Hover reveals the camera hint on desktop — but there is
                    no hover on a phone, so force the overlay on while the
                    upload is in flight or it looks like nothing happened. */}
                <span
                  className={cn(
                    'pointer-events-none absolute inset-0 flex items-center justify-center',
                    'rounded-full bg-black/35 text-white transition-opacity',
                    uploadingAvatar ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
                  )}
                >
                  {uploadingAvatar ? (
                    <LoaderCircle className="h-6 w-6 animate-spin" />
                  ) : (
                    <Camera className="h-6 w-6" />
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
                  'absolute -bottom-1 -right-1 grid h-9 w-9 place-items-center rounded-full',
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
                    className="absolute right-1 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-md text-muted-foreground hover:bg-muted"
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
          <Button variant="outline" onClick={handleLogout} className="w-full sm:w-auto">
            <LogOut className="h-4 w-4" />
            Çıkış Yap
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
