/**
 * Wormhole-SDK orchestration for FOGO → Solana NTT bridging (both legs).
 *
 * Isolated so the heavy Wormhole bundle can be dynamically imported on
 * demand from `depositContext.ts` / `withdrawContext.ts`. Two exports —
 * `fetchUsdcSDepositQuote()` and `fetchOnycRedeemQuote()` — wrap a shared
 * `fetchNttIntentQuote()` core returning the signed executor quote, the
 * full `NttBridgeSubAccounts` constellation, and the bridging LUT.
 *
 * Mirrors `buildWormholeTransfer + getNttPdas` from `@fogo/sessions-sdk`,
 * which we can't reuse directly because its `bridgeOut` hardcodes the
 * recipient to the wallet pubkey — OnRe needs the per-user inbox PDA.
 * Keep this in lockstep with that source on SDK bumps.
 */

import type { NttBridgeSubAccounts } from '@fogo-onre/sdk'
import { NTT_ONYC_PROGRAM_ID, ONYC_DECIMALS, ONYC_MINT } from '@fogo-onre/sdk'
import { Network } from '@fogo/sessions-sdk-react'
import { PublicKey } from '@solana/web3.js'
import { Wormhole, wormhole } from '@wormhole-foundation/sdk'
import { contracts } from '@wormhole-foundation/sdk-base'
import * as routes from '@wormhole-foundation/sdk-connect/routes'
import { nttExecutorRoute } from '@wormhole-foundation/sdk-route-ntt'
import { utils } from '@wormhole-foundation/sdk-solana-core'
import { NTT, register as registerNttSolana } from '@wormhole-foundation/sdk-solana-ntt'
import solanaSdk from '@wormhole-foundation/sdk/solana'
import {
  FOGO_DEPOSIT_LUT_OVERRIDE,
  FOGO_NETWORK,
  FOGO_ONYC_MINT,
  FOGO_ONYC_NTT_MANAGER_ID,
  FOGO_REDEEM_LUT_OVERRIDE,
} from '@/constants'
import { formatBaseUnitsExact } from '@/utils/transfer'

// Installs the NTT protocol on the Solana platform. Idempotent — safe at
// module load. Mirrors sessions-sdk `registerNtt()`.
registerNttSolana()

/**
 * Bridging LUT per `(network, USDC.s mint)`. Mirrors
 * `BRIDGING_ADDRESS_LOOKUP_TABLE` in `@fogo/sessions-sdk`: union of
 * intent_transfer + NTT-manager accounts that `bridge_ntt_tokens` touches,
 * shrinking the tx under the 1232-byte legacy limit (the per-manager
 * `["lut"]` wrapper PDA only covers NTT-side accounts).
 */
const BRIDGING_LUT_BY_USDC_S_MINT: Record<Network, string> = {
  [Network.Mainnet]: '7hmMz3nZDnPJfksLuPotKmUBAFDneM2D9wWg3R1VcKSv',
  [Network.Testnet]: '4FCi6LptexBdZtaePsoCMeb1XpCijxnWu96g5LsSb6WP',
}

const NETWORK_TO_WORMHOLE_NETWORK = {
  [Network.Mainnet]: 'Mainnet',
  [Network.Testnet]: 'Testnet',
} as const

/**
 * Mirror of the `USDC` constant in `@fogo/sessions-sdk-react/wormhole-routes`
 * (its `exports` map doesn't publish that entry, so we inline it). Stable
 * on-chain identifiers — keep in lockstep on `@fogo/sessions-sdk-react` bumps.
 */
