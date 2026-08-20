import { useState } from 'react'
import { BellOff, BellRing, Smartphone, Loader2, Check } from 'lucide-react'
import { toast } from 'sonner'
import { usePushNotifications } from '@/hooks/usePushNotifications.js'
import { cn } from '@/lib/utils'

/**
 * "Telefona bildirim gönder" row, rendered in the footer of the notification
 * bell dropdown.
 *
 * Design decisions worth keeping:
 *
 *  • Lives behind a user gesture. The permission prompt only ever fires from
 *    this click. Prompting on page load gets the request auto-denied by
 *    Chrome's abusive-permission heuristics, and a denial is unrecoverable
 *    without a trip to system settings.
 *
 *  • Renders nothing when push can't work (unsupported browser, no VAPID keys
 *    on the server). A toggle that silently fails is worse than no toggle.
 *
 *  • iOS gets INSTRUCTIONS, not a button. On iPhone the blocker is that the
 *    app isn't installed to the Home Screen, and no amount of clicking a
 *    toggle in Safari fixes that — so the row explains the actual fix.
 */
export default function PushToggle() {
  const {
    status, busy, error, subscribe, unsubscribe, sendTest, iosInstallSteps,
  } = usePushNotifications()
  const [showSteps, setShowSteps] = useState(false)

  // Nothing actionable — don't advertise a feature this device can't have,
  // or ('desktop') one we've decided not to offer here. A desktop that is
  // already subscribed reports 'subscribed', not 'desktop', so it still gets
  // the row and can switch itself off.
  if (status === 'unsupported' || status === 'disabled' || status === 'desktop') return null

  // iOS, not yet installed. Show the 4-step fix instead of a dead toggle.
  if (status === 'needs-install') {
    return (
      <div className="border-t px-3 py-2.5">
        <button
          type="button"
          onClick={() => setShowSteps((v) => !v)}
          className="flex w-full items-center gap-2 text-left text-[11px] text-muted-foreground transition-colors hover:text-foreground"
        >
          <Smartphone className="h-3.5 w-3.5 shrink-0" />
          <span className="flex-1">Telefonda bildirim al, kurulum gerekli</span>
        </button>
        {showSteps && (
          <ol className="mt-2 space-y-1 pl-5 text-[11px] leading-relaxed text-muted-foreground">
            {iosInstallSteps.map((step, i) => (
              <li key={step} className="list-decimal">
                <span className={cn(i === 0 && 'font-medium text-foreground')}>{step}</span>
              </li>
            ))}
          </ol>
        )}
      </div>
    )
  }

  // Permission was blocked. Only system settings can undo this, so say so
  // rather than offering a button that will silently no-op.
  if (status === 'denied') {
    return (
      <div className="flex items-start gap-2 border-t px-3 py-2.5 text-[11px] text-muted-foreground">
        <BellOff className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          Bildirimler engellenmiş. Tarayıcı ayarlarından bu site için
          bildirimlere izin verip tekrar deneyin.
        </span>
      </div>
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
      // Immediate proof it works. Push fails silently in a dozen places
      // (OS-level Do Not Disturb, focus modes, notification settings per
      // app); a buzz right now is the only convincing confirmation.
      const { sent } = await sendTest()
      if (sent === 0) {
        toast.warning('Abonelik kaydedildi ama test bildirimi ulaşmadı. Cihaz bildirim ayarlarını kontrol edin.')
      }
    } else if (error) {
      toast.error(error)
    }
  }

  return (
    <div className="border-t">
      <button
        type="button"
        onClick={handleToggle}
        disabled={busy}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-[11px] transition-colors hover:bg-muted disabled:opacity-60"
      >
        {busy
          ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
          : subscribed
            ? <Check className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
            : <BellRing className="h-3.5 w-3.5 shrink-0" />}
        <span className={cn('flex-1', subscribed ? 'text-muted-foreground' : 'font-medium text-foreground')}>
          {subscribed ? 'Bu cihazda bildirimler açık' : 'Telefona bildirim gönderin'}
        </span>
        <span className="text-[10px] text-muted-foreground">
          {subscribed ? 'Kapatın' : 'Açın'}
        </span>
      </button>
    </div>
  )
}
