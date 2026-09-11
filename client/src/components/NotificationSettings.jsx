import { useState } from 'react'
import { BellOff, BellRing, Check, Loader2, Monitor, Smartphone } from 'lucide-react'
import { toast } from 'sonner'

import { useAuth } from '@/hooks/useAuth'
import { usePushNotifications, isMobileDevice } from '@/hooks/usePushNotifications.js'
import { cn } from '@/lib/utils'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

/**
 * Notification preferences card for the Settings page.
 *
 * The mobile/PWA path is fully covered by the setup sheet on first run and
 * the toggle in the notification bell — both greet the user where they're
 * already looking. This card exists for the path those two don't cover:
 *
 *   Desktop users who want notifications outside Chrome. Push on desktop
 *   works fine in Chrome/Edge, but nothing in the app surfaces it on first
 *   run (the setup sheet still suppresses itself on desktop, by design),
 *   and the bell toggle is discoverable only once you've opened the bell.
 *   So a desk user who specifically wants to be notified at the OS level
 *   needs a real Settings affordance.
 *
 * The same hook powers all three surfaces; this card does NOT add a second
 * subscription model. A desktop click here calls the same `subscribe()` that
 * the bell calls, and the resulting subscription is the same one the server
 * stores.
 *
 * Permission prompt only fires from a click — same discipline as the bell
 * toggle. Auto-prompts get suppressed by Chrome and unrecoverable once
 * denied.
 */
export default function NotificationSettings() {
  const { user } = useAuth()
  const {
    status, busy, error, subscribe, unsubscribe, sendTest, canSubscribe,
  } = usePushNotifications()

  // Show different copy on mobile vs desktop: a phone user on this page
  // already has the toggle in the bell, so the card reads as redundant if
  // we just repeat the same row. The desktop copy is the real reason this
  // card exists.
  const [isMobile] = useState(() => isMobileDevice())

  if (!user) return null

  // Nothing the user can do here — don't show a card that points at dead
  // ends. The 'unsupported' / 'disabled' reasons mean the feature simply
  // doesn't exist on this browser/server combo.
  if (status === 'unsupported' || status === 'disabled') return null

  // iOS Safari in a normal tab: push literally cannot work until the app
  // is installed to the Home Screen. The setup sheet covers that flow with
  // a picture guide; on Settings we just say so and stop.
  if (status === 'needs-install') {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <BellRing className="h-4 w-4" />
            Bildirimler
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Bildirimler iPhone&apos;da yalnızca uygulamayı ana ekrana ekledikten
            sonra çalışır. Ana ekrandan açtığınızda bu sayfaya geri dönün.
          </p>
        </CardContent>
      </Card>
    )
  }

  const subscribed = status === 'subscribed'

  async function handleToggle() {
    if (subscribed) {
      const ok = await unsubscribe()
      if (ok) toast.success('Bu cihazda bildirimler kapatıldı.')
      return
    }
    const ok = await subscribe()
    if (ok) {
      toast.success('Bildirimler açıldı. Test bildirimi gönderiliyor…')
      // Same "buzz right now" reasoning as the bell toggle: push fails
      // silently in a dozen places (focus modes, per-app OS settings), and
      // a notification on screen is the only convincing confirmation.
      const { sent } = await sendTest()
      if (sent === 0) {
        toast.warning('Abonelik kaydedildi ama test bildirimi ulaşmadı. Cihaz bildirim ayarlarını kontrol edin.')
      }
    } else if (error) {
      toast.error(error)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <BellRing className="h-4 w-4" />
          Bildirimler
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          {isMobile
            ? 'Bu cihazda iş bildirimlerini açın. Tarayıcı sekmesi kapalıyken bile yeni atamalar telefonunuza gelsin.'
            : 'Bu bilgisayarda iş bildirimlerini açın. Chrome kapalıyken bile yeni atamalar masaüstüne gelsin.'}
        </p>

        {status === 'denied' && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-[12px] text-destructive">
            <BellOff className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              Bildirimler tarayıcı ayarlarından engellenmiş. Bu site için
              izinleri açıp tekrar deneyin.
            </span>
          </div>
        )}

        <div className="flex items-center gap-3 rounded-lg border bg-muted/40 px-3 py-2.5">
          {busy
            ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
            : subscribed
              ? <Check className="h-4 w-4 shrink-0 text-emerald-600" />
              : isMobile
                ? <Smartphone className="h-4 w-4 shrink-0" />
                : <Monitor className="h-4 w-4 shrink-0" />}
          <span className={cn('min-w-0 flex-1 text-sm', subscribed && 'text-muted-foreground')}>
            {subscribed ? 'Bu cihazda bildirimler açık' : 'Bildirimler kapalı'}
          </span>
          <Button
            type="button"
            size="sm"
            variant={subscribed ? 'outline' : 'default'}
            onClick={handleToggle}
            disabled={busy || (!subscribed && !canSubscribe)}
          >
            {subscribed ? 'Kapatın' : 'Açın'}
          </Button>
        </div>

        <p className="text-[11px] text-muted-foreground">
          İzin yalnızca bu tarayıcı için geçerlidir. Başka bir tarayıcı veya
          bilgisayardan açarsanız orada da açmanız gerekir.
        </p>
      </CardContent>
    </Card>
  )
}