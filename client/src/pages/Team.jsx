import { useEffect, useState } from 'react'
import { Mail, MoreHorizontal, Search, UserPlus } from 'lucide-react'
import { toast } from 'sonner'

import api, { ROLE_LABELS } from '@/api'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useAuth } from '@/hooks/useAuth'
import { cn, initials } from '@/lib/utils'

export default function Team() {
  const { user } = useAuth()
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [role, setRole] = useState('all')
  const [inviteOpen, setInviteOpen] = useState(false)

  const isLeader = user?.role === 'team_leader'

  useEffect(() => {
    setLoading(true)
    api.listUsers().then(setUsers).finally(() => setLoading(false))
  }, [])

  const filtered = users.filter((u) => {
    if (role !== 'all' && u.role !== role) return false
    if (!query) return true
    const q = query.toLowerCase()
    return u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)
  })

  async function toggleActive(u) {
    try {
      const updated = await api.setUserActive(u.id, !u.is_active)
      setUsers((prev) => prev.map((x) => (x.id === u.id ? updated : x)))
      toast.success(updated.is_active ? 'Kullanıcı aktifleştirildi.' : 'Kullanıcı devre dışı bırakıldı.')
    } catch (err) {
      toast.error(err.message || 'İşlem başarısız.')
    }
  }

  return (
    <>
      <div className="space-y-6">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Takım</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {users.filter((u) => u.is_active).length} aktif üye · {users.length} toplam
            </p>
          </div>
          {isLeader && (
            <Button size="sm" onClick={() => setInviteOpen(true)}>
              <UserPlus className="h-4 w-4" />
              Üye Davet Et
            </Button>
          )}
        </header>

        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-3">
            <div className="flex w-full max-w-sm items-center gap-2 rounded-md border bg-background px-2.5 py-1.5 text-sm">
              <Search className="h-4 w-4 text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="İsim veya e-posta ara…"
                className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
            </div>
            <Tabs value={role} onValueChange={setRole}>
              <TabsList>
                <TabsTrigger value="all">Tümü</TabsTrigger>
                <TabsTrigger value="team_leader">Lider</TabsTrigger>
                <TabsTrigger value="designer">Tasarımcı</TabsTrigger>
                <TabsTrigger value="printer">Matbaa</TabsTrigger>
              </TabsList>
            </Tabs>
          </CardContent>
        </Card>

        {loading ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-28" />
            ))}
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((u) => (
              <UserCard key={u.id} user={u} canManage={isLeader && u.id !== user.id} onToggle={toggleActive} />
            ))}
            {filtered.length === 0 && (
              <Card className="sm:col-span-2 lg:col-span-3">
                <CardContent className="p-10 text-center text-sm text-muted-foreground">
                  Bu filtreye uygun üye bulunamadı.
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </div>

      <InviteDialog open={inviteOpen} onOpenChange={setInviteOpen} onInvited={(u) => setUsers((p) => [...p, u])} />
    </>
  )
}

function UserCard({ user, canManage, onToggle }) {
  return (
    <Card>
      <CardContent className="flex items-start gap-3 p-4">
        <Avatar className="h-10 w-10">
          <AvatarFallback>{initials(user.name)}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-semibold">{user.name}</p>
            {!user.is_active && <Badge variant="secondary">Devre dışı</Badge>}
          </div>
          <p className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-muted-foreground">
            <Mail className="h-3 w-3" />
            {user.email}
          </p>
          <div className="mt-2 flex items-center gap-2">
            <Badge variant="outline" className={roleBadgeClass(user.role)}>
              {ROLE_LABELS[user.role]}
            </Badge>
            {user.joined_at ? (
              <span className="text-[11px] text-muted-foreground">Katıldı</span>
            ) : (
              <span className="text-[11px] text-amber-600">Davet bekliyor</span>
            )}
          </div>
        </div>
        {canManage && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onToggle(user)}>
                {user.is_active ? 'Devre dışı bırak' : 'Aktifleştir'}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </CardContent>
    </Card>
  )
}

function roleBadgeClass(role) {
  if (role === 'team_leader') return 'border-primary/30 bg-primary/10 text-primary'
  if (role === 'designer') return 'border-purple-200 bg-purple-50 text-purple-700'
  if (role === 'printer') return 'border-amber-200 bg-amber-50 text-amber-700'
  return ''
}

function InviteDialog({ open, onOpenChange, onInvited }) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('designer')
  const [saving, setSaving] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!name.trim() || !email.trim()) {
      toast.error('İsim ve e-posta zorunludur.')
      return
    }
    setSaving(true)
    try {
      const created = await api.inviteUser({ name: name.trim(), email: email.trim(), role })
      toast.success('Davet gönderildi.')
      onInvited?.(created)
      setName('')
      setEmail('')
      setRole('designer')
      onOpenChange(false)
    } catch (err) {
      toast.error(err.message || 'Davet gönderilemedi.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="h-4 w-4" /> Takıma Üye Davet Et
          </DialogTitle>
          <DialogDescription>
            Davet linki e-posta ile gönderilecek (mock modda sadece listeye eklenir).
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="inv-name">Ad Soyad</Label>
            <Input id="inv-name" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="inv-email">E-posta</Label>
            <Input
              id="inv-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label>Rol</Label>
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="designer">{ROLE_LABELS.designer}</SelectItem>
                <SelectItem value="printer">{ROLE_LABELS.printer}</SelectItem>
                <SelectItem value="team_leader">{ROLE_LABELS.team_leader}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              İptal
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? 'Gönderiliyor…' : 'Davet Gönder'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