const WORMHOLE_USDC = {
  chains: {
    [Network.Mainnet]: {
      fogo: {
        chain: 'Fogo' as const,
        manager: new PublicKey('nttu74CdAmsErx5daJVCQNoDZujswFrskMzonoZSdGk'),
        mint: new PublicKey('uSd2czE61Evaf76RNbq4KPpXnkiL3irdzgLFUMe3NoG'),
        transceiver: new PublicKey('9ioH2HQmVsnbmA8Ej5o1LCAHPRisS8of4whyjCNHJXiw'),
      },
      solana: {
        chain: 'Solana' as const,
        manager: new PublicKey('nttu74CdAmsErx5daJVCQNoDZujswFrskMzonoZSdGk'),
        mint: new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'),
        transceiver: new PublicKey('9ioH2HQmVsnbmA8Ej5o1LCAHPRisS8of4whyjCNHJXiw'),
      },
    },
    [Network.Testnet]: {
      fogo: {
        chain: 'Fogo' as const,
        manager: new PublicKey('NTtktYPsu3a9fvQeuJW6Ea11kinvGc7ricT1iikaTue'),
        mint: new PublicKey('ELNbJ1RtERV2fjtuZjbTscDekWhVzkQ1LjmiPsxp5uND'),
        transceiver: new PublicKey('GJVgi8cwwUuyjjzM19xnT3KNYoX4pXvpp8UAS3ikgZLB'),
      },
      solana: {
        chain: 'Solana' as const,
        manager: new PublicKey('NTtktYPsu3a9fvQeuJW6Ea11kinvGc7ricT1iikaTue'),
        mint: new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU'),
        transceiver: new PublicKey('BLu7SyjSHWZVsiSSWhx3f3sL11rBpuzRYM1HyobVZR4v'),
      },
    },
  },
  decimals: 6,
}

/**
 * ONyc NTT token leg. Mainnet only — the OnRe ONyc deployment has no
 * testnet peer, so a testnet redeem throws. Both chains run the same
 * manager program in bundled-transceiver mode, so the transceiver is the
 * manager itself.
 */
const WORMHOLE_ONYC = {
  chains: {
    [Network.Mainnet]: {
      fogo: {
        chain: 'Fogo' as const,
        manager: FOGO_ONYC_NTT_MANAGER_ID,
        mint: FOGO_ONYC_MINT,
        transceiver: NTT_ONYC_PROGRAM_ID,
      },
      solana: {
        chain: 'Solana' as const,
        manager: NTT_ONYC_PROGRAM_ID,
        mint: ONYC_MINT,
        transceiver: NTT_ONYC_PROGRAM_ID,
      },
    },
  },
  decimals: ONYC_DECIMALS,
}

interface NttTokenEndpoint {
  chain: 'Fogo' | 'Solana'
  manager: PublicKey
  mint: PublicKey
  transceiver: PublicKey
}

/**
 * One FOGO→Solana NTT route: source + destination token endpoints, the
 * shared decimals, the route-config token key, and the bridging LUT (may
 * be absent until an operator deploys one for this leg).
 */
interface NttLeg {
  from: NttTokenEndpoint
  to: NttTokenEndpoint
  decimals: number
  routeTokenKey: string
  lut: PublicKey | null
}

export interface FetchNttIntentQuoteParams {
  /** The user's FOGO wallet pubkey. */
  walletPublicKey: PublicKey
  /** Per-user inbox PDA on Solana — the bridge's true recipient. */
  recipientOnSolana: PublicKey
  /** Bridge amount in base units (leg decimals). */
  amount: bigint
  /** Outbox-item keypair pubkey (caller adds the Keypair to extraSigners). */
  outboxItem: PublicKey
  /** Solana RPC endpoint — passed straight to `wormhole({chains})`. */
  solanaRpcUrl: string
  /** Pubkey that signs `bridge_ntt_tokens` — the intent_transfer setter PDA. */
  intentTransferSetter: PublicKey
}

export interface FetchNttIntentQuoteResult {
  signedQuoteBytes: Uint8Array
  ntt: NttBridgeSubAccounts
  /**
   * Bridging LUT for `sendTransaction`. The unrolled `bridge_ntt_tokens`
   * ix references ~30 accounts and won't fit a 1232-byte legacy tx.
   * `undefined` when the leg has no LUT configured (redeem until deployed).
   */
  addressLookupTable: PublicKey | undefined
}

