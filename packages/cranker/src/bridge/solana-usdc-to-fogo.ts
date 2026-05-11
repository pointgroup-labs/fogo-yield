import type { NttManagerMode } from '@fogo-onre/sdk'
import type { Connection, Keypair } from '@solana/web3.js'
import type { BridgeRedeemTarget } from './types'
import {
  decodeNttConfig,
  findInboxRateLimitPda,
  findNttConfigPda,
  findNttEmitterPda,
  findNttPeerPda,
  findRegisteredTransceiverPda,
  FOGO_WORMHOLE_CHAIN_ID,
  NTT_USDC_PROGRAM_ID,
  SOLANA_WORMHOLE_CHAIN_ID,
} from '@fogo-onre/sdk'
import { PublicKey } from '@solana/web3.js'
import { withTimeout } from '../utils/rpc'

/**
 * Default FOGO USDC.s mint. Same address as
 * `packages/webapp/src/constants.ts` `USDC_S_MINT`. The FOGO and Solana
 * legs use distinct mint addresses; this is the FOGO-side one that
 * `release_inbound_mint` mints into on delivery.
 */
export const DEFAULT_FOGO_USDC_MINT = new PublicKey('uSd2czE61Evaf76RNbq4KPpXnkiL3irdzgLFUMe3NoG')

export interface SolanaUsdcToFogoOptions {
  fogoConnection: Connection
  destSigner: Keypair
  /** Override the source emitter (defaults to PDA from `NTT_USDC_PROGRAM_ID`). */
  solanaUsdcEmitterHex?: string
  /** Override the FOGO-side USDC.s NTT manager program id. */
  fogoUsdcNttProgramId?: PublicKey
  /** Override the FOGO-side wormhole transceiver program id (bundled mode: equals manager). */
  fogoUsdcWhTransceiverProgramId?: PublicKey
  /** Override the FOGO USDC.s mint. */
  fogoUsdcMint?: PublicKey
  /** Override the expected manager mode (skip the on-chain probe). */
  expectedReleaseMode?: NttManagerMode
  rpcTimeoutMs?: number
}

/**
 * Solana USDC.s → FOGO USDC.s redemption target.
 *
 * Mirrors `buildSolanaOnycToFogoTarget` for the redeem leg of a
 * user-facing redemption: the Solana relayer's `send_usdc_to_user`
 * handler emits a Wormhole NTT VAA after `transfer_lock` +
 * `release_wormhole_outbound`, and this off-chain consumer redeems
 * it on FOGO so the user's USDC.s lands in their FOGO ATA.
 *
 * Without this target, redeemed VAAs accumulate on the guardian
 * network indefinitely — the deposit-side ONyc target only covers
 * the inbound (deposit completion) leg.
 *
 * Probes the FOGO USDC.s manager `Config` once at startup to assert
 * `mint` matches and `mode` matches `expectedReleaseMode` (if set).
 * The same governance-readiness probes as the ONyc target catch
 * missing per-source-chain `peer` / `registered_transceiver` /
 * `inbox_rate_limit` PDAs at startup, so the operator gets a
 * precise "missing governance call X" error instead of every VAA
 * silently failing with `AccountDiscriminatorNotFound (0xbb9)`.
 */
