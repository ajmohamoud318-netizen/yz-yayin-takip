import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  BellRing, Check, Loader2, Share, Smartphone, X, Download,
} from 'lucide-react'
import { toast } from 'sonner'

import { useAuth } from '@/hooks/useAuth'
import { usePushNotifications } from '@/hooks/usePushNotifications.js'
import { usePwaInstall } from '@/hooks/usePwaInstall.js'
import IosInstallGuide from '@/components/IosInstallGuide.jsx'
import { cn } from '@/lib/utils'

/**
 * First-thing-you-see setup sheet: install the app + turn on notifications,
 * both offered up front instead of buried behind the notification bell.
 *
 * Why it exists: the bell-dropdown toggle (PushToggle) works, but nobody
 * finds it — enabling push took a click on the bell, then a click on a row
 * inside the dropdown, then the browser prompt. This surfaces both actions
 * the moment someone opens the app.
 *
 * Rules that shaped it:
 *
 *  • Non-blocking. It slides up over the corner of the page, not over a
 *    backdrop. People open this app to check a project, not to do setup.
 *
 *  • Still one gesture per permission. The browser prompt fires from the
 *    button click inside the sheet — never on load. An auto-fired prompt gets
 *    suppressed by Chrome's heuristics and a denial can only be undone in
 *    system settings.
 *
 *  • Renders nothing when there's nothing to offer: already installed and
 *    already subscribed, unsupported browser, or push disabled server-side.
 *
 *  • Install comes FIRST on iOS, because push there literally cannot work in
 *    a Safari tab — the row explains the Share-sheet steps rather than
 *    offering a button that can't do anything.
 *
 *  • Dismissal lasts the session (sessionStorage), so it's back on the next
 *    fresh open until both steps are done — deliberate, this is an internal
 *    tool where the team leader needs everyone actually reachable.
 */

const DISMISS_KEY = 'yz-setup-sheet-dismissed'
// Long enough that the dashboard has painted and the sheet reads as a nudge
// rather than a modal that hijacked the launch.
const APPEAR_DELAY_MS = 1400

