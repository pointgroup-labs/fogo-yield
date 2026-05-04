'use client'

import type { SessionState } from '@fogo/sessions-sdk-react'
import {
  buildFogoNttDepositIx,
  findAuthorityPda,
  RELAYER_PROGRAM_ID,
} from '@fogo-onre/sdk'
import { isEstablished, TransactionResultType } from '@fogo/sessions-sdk-react'
import { useState } from 'react'
import { USDC_S_MINT } from '@/lib/config'
import { error, idle, pending, success, type TxStatus } from '@/lib/tx'

/**
 * Builds and sends the FOGO-side deposit transaction: a Wormhole NTT
 * `transfer_lock` of USDC.s from the user to the relayer authority PDA on
 * Solana. The originator's FOGO wallet is carried automatically as
 * `NttManagerMessage.sender`; no custom payload is needed.
 *
 * The Solana side is then cranked permissionlessly:
 *   claim_usdc → swap_usdc_to_onyc → lock_onyc → bONyc lands on the user.
 */
export function useDeposit(sessionState: SessionState) {
  const [status, setStatus] = useState<TxStatus>(idle)

  const deposit = async (amount: bigint) => {
    if (!isEstablished(sessionState) || amount <= 0n) {
      return
    }

    setStatus(pending)
    try {
      const [recipientOnSolana] = findAuthorityPda(RELAYER_PROGRAM_ID)
      const ix = buildFogoNttDepositIx({
        payer: sessionState.walletPublicKey,
        usdcSMint: USDC_S_MINT,
        amount,
        recipientOnSolana,
      })
      const result = await sessionState.sendTransaction([ix])
      if (result.type === TransactionResultType.Failed) {
        const message = result.error instanceof Error
          ? result.error.message
          : typeof result.error === 'string'
            ? result.error
            : 'Deposit transaction failed'
        setStatus(error(message))
        return
      }
      setStatus(success(result.signature))
    }
    catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Deposit failed'
      setStatus(error(message))
    }
  }

  return { status, deposit, reset: () => setStatus(idle) }
}
