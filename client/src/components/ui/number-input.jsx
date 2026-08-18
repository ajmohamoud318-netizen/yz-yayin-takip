import * as React from 'react'

import { Input } from '@/components/ui/input'
import { digitsOnly, decimalDigitsOnly, formatNumber } from '@/lib/utils'

/**
 * Numeric input that groups thousands ("10.000") once the user leaves the
 * field, but shows plain digits while focused — reformatting a grouped value
 * on every keystroke moves the caret out from under the user's fingers, the
 * separator shifts digits and drops/reorders whatever they type next.
 *
 * `value` is always the raw numeric string (e.g. "10000" or "10000.5"), and
 * `onChange` is called with that same raw string (never the formatted
 * display string) — so callers keep parsing/storing/submitting a plain
 * number, exactly as if this were `type="number"`.
 */
const NumberInput = React.forwardRef(function NumberInput(
  { value, onChange, allowDecimal = false, onFocus, onBlur, ...props },
  ref,
) {
  const [focused, setFocused] = React.useState(false)
  const strip = allowDecimal ? decimalDigitsOnly : digitsOnly
  const display = focused ? (value ?? '') : formatNumber(value)

  return (
    <Input
      type="text"
      inputMode={allowDecimal ? 'decimal' : 'numeric'}
      value={display}
      onChange={(e) => onChange(strip(e.target.value))}
      onFocus={(e) => { setFocused(true); onFocus?.(e) }}
      onBlur={(e) => { setFocused(false); onBlur?.(e) }}
      ref={ref}
      {...props}
    />
  )
})

export { NumberInput }
