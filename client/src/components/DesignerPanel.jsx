import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Users as UsersIcon, User as UserIcon } from 'lucide-react'
import UserAvatar from '@/components/UserAvatar.jsx'

/**
 * Sidebar card showing which designers are working on this project and
 * which subtasks each one owns.
 */
export default function DesignerPanel({ project, allDesigners }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {allDesigners.length > 1 ? (
            <UsersIcon className="h-4 w-4" />
          ) : (
            <UserIcon className="h-4 w-4" />
          )}
          {allDesigners.length > 1 ? 'Tasarımcılar' : 'Tasarımcı'}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2.5 pt-0">
        {allDesigners.length === 0 && (
          <p className="text-xs text-muted-foreground">Henüz tasarımcı atanmadı.</p>
        )}
        {allDesigners.map((a) => {
          // Surface which subtasks this designer owns so the team
          // leader can see at a glance who is doing what — even when
          // the project-level primary doesn't include them.
          const owns = (project?.subtasks ?? [])
            .filter((s) => s.assigned_to === a.id)
            .map((s) => s.title)
          return (
            <div key={a.id} className="flex items-start gap-3">
              <UserAvatar user={a} size="lg" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">{a.name ?? a.id}</p>
                <p className="text-xs text-muted-foreground">Tasarımcı</p>
                {owns.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {owns.map((t) => (
                      <span
                        key={t}
                        className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}
