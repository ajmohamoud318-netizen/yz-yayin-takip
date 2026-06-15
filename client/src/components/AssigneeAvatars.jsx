import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { cn, initials } from '@/lib/utils'

/**
 * Overlapping avatar stack for a project's assigned designers.
 * Shows up to `max` avatars and a "+N" chip for the rest.
 */
export default function AssigneeAvatars({ assignees = [], max = 3, size = 'h-6 w-6', text = 'text-[10px]' }) {
  const shown = assignees.slice(0, max)
  const extra = assignees.length - shown.length
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
        <Avatar key={a.id} className={cn(size, 'ring-2 ring-card')} title={a.name}>
          <AvatarFallback className={text}>{initials(a.name)}</AvatarFallback>
        </Avatar>
      ))}
      {extra > 0 && (
        <span className={cn('grid shrink-0 place-items-center rounded-full bg-muted font-semibold text-muted-foreground ring-2 ring-card', size, text)}>
          +{extra}
        </span>
      )}
    </div>
  )
}
