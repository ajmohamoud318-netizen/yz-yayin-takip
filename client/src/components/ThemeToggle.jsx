import { Sun, Moon, Monitor } from 'lucide-react'
import { useTheme } from '@/hooks/useTheme'
import { cn } from '@/lib/utils'

/**
 * Three-state theme switcher (light / dark / system).
 *
 * Renders as a segmented control rather than a button-per-mode: the user
 * always sees their current state, so we never need a separate "active"
 * indicator. The icons follow OS settings conventions (Sun = light,
 * Moon = dark, Monitor = follow system).
 */
export default function ThemeToggle() {
  const { pref, set } = useTheme()
  const options = [
    { value: 'light', label: 'Açık', Icon: Sun },
    { value: 'dark', label: 'Koyu', Icon: Moon },
    { value: 'system', label: 'Sistem', Icon: Monitor },
  ]
  return (
    <div
      role="radiogroup"
      aria-label="Tema"
      className="mx-3 mb-1 inline-flex w-[calc(100%-1.5rem)] items-center rounded-md border bg-muted/40 p-0.5"
    >
      {options.map(({ value, label, Icon }) => {
        const active = pref === value
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => set(value)}
            className={cn(
              'inline-flex h-7 flex-1 items-center justify-center gap-1.5 rounded text-[11px] font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              active
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
            title={label}
          >
            <Icon className="h-3.5 w-3.5" />
            <span>{label}</span>
          </button>
        )
      })}
    </div>
  )
}