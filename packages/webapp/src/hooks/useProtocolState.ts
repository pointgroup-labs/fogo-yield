'use client'

import type { OnycPriceSnapshot } from '@fogo-onre/sdk'
import { computeOnycPrice } from '@fogo-onre/sdk'
import { useEffect, useState } from 'react'

/**
 * Source of truth for the current `RelayerConfig` snapshot the UI quotes
 * against. Today these are placeholder constants — replace with a fetcher
 * (RelayerClient.fetchConfig + OnRe state read + Wormhole Queries) when the
 * data path is wired.
 *
 * Returning a stable shape from one hook means swapping the source out later
 * is a one-file change and every quote in the UI follows.
 */

export interface ProtocolState {
  depositFeeBps: number
  withdrawFeeBps: number
  price: OnycPriceSnapshot
  onycPrice: bigint
}

const PRICE_SCALE = 1_000_000_000n

// "1.0 USDC per 1 ONyc" as a base-unit ratio scaled by PRICE_SCALE.
// USDC=6, ONyc=9 → 1e6 / 1e9 = 0.001 → stored as 1_000_000.
const PLACEHOLDER_PRICE: OnycPriceSnapshot = {
  basePrice: 1_000_000n,
  priceScale: PRICE_SCALE,
  aprBps: 0, // unknown — set to live OnRe APR when the fetcher lands
  startTimestamp: 0n,
}

export function useProtocolState(): ProtocolState | null {
  const [now, setNow] = useState<bigint | null>(null)

  useEffect(() => {
    setNow(BigInt(Math.floor(Date.now() / 1000)))
    const id = setInterval(() => {
      setNow(BigInt(Math.floor(Date.now() / 1000)))
    }, 30_000)
    return () => clearInterval(id)
  }, [])

  if (now === null) {
    return null
  }

  return {
    depositFeeBps: 25,
    withdrawFeeBps: 25,
    price: PLACEHOLDER_PRICE,
    onycPrice: computeOnycPrice(PLACEHOLDER_PRICE, now),
  }
}