export async function buildSolanaUsdcToFogoTarget(
  opts: SolanaUsdcToFogoOptions,
): Promise<BridgeRedeemTarget> {
  const programId = opts.fogoUsdcNttProgramId ?? NTT_USDC_PROGRAM_ID
  // Bundled-transceiver mode: transceiver program id = manager program id.
  // Same convention as `WH_TRANSCEIVER_ONYC_PROGRAM_ID` aliasing.
  const whTransceiverProgramId = opts.fogoUsdcWhTransceiverProgramId ?? programId
  const mint = opts.fogoUsdcMint ?? DEFAULT_FOGO_USDC_MINT
  const sourceEmitterHex = opts.solanaUsdcEmitterHex
    ?? Buffer.from(findNttEmitterPda(NTT_USDC_PROGRAM_ID)[0].toBytes()).toString('hex')
  const rpcTimeoutMs = opts.rpcTimeoutMs ?? 15_000

  const [configPda] = findNttConfigPda(programId)
  const info = await withTimeout(
    opts.fogoConnection.getAccountInfo(configPda),
    rpcTimeoutMs,
    'fogo.getAccountInfo(NttConfig)',
  )
  if (!info) {
    throw new Error(
      `FOGO USDC.s NTT manager Config PDA (${configPda.toBase58()}) not found — `
      + `manager program ${programId.toBase58()} is not initialized on FOGO. `
      + `Run NTT init on FOGO before starting the bridge pipeline.`,
    )
  }
  const config = decodeNttConfig(Buffer.from(info.data))
  if (!config.mint.equals(mint)) {
    throw new Error(
      `FOGO USDC.s NTT manager Config.mint = ${config.mint.toBase58()} does not match `
      + `expected USDC.s mint ${mint.toBase58()} — likely wrong program id or mint override.`,
    )
  }
  if (opts.expectedReleaseMode && config.mode !== opts.expectedReleaseMode) {
    throw new Error(
      `FOGO USDC.s NTT manager Config.mode = ${config.mode} but expected ${opts.expectedReleaseMode}. `
      + `Operator override mismatched on-chain state; refusing to start.`,
    )
  }

  // Governance-readiness probes — identical shape to the ONyc target.
  // The redeem CPI references all three PDAs and aborts with
  // `AccountDiscriminatorNotFound (0xbb9)` if any is empty. Surface
  // precise missing-call diagnostics at startup so the bridge stays
  // noisy-but-healthy until governance lands the state, rather than
  // silently failing every VAA forever.
  const [peerPda] = findNttPeerPda(SOLANA_WORMHOLE_CHAIN_ID, programId)
  const [xcvrPda] = findRegisteredTransceiverPda(whTransceiverProgramId, programId)
  const [rateLimitPda] = findInboxRateLimitPda(SOLANA_WORMHOLE_CHAIN_ID, programId)

  const probes = [
    { name: 'peer', remedy: `set_peer(chain=${SOLANA_WORMHOLE_CHAIN_ID}, …)`, pda: peerPda },
    { name: 'registered_transceiver', remedy: 'register_transceiver(…)', pda: xcvrPda },
    { name: 'inbox_rate_limit', remedy: `set_inbound_limit(chain=${SOLANA_WORMHOLE_CHAIN_ID}, …)`, pda: rateLimitPda },
  ] as const

  const probeResults = await Promise.all(probes.map(p =>
    withTimeout(
      opts.fogoConnection.getAccountInfo(p.pda),
      rpcTimeoutMs,
      `fogo.getAccountInfo(${p.name})`,
    ).then(info => ({ ...p, present: !!info })),
  ))
  const missing = probeResults.filter(r => !r.present)
  const configReady = missing.length === 0
  const configError = configReady
    ? undefined
    : `FOGO USDC.s manager ${programId.toBase58()} is missing NTT-governance state for source chain `
      + `${SOLANA_WORMHOLE_CHAIN_ID}: ${missing.map(m => `${m.name} PDA ${m.pda.toBase58()} (run \`${m.remedy}\`)`).join('; ')}`

  return {
    name: 'solana-usdc-to-fogo',
    sourceChainId: SOLANA_WORMHOLE_CHAIN_ID,
    sourceEmitterHex,
    destChainId: FOGO_WORMHOLE_CHAIN_ID,
    destConnection: opts.fogoConnection,
    destNttManagerProgramId: programId,
    destWhTransceiverProgramId: whTransceiverProgramId,
    destMint: mint,
    destSigner: opts.destSigner,
    destReleaseMode: config.mode,
    configReady,
    configError,
  }
}
