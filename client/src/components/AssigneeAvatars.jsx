import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import UserAvatar, { avatarSrc } from '@/components/UserAvatar.jsx'
import { cn, initials } from '@/lib/utils'

// Map our legacy `size` prop (Tailwind class strings) to UserAvatar's
// named size so callers don't need to know about the component internals.
const SIZE_MAP = {
  'h-6 w-6': 'xs',
  'h-7 w-7': 'sm',
  'h-8 w-8': 'md',
  'h-9 w-9': 'lg',
  'h-10 w-10': 'xl',
  'h-12 w-12': '2xl',
}

function pickSize(cls) {
  // Pick the UserAvatar size token that matches the requested h/w pair.
  const match = Object.keys(SIZE_MAP).find((k) => cls.includes(k))
  return SIZE_MAP[match] || 'xs'
}

/**
 * Overlapping avatar stack for a project's assigned designers.
 * Shows up to `max` avatars and a "+N" chip for the rest.
 */
export default function AssigneeAvatars({ assignees = [], max = 3, size = 'h-6 w-6', text = 'text-[10px]' }) {
  const shown = assignees.slice(0, max)
  const extra = assignees.length - shown.length
  const uaSize = pickSize(size)
  if (assignees.length === 0) {
    return (
      <span className={cn('grid shrink-0 place-items-center rounded-full bg-muted text-muted-foreground ring-2 ring-card', size, text)}>
        —
      </span>
    )
  }
  return (
    <div className="flex -space-x-1.5">
      {shown.map((a) => (
        <UserAvatar key={a.id} user={a} size={uaSize} className="ring-card shadow-none" />
      ))}
      {extra > 0 && (
        <span className={cn('grid shrink-0 place-items-center rounded-full bg-muted font-semibold text-muted-foreground ring-2 ring-card', size, text)}>
          +{extra}
        </span>
      )}
    </div>
  )
}