/** USDC.s deposit: FOGO→Solana through the USDC NTT managers. */
export async function fetchUsdcSDepositQuote(
  params: FetchNttIntentQuoteParams,
): Promise<FetchNttIntentQuoteResult> {
  const usdc = WORMHOLE_USDC.chains[FOGO_NETWORK]
  // Prefer our custom union LUT (bridging LUT + 7 globals it misses when
  // fee_token = wFOGO); fall back to the Sessions-SDK bridging LUT.
  const lut = FOGO_DEPOSIT_LUT_OVERRIDE ?? BRIDGING_LUT_BY_USDC_S_MINT[FOGO_NETWORK]
  return fetchNttIntentQuote(
    {
      from: usdc.fogo,
      to: usdc.solana,
      decimals: WORMHOLE_USDC.decimals,
      routeTokenKey: 'USDC',
      lut: new PublicKey(lut),
    },
    params,
  )
}

/**
 * ONyc redeem: FOGO→Solana through the ONyc NTT managers, a hard mirror
 * of deposit. The bridging LUT is operator-supplied
 * (`FOGO_REDEEM_LUT_OVERRIDE`); until one is deployed the redeem tx may
 * exceed the legacy-tx size limit.
 */
export async function fetchOnycRedeemQuote(
  params: FetchNttIntentQuoteParams,
): Promise<FetchNttIntentQuoteResult> {
  if (FOGO_NETWORK !== Network.Mainnet) {
    throw new Error('ONyc redeem is only configured on mainnet (no testnet NTT peer registered).')
  }
  const onyc = WORMHOLE_ONYC.chains[Network.Mainnet]
  return fetchNttIntentQuote(
    {
      from: onyc.fogo,
      to: onyc.solana,
      decimals: WORMHOLE_ONYC.decimals,
      routeTokenKey: 'ONyc',
      lut: FOGO_REDEEM_LUT_OVERRIDE === null ? null : new PublicKey(FOGO_REDEEM_LUT_OVERRIDE),
    },
    params,
  )
}

/**
 * Shared core: fetches the executor quote AND derives every NTT
 * sub-account the `bridge_ntt_tokens` ix needs for `leg`, in a single
 * call so callers don't sequence two async dances.
 */
async function fetchNttIntentQuote(
  leg: NttLeg,
  params: FetchNttIntentQuoteParams,
): Promise<FetchNttIntentQuoteResult> {
  const { walletPublicKey, recipientOnSolana, amount, outboxItem, solanaRpcUrl, intentTransferSetter } = params
  const { from: fromToken, to: toToken, decimals } = leg

  const wh = await wormhole(NETWORK_TO_WORMHOLE_NETWORK[FOGO_NETWORK], [solanaSdk], {
    chains: { Solana: { rpc: solanaRpcUrl } },
  })

  // Single-token NTT route covering Fogo↔Solana for this leg. The executor
  // (`https://executor.labsapis.com`) is hardcoded inside the route module.
  const Route = nttExecutorRoute({
    ntt: {
      tokens: {
        [leg.routeTokenKey]: [
          {
            chain: fromToken.chain,
            manager: fromToken.manager.toBase58(),
            token: fromToken.mint.toBase58(),
            transceiver: [{ address: fromToken.transceiver.toBase58(), type: 'wormhole' }],
          },
          {
            chain: toToken.chain,
            manager: toToken.manager.toBase58(),
            token: toToken.mint.toBase58(),
            transceiver: [{ address: toToken.transceiver.toBase58(), type: 'wormhole' }],
          },
        ],
      },
    },
  })
  const route = new Route(wh)
  const transferRequest = await routes.RouteTransferRequest.create(wh, {
    destination: Wormhole.tokenId(toToken.chain, toToken.mint.toBase58()),
    // Recipient is the per-user inbox PDA, NOT the wallet pubkey — the
    // whole reason we don't reuse sessions-sdk's `bridgeOut`.
    recipient: Wormhole.chainAddress(toToken.chain, recipientOnSolana.toBase58()),
    source: Wormhole.tokenId(fromToken.chain, fromToken.mint.toBase58()),
  })
  const validated = await route.validate(transferRequest, {
    amount: formatBaseUnitsExact(amount, decimals),
    options: route.getDefaultOptions(),
  })
  if (!validated.valid) {
    throw validated.error
  }
  // `fetchExecutorQuote` is part of the runtime API despite the TS surface
  // hiding it (sessions-sdk uses the same `@ts-expect-error`). `payeeAddress`
  // is raw 32 bytes — pass straight to `new PublicKey(Uint8Array)`.
  const quote = await (route as unknown as {
    fetchExecutorQuote: (
      r: typeof transferRequest,
      p: typeof validated.params,
    ) => Promise<{ signedQuote: Uint8Array, payeeAddress: Uint8Array }>
  }).fetchExecutorQuote(transferRequest, validated.params)

  const payeeAddress = new PublicKey(quote.payeeAddress)
  const ntt = await deriveNttSubAccounts({
    fromTokenManager: fromToken.manager,
    fromTokenMint: fromToken.mint,
    walletPublicKey,
    recipientOnSolana,
    outboxItem,
    intentTransferSetter,
    amount,
    wh,
  })

  return {
    signedQuoteBytes: new Uint8Array(quote.signedQuote),
    ntt: { ...ntt, payeeNttWithExecutor: payeeAddress },
    addressLookupTable: leg.lut ?? undefined,
  }
}

