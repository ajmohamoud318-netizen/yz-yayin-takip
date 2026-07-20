import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { cn, initials } from '@/lib/utils'
import { API_ORIGIN } from '@/api'

const AVATAR_FIXED_RE = /\/api\/users\/me\/avatar\/file/
// Earlier server builds wrote the legacy Dokploy sslip URL or an absolute
// api.yt.mucitkarinca.com URL while the Cloudflare origin was being set
// up. Normalize any stale absolute URL to the live API_ORIGIN so cached
// users see a working image after reload.
const AVATAR_HOST_FIX = [
  'https://yayin-takip-backend-4dvoqr-53441c-46-62-170-64.sslip.io',
  'https://api.yt.mucitkarinca.com',
].filter((host) => host !== API_ORIGIN)

/**
 * Resolve a stored avatar URL into one the <img> tag can render.
 *
 * - Already-absolute URLs get rewritten if they point at a stale host;
 *   otherwise they pass through.
 * - Data-URLs (mock mode) pass through.
 * - Relative `/api/...` URLs get the backend origin prepended so the
 *   request hits the Fastify host, not the SPA host.
 * - Legacy `/api/users/me/avatar/file` (owner route that requires a
 *   custom header <img> can't carry) is rewritten to the public UUID path
 *   using the user's id — passing that in avoids a header-based auth hop.
 */
export function avatarSrc(url, user) {
  if (!url) return url
  if (/^https?:\/\//i.test(url)) {
    for (const stale of AVATAR_HOST_FIX) {
      if (url.startsWith(`${stale}/`)) return `${API_ORIGIN}${url.slice(stale.length)}`
    }
    return url
  }
  if (/^data:/i.test(url)) return url
  if (AVATAR_FIXED_RE.test(url) && user?.id) {
    return `${API_ORIGIN}/api/users/${encodeURIComponent(user.id)}/avatar/file`
  }
  if (url.startsWith('/')) return `${API_ORIGIN}${url}`
  return `${API_ORIGIN}/${url}`
}

/**
 * Single source of truth for displaying a user identity in the app.
 *
 * Renders the user's uploaded avatar (when present) or a fallback with
 * their initials. Sized to the same Tailwind scale as the other avatar
 * surfaces (`h-6 w-6` through `h-12 w-12`) so a card-sized SiteShell
 * dropdown and a compact AssigneeStack both look like the same UI family.
 *
 * Props
 *   user:    the user record (must have `id` + optional `avatar_url` + `name`)
 *   size:    'xs' | 'sm' | 'md' | 'lg' — picked instead of pixel size so
 *            the user-menu, sidebar, and Team list remain visually aligned
 *   className: extra Tailwind utilities (e.g. ring + outline variants)
 */
export default function UserAvatar({ user, size = 'md', className }) {
  const sizes = {
    xs: 'h-6 w-6 text-[10px]',
    sm: 'h-7 w-7 text-[11px]',
    md: 'h-8 w-8 text-xs',
    lg: 'h-9 w-9 text-xs',
    xl: 'h-10 w-10 text-sm',
    '2xl': 'h-12 w-12 text-base',
  }
  const dotClass = sizes[size] || sizes.md
  const src = avatarSrc(user?.avatar_url, user)
  return (
    <Avatar
      className={cn(dotClass, 'ring-2 ring-background shadow-sm', className)}
      title={user?.name}
      data-testid="user-avatar"
    >
      {src ? (
        <img
          src={src}
          alt={user?.name ? `${user.name} profil fotoğrafı` : 'Profil fotoğrafı'}
          className="h-full w-full rounded-full object-cover"
          loading="lazy"
        />
      ) : null}
      <AvatarFallback className={cn('bg-primary/10 font-semibold text-primary', dotClass.split(' ').pop())}>
        {initials(user?.name)}
      </AvatarFallback>
    </Avatar>
  )
}
