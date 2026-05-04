'use client'

// MUST be the first import — see comment in polyfills.ts.
import './polyfills'

import type { ReactNode } from 'react'
import { FogoSessionProvider, Network } from '@fogo/sessions-sdk-react'
import { APP_DOMAIN, BONYC_MINT, FOGO_NETWORK, FOGO_RPC_URL, USDC_S_MINT } from '@/lib/config'

export default function Providers({ children }: { children: ReactNode }) {
  return (
    <FogoSessionProvider
      // Remount the provider when the RPC changes so the session
      // connection picks up the new endpoint cleanly.
      key={FOGO_RPC_URL}
      network={FOGO_NETWORK}
      rpc={FOGO_RPC_URL}
      domain={APP_DOMAIN}
      tokens={[USDC_S_MINT, BONYC_MINT]}
      enableUnlimited
    >
      {children}
    </FogoSessionProvider>
  )
}