interface DeriveNttArgs {
  fromTokenManager: PublicKey
  fromTokenMint: PublicKey
  walletPublicKey: PublicKey
  recipientOnSolana: PublicKey
  outboxItem: PublicKey
  intentTransferSetter: PublicKey
  amount: bigint
  wh: Awaited<ReturnType<typeof wormhole>>
}

/**
 * Mirrors sessions-sdk `getNttPdas` (index.js:778-810) line-for-line,
 * with two deliberate substitutions:
 *   - The recipient bound into `nttSessionAuthority`'s args-keccak is
 *     the per-user inbox PDA (not the wallet pubkey).
 *   - `payeeNttWithExecutor` is filled by the caller with the
 *     quote-published payee address.
 */
function deriveNttSubAccounts(args: DeriveNttArgs): Promise<Omit<NttBridgeSubAccounts, 'payeeNttWithExecutor'>> {
  const { fromTokenManager, fromTokenMint, recipientOnSolana, outboxItem, intentTransferSetter, amount, wh } = args

  const pdas = NTT.pdas(fromTokenManager)
  const transceiverPdas = NTT.transceiverPdas(fromTokenManager)
  const solana = wh.getChain('Solana')
  const coreBridgeContract = contracts.coreBridge.get(wh.network, 'Fogo')
  if (coreBridgeContract === undefined) {
    throw new Error('Wormhole core bridge contract not registered for Fogo on this network.')
  }
  const wormholePdas = utils.getWormholeDerivedAccounts(fromTokenManager, coreBridgeContract)
  const [registeredTransceiverPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('registered_transceiver'), fromTokenManager.toBytes()],
    fromTokenManager,
  )

  // `NTT.custodyAccountAddress` is async (loads token-program metadata),
  // so await it alongside the synchronous PDA derivations.
  return NTT.custodyAccountAddress(pdas, fromTokenMint).then(nttCustody => ({
    nttManager: fromTokenManager,
    nttConfig: pdas.configAccount(),
    nttCustody,
    nttInboxRateLimit: pdas.inboxRateLimitAccount(solana.chain),
    nttOutboxItem: outboxItem,
    nttOutboxRateLimit: pdas.outboxRateLimitAccount(),
    nttPeer: pdas.peerAccount(solana.chain),
    nttSessionAuthority: pdas.sessionAuthority(
      intentTransferSetter,
      NTT.transferArgs(amount, Wormhole.chainAddress('Solana', recipientOnSolana.toBase58()), false),
    ),
    nttTokenAuthority: pdas.tokenAuthority(),
    transceiver: registeredTransceiverPda,
    emitter: transceiverPdas.emitterAccount(),
    wormholeBridge: wormholePdas.wormholeBridge,
    wormholeFeeCollector: wormholePdas.wormholeFeeCollector,
    wormholeMessage: transceiverPdas.wormholeMessageAccount(outboxItem),
    wormholeProgram: new PublicKey(coreBridgeContract),
    wormholeSequence: wormholePdas.wormholeSequence,
    nttWithExecutorProgram: new PublicKey('nex1gkSWtRBheEJuQZMqHhbMG5A45qPU76KqnCZNVHR'),
    executorProgram: new PublicKey('execXUrAsMnqMmTHj5m7N1YQgsDz3cwGLYCYyuDRciV'),
  }))
}
