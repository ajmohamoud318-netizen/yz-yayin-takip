import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { KeyRound, AlertTriangle } from 'lucide-react'

import { useAuth } from '@/hooks/useAuth.js'
import api from '@/api.js'

/**
 * Landing page the magic-link email points at.
 *
 * Flow:
 *   1. User clicks `${INVITE_BASE_URL}/auth/magic?token=…` in their inbox.
 *   2. The browser navigates to the SPA's `/auth/magic` route with the
 *      token in the query string. The server has ALREADY consumed the
 *      token, created a Redis session, and set the yz_sid cookie
 *      during the server's own `/api/auth/magic/callback` redirect.
 *   3. On mount we call api.me() to read the session cookie. If valid,
 *      we land the user on the dashboard. If not, we show an error
 *      and let them re-request a link.
 *
 * The `token` query param is left over from the email link — we ignore
 * it on the client side because the server consumed it server-side.
 * Showing it would let a curious user understand the flow; dropping it
 * via `navigate('/auth/magic', { replace: true })` keeps the URL clean.
 */
export default function MagicCallback() {
  const { refresh } = useAuth()
  const navigate = useNavigate()
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    api.me()
      .then(({ user }) => {
        if (cancelled) return
        // Push the freshly-restored user into the auth hook so the
        // dashboard renders without a flash of signed-out state.
        refresh?.(user)
        navigate('/', { replace: true })
      })
      .catch((err) => {
        if (cancelled) return
        setError(
          err?.message ||
            'Bu giriş bağlantısı geçersiz veya süresi dolmuş. Yeni bir tane isteyin.',
        )
      })
    return () => { cancelled = true }
  }, [navigate, refresh])

  return (
    <div className="grid min-h-screen place-items-center bg-muted/30 px-4 py-10">
      <div className="w-full max-w-md rounded-xl border bg-card p-6 text-center shadow-sm">
        {error ? (
          <>
            <span className="mx-auto mb-3 grid h-10 w-10 place-items-center rounded-full bg-destructive/10 text-destructive">
              <AlertTriangle className="h-5 w-5" />
            </span>
            <h1 className="mb-2 text-lg font-semibold">Giriş bağlantısı kullanılamıyor</h1>
            <p className="text-sm text-muted-foreground">{error}</p>
            <Link
              to="/login"
              className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline"
            >
              <KeyRound className="h-4 w-4" />
              Giriş sayfasına dön
            </Link>
          </>
        ) : (
          <>
            <span className="mx-auto mb-3 grid h-10 w-10 place-items-center rounded-full bg-primary/10 text-primary">
              <KeyRound className="h-5 w-5" />
            </span>
            <h1 className="mb-2 text-lg font-semibold">Giriş yapılıyor…</h1>
            <p className="text-sm text-muted-foreground">Yönlendiriliyorsunuz.</p>
          </>
        )}
      </div>
    </div>
  )
}