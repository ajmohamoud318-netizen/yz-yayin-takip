import { useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { useNavigate } from 'react-router-dom'
import { Bell } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { useAuth } from '@/hooks/useAuth'
import { useProjectsStore } from '@/hooks/useProjectsStore'

/**
 * Sticky in-app toast for designers with unread project assignments.
 *
 * Picked over the bell because the bell is easy to miss — this toast stays
 * pinned in the top-right until the designer explicitly acknowledges it.
 *
 * • Fires once on login / when the projects store rehydrates with unread rows
 * • Re-fires (replaces the same toast id) when *new* unread items arrive
 *   while the designer is already signed in (e.g. Ayşenur assigns a new book)
 * • Coexists with `NotificationSync` — that component still produces the
 *   short 6 s green toasts for ongoing stage transitions; this one only
 *   handles the static "you have N projects waiting" backlog
 * • "seen" state is persisted to localStorage so cross-session behaviour is
 *   stable: dismissed = dismissed until something new arrives
 */

const STORAGE_KEY = (userId) => `yz_seen_assignments_${userId}`
const TOAST_ID = 'unread-assignments'
const MAX_TITLES = 3

function loadSeen(userId) {
  if (typeof localStorage === 'undefined') return new Set()
  try {
    return new Set(JSON.parse(localStorage.getItem(STORAGE_KEY(userId)) || '[]'))
  } catch {
    return new Set()
  }
}
function persistSeen(userId, ids) {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY(userId), JSON.stringify([...ids]))
  } catch {
    /* storage unavailable — fail silently */
  }
}
function isAssignedTo(project, userId) {
  return (project.assignees ?? []).some((a) => a.id === userId)
}

export default function UnreadAssignmentsToast() {
  const { user } = useAuth()
  const { projects } = useProjectsStore()
  const navigate = useNavigate()

  // Track what we've already surfaced so polling / store ticks don't re-fire
  // identical toasts every 30 s. Reset on user switch.
  const lastShownRef = useRef({ userId: null, key: '' })

  useEffect(() => {
    if (!user || user.role !== 'designer') return
    if (!projects || projects.length === 0) return

    // User changed (login / logout-login / different tab) → forget memory so
    // the fresh user's backlog triggers a toast.
    if (lastShownRef.current.userId !== user.id) {
      lastShownRef.current = { userId: user.id, key: '' }
    }

    const seen = loadSeen(user.id)
    const myUnread = projects
      .filter((p) => isAssignedTo(p, user.id))
      .filter((p) => !seen.has(p.id))

    const nextKey = myUnread
      .map((p) => p.id)
      .sort()
      .join(',')

    // Nothing unread, or we already surfaced this exact set → stop.
    if (myUnread.length === 0) {
      lastShownRef.current.key = nextKey
      return
    }
    if (lastShownRef.current.key === nextKey) return
    lastShownRef.current.key = nextKey

    const titles = myUnread.slice(0, MAX_TITLES).map((p) => p.title)
    const overflow = myUnread.length - titles.length
    const titleList = titles.join(', ') + (overflow > 0 ? ` ve ${overflow} daha` : '')

    const markAllSeen = () => {
      const fresh = loadSeen(user.id)
      myUnread.forEach((p) => fresh.add(p.id))
      persistSeen(user.id, fresh)
      // After marking seen, refetch may still leave the toast visible until
      // the next effect tick — that's fine, the user is mid-dismiss anyway.
    }

    toast.custom(
      (id) => (
        <div data-testid="unread-assignments-toast" className="flex w-full flex-col gap-2 pr-2">
          <div className="flex items-start gap-3">
            <Bell className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
            <div className="min-w-0 flex-1">
              <div className="font-semibold">
                {myUnread.length} okunmamış proje atamanız var
              </div>
              <div className="mt-1 truncate text-sm text-muted-foreground">
                {titleList}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="default"
              onClick={() => {
                markAllSeen()
                toast.dismiss(id)
                navigate('/my-projects')
              }}
            >
              Projeleri Gör
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                markAllSeen()
                toast.dismiss(id)
              }}
            >
              Tamam
            </Button>
          </div>
        </div>
      ),
      {
        id: TOAST_ID,
        duration: Infinity,
        // Mark seen on ANY dismissal path — X button, button click, timeout
        // (Infinity here, so only X / programmatic dismiss). Keeps the local
        // seen-set consistent with whatever the user did.
        onDismiss: markAllSeen,
        onAutoClose: markAllSeen,
      },
    )
  }, [user, projects, navigate])

  return null
}