export default function SetupSheet() {
  const { user } = useAuth()
  const { status, busy, error, subscribe, sendTest } = usePushNotifications()
  const { mode, promptInstall } = usePwaInstall()

  const [dismissed, setDismissed] = useState(() => {
    try { return sessionStorage.getItem(DISMISS_KEY) === '1' } catch { return false }
  })
  const [visible, setVisible] = useState(false)
  const [installing, setInstalling] = useState(false)
  const [guideOpen, setGuideOpen] = useState(false)

  const needsInstall = mode === 'available' || mode === 'ios'
  // 'default' is the only push state a button can act on. 'needs-install'
  // (iOS tab) is handled by the install row above it; 'denied', 'disabled'
  // and 'unsupported' have no in-app fix.
  const canEnablePush = status === 'default'
  const hasSomethingToOffer = needsInstall || canEnablePush

  useEffect(() => {
    if (!user || dismissed || !hasSomethingToOffer) { setVisible(false); return undefined }
    const t = setTimeout(() => setVisible(true), APPEAR_DELAY_MS)
    return () => clearTimeout(t)
  }, [user, dismissed, hasSomethingToOffer])

  function close() {
    setVisible(false)
    setDismissed(true)
    try { sessionStorage.setItem(DISMISS_KEY, '1') } catch { /* private mode */ }
  }

  async function handleInstall() {
    setInstalling(true)
    const outcome = await promptInstall()
    setInstalling(false)
    if (outcome === 'accepted') {
      toast.success('Uygulama ana ekrana eklendi.')
    } else if (outcome === 'unavailable') {
      toast.info('Tarayıcı menüsünden "Uygulamayı yükle" ile ekleyebilirsiniz.')
    }
  }

  async function handleEnablePush() {
    const ok = await subscribe()
    if (!ok) {
      if (error) toast.error(error)
      return
    }
    toast.success('Bildirimler açıldı. Test bildirimi gönderiliyor…')
    // Immediate proof it works — push fails silently in a dozen places
    // (focus modes, per-app OS settings), and a buzz right now is the only
    // convincing confirmation.
    const { sent } = await sendTest()
    if (sent === 0) {
      toast.warning('Abonelik kaydedildi ama test bildirimi ulaşmadı. Cihaz bildirim ayarlarını kontrol edin.')
    }
    // Nothing left to ask for → get out of the way instead of lingering.
    if (!needsInstall) setTimeout(close, 1200)
  }

  return (
    <>
      {/* Outside the sheet's AnimatePresence on purpose: the guide is
          full-screen, so the sheet behind it may be dismissed or re-render
          without taking the guide down with it. */}
      <IosInstallGuide open={guideOpen} onOpenChange={setGuideOpen} />

      <AnimatePresence>
      {visible && (
        <motion.div
          key="setup-sheet"
          role="dialog"
          aria-label="Uygulama kurulumu"
          initial={{ y: 32, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 32, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 380, damping: 34 }}
          className="fixed inset-x-3 z-50 mx-auto max-w-md overflow-hidden rounded-2xl border bg-background shadow-2xl sm:inset-x-auto sm:right-6 sm:mx-0"
          style={{ bottom: 'calc(0.75rem + var(--safe-bottom, 0px))' }}
        >
          <div className="flex items-start gap-3 px-4 pb-1 pt-3.5">
            <Smartphone className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold leading-tight">Kurulumu tamamlayın</p>
              <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                Uygulamayı ana ekranınıza ekleyin ve iş bildirimlerini telefonunuza alın.
              </p>
            </div>
            <button
              type="button"
              onClick={close}
              aria-label="Kapat"
              className="-mr-1 -mt-1 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="mt-2 divide-y border-t">
            {mode === 'available' && (
              <button
                type="button"
                onClick={handleInstall}
                disabled={installing}
                className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted disabled:opacity-60"
              >
                {installing
                  ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                  : <Download className="h-4 w-4 shrink-0" />}
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-medium">Ana ekrana ekle</span>
                  <span className="block text-[11px] text-muted-foreground">
                    Tarayıcı sekmesi olmadan, uygulama gibi açılır.
                  </span>
                </span>
                <span className="shrink-0 rounded-md bg-primary px-2.5 py-1 text-[11px] font-medium text-primary-foreground">
                  Ekle
                </span>
              </button>
            )}

            {/* iOS. Safari exposes no install API — Add to Home Screen is
                Share-sheet only, by Apple's design — so a button that installs
                is impossible here. What's left is making the manual path
                unmissable, which is a picture of the user's own screen with
                the Share button ringed, not a sentence naming a glyph they've
                never consciously looked at. Hence: one tap into the guide. */}
            {mode === 'ios' && (
              <button
                type="button"
                onClick={() => setGuideOpen(true)}
                className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted"
              >
                <Share className="h-4 w-4 shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-medium">Ana ekrana ekleyin</span>
                  <span className="block text-[11px] text-muted-foreground">
                    Bildirimler iPhone’da yalnızca böyle çalışır — 3 adım, resimli.
                  </span>
                </span>
                <span className="shrink-0 rounded-md bg-primary px-2.5 py-1 text-[11px] font-medium text-primary-foreground">
                  Nasıl?
                </span>
              </button>
            )}

            {canEnablePush && (
              <button
                type="button"
                onClick={handleEnablePush}
                disabled={busy}
                className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted disabled:opacity-60"
              >
                {busy
                  ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                  : <BellRing className="h-4 w-4 shrink-0" />}
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-medium">Bildirimleri aç</span>
                  <span className="block text-[11px] text-muted-foreground">
                    Size iş atandığında telefonunuza haber gelsin.
                  </span>
                </span>
                <span className="shrink-0 rounded-md bg-primary px-2.5 py-1 text-[11px] font-medium text-primary-foreground">
                  İzin ver
                </span>
              </button>
            )}

            {/* Push blocked pending an install, on a device where we couldn't
                offer the install itself (e.g. an iOS in-app webview). The iOS
                block above already carries this line, so don't repeat it. */}
            {status === 'needs-install' && mode !== 'ios' && (
              <div className="flex items-center gap-3 px-4 py-3 text-[11px] text-muted-foreground">
                <BellRing className="h-4 w-4 shrink-0 opacity-50" />
                <span>Bildirimler, uygulama ana ekrandan açıldıktan sonra etkinleşir.</span>
              </div>
            )}

            {status === 'subscribed' && needsInstall && (
              <div className="flex items-center gap-3 px-4 py-2.5 text-[11px] text-muted-foreground">
                <Check className="h-4 w-4 shrink-0 text-emerald-600" />
                <span>Bu cihazda bildirimler açık.</span>
              </div>
            )}
          </div>

          {/* Omitted on iOS: the pointer arrow has to be the last thing in the
              card or it appears to point at this row instead of at Safari's
              toolbar. The X in the header still dismisses. */}
          {mode !== 'ios' && (
            <button
              type="button"
              onClick={close}
              className="w-full border-t py-2 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              Şimdi değil
            </button>
          )}
        </motion.div>
      )}
      </AnimatePresence>
    </>
  )
}
