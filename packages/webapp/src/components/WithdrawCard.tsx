'use client'

import { isEstablished, useSession } from '@fogo/sessions-sdk-react'
import { useState } from 'react'
import AmountInput from '@/components/AmountInput'
import QuoteRow from '@/components/QuoteRow'
import StatusLine from '@/components/StatusLine'
import { useProtocolState } from '@/hooks/useProtocolState'
import { useWithdraw } from '@/hooks/useWithdraw'
import { BONYC_DECIMALS, USDC_DECIMALS } from '@/lib/config'
import { safeQuoteWithdraw } from '@/lib/quote'
import { parseAmount } from '@/lib/tx'

export default function WithdrawCard() {
  const sessionState = useSession()
  const { status, withdraw } = useWithdraw(sessionState)
  const protocol = useProtocolState()
  const [input, setInput] = useState('')

  const parsed = parseAmount(input, BONYC_DECIMALS)
  const ready = isEstablished(sessionState) && parsed !== null && parsed > 0n
  const submitting = status.kind === 'pending'

  const quote = parsed && parsed > 0n && protocol
    ? safeQuoteWithdraw({
        inputBonyc: parsed,
        withdrawFeeBps: protocol.withdrawFeeBps,
        price: protocol.price,
        onycPrice: protocol.onycPrice,
      })
    : null

  const onSubmit = async () => {
    if (!ready || parsed === null) {
      return
    }
    await withdraw(parsed)
  }

  return (
    <section className="rounded-xl border border-neutral-800 bg-neutral-950 p-6 flex flex-col gap-4">
      <div>
        <h2 className="text-base font-semibold">Withdraw</h2>
        <p className="text-sm text-neutral-400">
          Burn bONyc. USDC.s arrives once OnRe fulfils the redemption (latency varies).
        </p>
      </div>
      <AmountInput
        value={input}
        onChange={setInput}
        symbol="bONyc"
        disabled={submitting}
      />
      <div className="flex flex-col gap-1.5">
        <QuoteRow
          label="Fee"
          amount={quote?.feeOnyc ?? null}
          decimals={BONYC_DECIMALS}
          symbol="ONyc"
          hint={protocol ? `${protocol.withdrawFeeBps} bps` : undefined}
        />
        <QuoteRow label="Redeemed" amount={quote?.netOnyc ?? null} decimals={BONYC_DECIMALS} symbol="ONyc" />
        <QuoteRow
          label="You receive"
          amount={quote?.outputUsdc ?? null}
          decimals={USDC_DECIMALS}
          symbol="USDC.s"
          hint="approx"
        />
      </div>
      <button
        type="button"
        onClick={onSubmit}
        disabled={!ready || submitting}
        className="w-full rounded-lg bg-sky-500 py-2.5 text-sm font-semibold text-black hover:bg-sky-400 disabled:cursor-not-allowed disabled:bg-neutral-800 disabled:text-neutral-500"
      >
        {submitting ? 'Withdrawing…' : 'Withdraw'}
      </button>
      <StatusLine status={status} />
    </section>
  )
}
