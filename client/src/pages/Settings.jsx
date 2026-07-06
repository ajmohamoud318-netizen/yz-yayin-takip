import { useNavigate } from 'react-router-dom'
import { LogOut, Moon, Sun, User } from 'lucide-react'

import { useAuth } from '@/hooks/useAuth'
import { useTheme } from '@/hooks/useTheme'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import api, { ROLE_LABELS } from '@/api'
import { initials } from '@/lib/utils'
import { cn } from '@/lib/utils'

export default function Settings() {
  const { user, logout } = useAuth()
  const { theme, setTheme } = useTheme()
  const navigate = useNavigate()

  async function handleLogout() {
    await logout()
    navigate('/login', { replace: true })
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Ayarlar</h1>
        <p className="mt-1 text-sm text-muted-foreground">Profil ve görünüm tercihlerinizi yönetin.</p>
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

      {/* Appearance */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            {theme === 'dark' ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
            Görünüm
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setTheme('light')}
              className={cn(
                'flex flex-col items-center gap-2 rounded-lg border-2 p-4 transition-colors',
                theme === 'light'
                  ? 'border-primary bg-primary/5'
                  : 'border-transparent bg-muted/40 hover:border-muted-foreground/30',
              )}
            >
              <div className="flex h-10 w-full items-center justify-center rounded-md bg-white shadow-sm">
                <Sun className="h-4 w-4 text-amber-500" />
              </div>
              <span className="text-xs font-medium">Açık Tema</span>
            </button>
            <button
              type="button"
              onClick={() => setTheme('dark')}
              className={cn(
                'flex flex-col items-center gap-2 rounded-lg border-2 p-4 transition-colors',
                theme === 'dark'
                  ? 'border-primary bg-primary/5'
                  : 'border-transparent bg-muted/40 hover:border-muted-foreground/30',
              )}
            >
              <div className="flex h-10 w-full items-center justify-center rounded-md bg-zinc-900 shadow-sm">
                <Moon className="h-4 w-4 text-blue-400" />
              </div>
              <span className="text-xs font-medium">Koyu Tema</span>
            </button>
          </div>
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
