import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

const Dialog = DialogPrimitive.Root
const DialogTrigger = DialogPrimitive.Trigger
const DialogPortal = DialogPrimitive.Portal
const DialogClose = DialogPrimitive.Close

const DialogOverlay = React.forwardRef(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      'fixed inset-0 z-50 bg-black/60 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
      className,
    )}
    {...props}
  />
))
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName

/**
 * Full-screen-sheet preset for the long form dialogs (Yeni Proje, Sipariş,
 * Demo/Ozalit formu, Talep imzası). It used to be a ~150-character `max-sm:`
 * chain pasted into each of them, which is how two dialogs (Onay, Üye Davet)
 * ended up without it — and how every copy inherited `h-screen`.
 *
 *   • `100dvh`, not `h-screen`: `100vh` on iOS Safari is the height *without*
 *     the URL bar, so an `h-screen` sheet hides its own footer underneath it.
 *   • safe-area insets so the title clears the notch and the footer clears the
 *     home indicator (both matter once installed to the iOS Home Screen).
 *
 * Short dialogs don't need it — the base DialogContent below already keeps
 * itself inside the viewport and scrolls.
 *
 * The [X] close button (see DialogContent) is absolutely positioned at
 * `top-2 right-2`, measured from this sheet's own top-0 edge — i.e. it
 * ignores the pt-safe-top padding above and sits right where a notch/status
 * bar covers it, unreachable. The `[&_[data-dialog-close]]` overrides below
 * pin it to the safe area instead, same as the header content.
 */
export const DIALOG_MOBILE_SHEET =
  'max-sm:left-0 max-sm:top-0 max-sm:h-[100dvh] max-sm:max-h-[100dvh] max-sm:w-screen max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-none max-sm:border-x-0 max-sm:p-4 max-sm:pt-[max(1rem,var(--safe-top))] max-sm:pb-[max(1rem,var(--safe-bottom))] max-sm:[&_[data-dialog-close]]:top-[max(0.5rem,var(--safe-top))] max-sm:[&_[data-dialog-close]]:right-[max(0.5rem,var(--safe-right))]'

const DialogContent = React.forwardRef(({ className, children, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        // Phone-safe by default: never taller than the visible viewport (dvh,
        // so the iOS URL bar is accounted for), never wider than it, and
        // scrollable when the content doesn't fit. Before this, a dialog that
        // outgrew the screen simply ran off it — the buttons at the bottom
        // were unreachable.
        // grid-cols-1 (not just `grid`): Tailwind's grid-cols-N tracks are
        // minmax(0,1fr), which caps each child's min-width at 0. Without it,
        // a plain single-column grid sizes its track to the widest child's
        // min-content — a long untruncated title or a nowrap button row
        // blows the dialog out past max-w-* instead of truncating/wrapping.
        'motion-pop fixed left-[50%] top-[50%] z-50 grid grid-cols-1 max-h-[calc(100dvh-1.5rem)] w-[calc(100vw-1.5rem)] max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 overflow-y-auto overscroll-contain border bg-background p-4 shadow-lg data-[state=open]:duration-200 data-[state=closed]:duration-150 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 sm:w-full sm:max-h-[90vh] sm:rounded-lg sm:p-6',
        className,
      )}
      {...props}
    >
      {children}
      {/* h-9 w-9 hit area (the 16px glyph alone was well under the 44px HIG
          minimum and sat in the corner where a thumb reaches for it).
          data-dialog-close lets DIALOG_MOBILE_SHEET re-pin this to the safe
          area on full-screen sheets — see the comment on that constant. */}
      <DialogPrimitive.Close
        data-dialog-close
        className="absolute right-2 top-2 grid h-9 w-9 place-items-center rounded-md bg-background/80 opacity-70 ring-offset-background backdrop-blur transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none sm:right-3 sm:top-3"
      >
        <X className="h-4 w-4" />
        <span className="sr-only">Kapatın</span>
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPortal>
))
DialogContent.displayName = DialogPrimitive.Content.displayName

const DialogHeader = ({ className, ...props }) => (
  <div className={cn('flex flex-col space-y-1.5 text-left', className)} {...props} />
)
DialogHeader.displayName = 'DialogHeader'

const DialogFooter = ({ className, ...props }) => (
  <div className={cn('flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2', className)} {...props} />
)
DialogFooter.displayName = 'DialogFooter'

const DialogTitle = React.forwardRef(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    // pr-8 keeps a long title from running under the absolute-positioned
    // close button in the corner (visible on phone-width dialogs).
    className={cn('pr-8 text-lg font-semibold leading-none tracking-tight', className)}
    {...props}
  />
))
DialogTitle.displayName = DialogPrimitive.Title.displayName

const DialogDescription = React.forwardRef(({ className, ...props }, ref) => (
  <DialogPrimitive.Description ref={ref} className={cn('text-sm text-muted-foreground', className)} {...props} />
))
DialogDescription.displayName = DialogPrimitive.Description.displayName

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogClose,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
}
