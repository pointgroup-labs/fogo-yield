'use client'

import type { PublicKey } from '@solana/web3.js'
import { useQuery } from '@tanstack/react-query'
import { FOGO_ONYC_DECIMALS, FOGO_ONYC_MINT, USDC_DECIMALS, USDC_S_MINT } from '@/constants'
import { useDocumentVisible } from '@/hooks/useDocumentVisible'
import { findFeeConfigPda, readFeeConfig } from '@/lib/bridge/feeConfig'
import { useSettings } from '@/store/settings'
import { getFogoConnection } from '@/utils/connections'

/**
 * Live preview of a leg's bridge fee.
 *
 * Both legs route through `intent_transfer.bridge_ntt_tokens` and pay the
 * fee in the bridged token itself (deposit USDC.s, redeem ONyc), deducting
 * `amount + fee` from the source ATA. The displayed figure is the on-chain
 * `FeeConfig.bridge_transfer_fee`, not the executor's FOGO-denominated
 * baseFee. `FeeConfig` changes rarely, so a slow refresh cadence is fine.
 */

export interface BridgeFeePreview {
  /** Fee amount in the fee mint's base units. `null` while loading. */
  feeRaw: bigint | null
  feeDecimals: number
  feeSymbol: string
  error: string | null
}

interface FeeLeg {
  mint: PublicKey
  decimals: number
  symbol: string
}

const FEE_LEG: Record<'deposit' | 'withdraw', FeeLeg> = {
  deposit: { mint: USDC_S_MINT, decimals: USDC_DECIMALS, symbol: 'USDC' },
  withdraw: { mint: FOGO_ONYC_MINT, decimals: FOGO_ONYC_DECIMALS, symbol: 'ONyc' },
}

export function useBridgeFee(kind: 'deposit' | 'withdraw' = 'deposit'): BridgeFeePreview {
  const visible = useDocumentVisible()
  const { fogoRpcUrl } = useSettings()
  const leg = FEE_LEG[kind]

  const query = useQuery({
    queryKey: ['bridge-fee', kind, fogoRpcUrl] as const,
    staleTime: 30_000,
    refetchInterval: visible ? 60_000 : false,
    queryFn: async (): Promise<bigint> => {
      const feeConfig = findFeeConfigPda(leg.mint)
      const conn = getFogoConnection(fogoRpcUrl)
      return (await readFeeConfig(conn, feeConfig)).bridgeTransferFee
    },
  })

  return {
    feeRaw: query.data ?? null,
    feeDecimals: leg.decimals,
    feeSymbol: leg.symbol,
    error: query.error?.message ?? null,
  }
}
