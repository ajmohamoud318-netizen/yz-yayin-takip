import { useEffect, useState } from 'react'
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
 * The stored avatar URL (`/api/users/<id>/avatar/file`) is the SAME string
 * before and after someone replaces their photo — the filename carries no
 * hash and the route has no version segment. So a plain re-render hands
 * the <img> a src it already has in cache and the browser is entirely
 * within its rights to keep showing the old face until the cache entry
 * ages out. Stamping `avatar_updated_at` into the query string makes each
 * upload a genuinely new URL, which is what actually forces the refetch.
 */
function avatarVersion(user) {
  const stamp = user?.avatar_updated_at
  if (!stamp) return null
  const ms = Date.parse(stamp)
  return Number.isFinite(ms) ? String(ms) : null
}

function withVersion(url, user) {
  const v = avatarVersion(user)
  if (!v) return url
  return `${url}${url.includes('?') ? '&' : '?'}v=${v}`
}

/**
 * Resolve a stored avatar URL into one the <img> tag can render.
 *
 * - Already-absolute URLs get rewritten if they point at a stale host;
 *   otherwise they pass through.
 * - Data-URLs (inline avatars) pass through.
 * - Relative `/api/...` URLs get the backend origin prepended so the
 *   request hits the Fastify host, not the SPA host.
 * - Legacy `/api/users/me/avatar/file` (owner route that requires a
 *   custom header <img> can't carry) is rewritten to the public UUID path
 *   using the user's id — passing that in avoids a header-based auth hop.
 * - Everything but a data:/blob: source picks up a `?v=<avatar_updated_at>`
 *   so a replaced photo can't be served from cache (see avatarVersion).
 */
export function avatarSrc(url, user) {
  if (!url) return url
  // Inline (data:) and in-memory (blob:) sources are already exactly the
  // bytes to render — no origin to prepend, and versioning them is
  // meaningless since a new pick is a new URL by construction.
  if (/^(data|blob):/i.test(url)) return url
  if (/^https?:\/\//i.test(url)) {
    for (const stale of AVATAR_HOST_FIX) {
      if (url.startsWith(`${stale}/`)) {
        return withVersion(`${API_ORIGIN}${url.slice(stale.length)}`, user)
      }
    }
    return withVersion(url, user)
  }
  if (AVATAR_FIXED_RE.test(url) && user?.id) {
    return withVersion(`${API_ORIGIN}/api/users/${encodeURIComponent(user.id)}/avatar/file`, user)
  }
  if (url.startsWith('/')) return withVersion(`${API_ORIGIN}${url}`, user)
  return withVersion(`${API_ORIGIN}/${url}`, user)
}

/**
 * Single source of truth for displaying a user identity in the app.
 *
 * Renders the user's uploaded avatar (when present) or a fallback with
 * their initials. Sized to the same Tailwind scale as the other avatar
 * surfaces (`h-6 w-6` through `h-24 w-24`) so a card-sized SiteShell
 * dropdown and a compact AssigneeStack both look like the same UI family.
 *
 * The `xs`–`2xl` steps are the *inline* sizes: identity attached to some
 * other thing (a row, a menu, a stack). `3xl`/`4xl` exist for the one
 * place the photo IS the content — the profile card on /settings, where
 * a 48 px thumbnail read as an afterthought rather than "your photo".
 *
 * Props
 *   user:    the user record (must have `id` + optional `avatar_url` + `name`)
 *   size:    'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl' | '4xl' —
 *            picked instead of pixel size so the user-menu, sidebar, and
 *            Team list remain visually aligned
 *   className: extra Tailwind utilities (e.g. ring + outline variants).
 *            Merged with tailwind-merge, so a responsive `sm:h-24 sm:w-24`
 *            cleanly overrides the token's base height/width.
 */
export default function UserAvatar({ user, size = 'md', className }) {
  const sizes = {
    xs: 'h-6 w-6 text-[10px]',
    sm: 'h-7 w-7 text-[11px]',
    md: 'h-8 w-8 text-xs',
    lg: 'h-9 w-9 text-xs',
    xl: 'h-10 w-10 text-sm',
    '2xl': 'h-12 w-12 text-base',
    '3xl': 'h-20 w-20 text-xl',
    '4xl': 'h-24 w-24 text-2xl',
  }
  const dotClass = sizes[size] || sizes.md
  const initialSrc = avatarSrc(user?.avatar_url, user)
  // When the on-disk avatar file has been deleted out from under the DB
  // (e.g. container restart wiped /tmp/yz-uploads/avatars before the
  // Dokploy named-volume was attached, or a long-ago upload landed in
  // /app/uploads/avatars and that path no longer matches the route's
  // read target), the <img> 404s and the browser would render its own
  // broken-image icon over the avatar circle. Detect the error locally
  // so we hide the broken <img> and the AvatarFallback (initials) takes
  // over cleanly instead of leaving a visual artefact.
  const [imageBroken, setImageBroken] = useState(false)
  // Reset the broken flag whenever the source URL changes (user switched
  // tabs to a row with a real image) so the next render gets a fresh
  // chance — otherwise a single 404 in one tab sticks forever.
  useEffect(() => {
    setImageBroken(false)
  }, [initialSrc])

  const src = initialSrc && !imageBroken ? initialSrc : null
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
          onError={() => setImageBroken(true)}
        />
      ) : (
        // Radix's <AvatarFallback> only hides itself once its own
        // <AvatarImage> reports "loaded" — since we render a plain <img>
        // above instead (so onError can swap to initials on a 404), Radix
        // never sees that signal and the fallback never unmounts on its
        // own. Gating it on `src` here keeps it mutually exclusive with the
        // photo; without this it rendered as a flex sibling *next to* the
        // photo — a sliver of pink initials bleeding out beside the face.
        <AvatarFallback className={cn('bg-primary/10 font-semibold text-primary', dotClass.split(' ').pop())}>
          {initials(user?.name)}
        </AvatarFallback>
      )}
    </Avatar>
  )
}
