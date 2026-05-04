'use client'

import type { SessionState } from '@fogo/sessions-sdk-react'
import {
  buildFogoNttWithdrawIx,
  findAuthorityPda,
  RELAYER_PROGRAM_ID,
} from '@fogo-onre/sdk'
import { isEstablished, TransactionResultType } from '@fogo/sessions-sdk-react'
import { useState } from 'react'
import { BONYC_MINT } from '@/lib/config'
import { error, idle, pending, success, type TxStatus } from '@/lib/tx'

/**
 * Builds and sends the FOGO-side withdraw transaction: a Wormhole NTT
 * `transfer_lock` of bONyc back to Solana, addressed to the relayer
 * authority PDA. The originator's FOGO wallet is carried as
 * `NttManagerMessage.sender` automatically.
 *
 * The Solana side is then cranked permissionlessly:
 *   unlock_onyc → request_redemption_onyc → (OnRe admin fulfils async)
 *   → claim_redemption_usdc → send_usdc_to_user → USDC.s lands on user.
 */
export function useWithdraw(sessionState: SessionState) {
  const [status, setStatus] = useState<TxStatus>(idle)

  const withdraw = async (amount: bigint) => {
    if (!isEstablished(sessionState) || amount <= 0n) {
      return
    }

    setStatus(pending)
    try {
      const [recipientOnSolana] = findAuthorityPda(RELAYER_PROGRAM_ID)
      const ix = buildFogoNttWithdrawIx({
        payer: sessionState.walletPublicKey,
        bonycMint: BONYC_MINT,
        amount,
        recipientOnSolana,
      })
      const result = await sessionState.sendTransaction([ix])
      if (result.type === TransactionResultType.Failed) {
        const message = result.error instanceof Error
          ? result.error.message
          : typeof result.error === 'string'
            ? result.error
            : 'Withdraw transaction failed'
        setStatus(error(message))
        return
      }
      setStatus(success(result.signature))
    }
    catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Withdraw failed'
      setStatus(error(message))
    }
  }

  return { status, withdraw, reset: () => setStatus(idle) }
}
