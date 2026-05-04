'use client'

import SymbolPill from '@/components/SymbolPill'
import { formatAmount } from '@/utils/transfer'

interface AmountInputProps {
  /** Header label, e.g. "You pay". */
  label: string
  value: string
  onChange: (next: string) => void
  symbol: string
  decimals: number
  disabled?: boolean
  /**
   * Available balance in base units. `null` means "not loaded yet" and the
   * Max button is hidden; pass `0n` for "wallet has none of this token".
   */
  balance?: bigint | null
  onMax?: () => void
  /**
   * Human-readable parse failure (e.g. "USDC.s only supports 6 decimals.").
   * Rendered as a helper line under the field. `null` for "no error" so
   * callers can pass `parsed.error` straight through without coercion.
   */
  parseError?: string | null
}

/**
 * Swap-style amount field. Header row carries the label on the left and a
 * Balance chip on the right (click acts as Max — single click target,
 * matches the DEX convention). Body row is a large numeric input with a
 * symbol pill on the right.
 *
 * The balance slot is always rendered (a skeleton bar fills it while
 * loading) so the field's height never jumps when the wallet's balance
 * arrives a few hundred ms after mount.
 */
export default function AmountInput({
  label,
  value,
  onChange,
  symbol,
  decimals,
  disabled,
  balance,
  onMax,
  parseError,
}: AmountInputProps) {
  return (
    <div className="flex flex-col gap-1">
      <div className="rounded-xl border border-neutral-800 bg-neutral-900/60 px-4 py-3 transition-colors focus-within:border-neutral-600">
        <div className="flex items-center justify-between text-xs text-neutral-500">
          <span>{label}</span>
          <BalanceChip balance={balance} decimals={decimals} disabled={disabled} onMax={onMax} />
        </div>
        <div className="mt-1 flex items-center gap-3">
          <input
            type="text"
            inputMode="decimal"
            placeholder="0"
            value={value}
            disabled={disabled}
            onChange={e => onChange(e.target.value)}
            className="min-w-0 flex-1 bg-transparent text-2xl font-medium tracking-tight outline-none placeholder:text-neutral-700 disabled:opacity-50"
          />
          <SymbolPill symbol={symbol} />
        </div>
      </div>
      {parseError && <div className="px-1 text-xs text-red-400/90">{parseError}</div>}
    </div>
  )
}

interface BalanceChipProps {
  balance: bigint | null | undefined
  decimals: number
  disabled?: boolean
  onMax?: () => void
}

/**
 * Right-side affordance in the field header. Four states share the same
 * footprint so the layout never reflows:
 *   - no session         (balance === undefined) → invisible spacer
 *   - session, loading   (balance === null)      → shimmer skeleton
 *   - balance loaded = 0                          → muted "—" chip
 *   - balance loaded > 0                          → wallet icon + number + MAX
 */
function BalanceChip({ balance, decimals, disabled, onMax }: BalanceChipProps) {
  if (balance === undefined) {
    // Wallet not connected: a muted "---" placeholder reads as "no value
    // yet" without the perpetual shimmer of a skeleton. The slot still
    // reserves the same height so the field doesn't reflow on connect.
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-neutral-600">
        <WalletIcon />
        <span className="font-mono">---</span>
      </span>
    )
  }
  if (balance === null) {
    return <span aria-hidden="true" className="h-5 w-24 animate-pulse rounded bg-neutral-800/60" />
  }
  if (balance === 0n) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-neutral-500">
        <WalletIcon />
        <span className="font-mono">0</span>
      </span>
    )
  }
  const display = formatBalanceShort(balance, decimals)
  const canMax = onMax !== undefined
  return canMax
    ? (
        <button
          type="button"
          onClick={onMax}
          disabled={disabled}
          title="Use full balance"
          className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 transition-colors hover:bg-neutral-800 hover:text-neutral-100 disabled:opacity-50 disabled:hover:bg-transparent"
        >
          <WalletIcon />
          <span className="font-mono text-neutral-300">{display}</span>
          <span className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">Max</span>
        </button>
      )
    : (
        <span className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5">
          <WalletIcon />
          <span className="font-mono text-neutral-300">{display}</span>
        </span>
      )
}

/**
 * Render a base-units balance as a short, human-readable number. Caps
 * the displayed precision at 4 fractional digits regardless of the
 * token's decimals — full precision is fine for the input itself but
 * noisy in the corner-of-the-field balance affordance.
 */
function formatBalanceShort(balance: bigint, decimals: number): string {
  const full = formatAmount(balance, decimals)
  const dot = full.indexOf('.')
  if (dot === -1) {
    return full
  }
  const truncated = full.slice(0, dot + 5)
  // Strip trailing zeros and a dangling decimal point so "1.5000" → "1.5",
  // "1.0000" → "1". Keeps the chip narrow without losing information.
  return truncated.replace(/\.?0+$/, '')
}

function WalletIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="opacity-70"
    >
      <path d="M21 12V7a2 2 0 0 0-2-2H5a2 2 0 0 0 0 4h16v6" />
      <path d="M3 7v12a2 2 0 0 0 2 2h16v-5" />
      <circle cx="17" cy="14" r="1.2" />
    </svg>
  )
}
