import { Link } from 'react-router-dom'
import { ChevronDown, LogOut, Settings, UsersRound } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import UserAvatar from '@/components/UserAvatar.jsx'

// Identity + navigation only. The "what else am I on today" note that used
// to live in here as a hidden dropdown item is now the Çalışma Defteri entry
// in the sidebar's resources group, under Ürün Bilgileri
// (components/WorkLogPill.jsx) — it was a feature nobody could find two
// levels deep in an avatar menu.
export default function UserMenu({ user, onLogout }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-1.5 px-1.5">
          <UserAvatar user={user} size="sm" />
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="font-normal">
          <div className="flex flex-col">
            <span className="text-sm font-semibold">{user?.name}</span>
            <span className="text-xs text-muted-foreground">{user?.email}</span>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {user?.role === 'team_leader' && (
          <DropdownMenuItem asChild>
            <Link to="/team">
              <UsersRound className="h-4 w-4" />
              Ekip
            </Link>
          </DropdownMenuItem>
        )}
        <DropdownMenuItem asChild>
          <Link to="/settings">
            <Settings className="h-4 w-4" />
            Ayarlar
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onLogout} className="text-destructive focus:text-destructive">
          <LogOut className="h-4 w-4" />
          Çıkış Yapın
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}