'use client'

import SymbolPill from '@/components/SymbolPill'
import { formatAmount } from '@/utils/transfer'

interface ReceiveFieldProps {
  /** Header label, e.g. "You receive". */
  label: string
  /** Output amount in base units. `null` while no input / no quote yet. */
  amount: bigint | null
  symbol: string
  decimals: number
  /** Optional small line beneath the field — e.g. balance, USD equivalent. */
  hint?: string | null
  /**
   * Marks the value as not-final (e.g. preview ONyc price). Renders the
   * amount in amber so the user knows the quote may shift.
   */
  preview?: boolean
}

/**
 * Read-only counterpart to `AmountInput` — same chassis (label header +
 * large amount + symbol pill) so the two stack as a swap form. Renders
 * the value as text rather than as a fake `<input>`: a field that looks
 * editable but isn't is a worse lie than just showing the value.
 */
export default function ReceiveField({ label, amount, symbol, decimals, hint, preview }: ReceiveFieldProps) {
  const display = amount === null ? '0' : formatAmount(amount, decimals)
  const empty = amount === null
  return (
    <div className="flex flex-col gap-1">
      <div className="rounded-xl border border-neutral-800 bg-neutral-900/30 px-4 py-3">
        <div className="text-xs text-neutral-500">{label}</div>
        <div className="mt-1 flex items-center gap-3">
          <span
            className={`min-w-0 flex-1 truncate text-2xl font-medium tracking-tight ${
              empty ? 'text-neutral-700' : preview ? 'text-amber-300' : 'text-neutral-100'
            }`}
          >
            {display}
          </span>
          <SymbolPill symbol={symbol} />
        </div>
      </div>
      {hint && <div className="px-1 text-xs text-neutral-500">{hint}</div>}
    </div>
  )
}
