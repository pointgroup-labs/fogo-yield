'use client'

import { formatAmount } from '@/lib/tx'

interface QuoteRowProps {
  label: string
  amount: bigint | null
  decimals: number
  symbol: string
  hint?: string
}

export default function QuoteRow({ label, amount, decimals, symbol, hint }: QuoteRowProps) {
  return (
    <div className="flex items-baseline justify-between text-sm">
      <span className="text-neutral-400">
        {label}
        {hint && <span className="ml-1 text-xs text-neutral-600">({hint})</span>}
      </span>
      <span className="font-mono">
        {amount === null ? '—' : `${formatAmount(amount, decimals)} ${symbol}`}
      </span>
    </div>
  )
}
