import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * Tiny accessible switch. Avoids pulling in @radix-ui/react-switch for one
 * widget — the YZ-style designs here only need a binary on/off with a
 * label, so a native `role="switch"` button (Radix's WAI-ARIA primitive
 * for the role) suffices.
 */
const Switch = React.forwardRef(function Switch(
  { className, checked, onCheckedChange, disabled, id, 'aria-label': ariaLabel },
  ref,
) {
  const handleClick = () => {
    if (disabled) return
    onCheckedChange?.(!checked)
  }
  return (
    <button
      ref={ref}
      id={id}
      type="button"
      role="switch"
      aria-checked={!!checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={handleClick}
      className={cn(
        'peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full',
        'border-2 border-transparent shadow-sm transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        'disabled:cursor-not-allowed disabled:opacity-50',
        checked ? 'bg-primary' : 'bg-input',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'pointer-events-none block h-4 w-4 rounded-full bg-background shadow-lg ring-0 transition-transform',
          checked ? 'translate-x-4' : 'translate-x-0',
        )}
      />
    </button>
  )
})

export { Switch }
