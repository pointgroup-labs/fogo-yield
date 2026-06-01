/**
 * Shared constants, types, and helpers for the `cranker` subcommands.
 * Each subcommand lives in its own file and pulls what it needs from here,
 * so the command files stay focused on their pre-flight gates + plan output.
 */

import type { FlowAccount } from '@fogo-onre/sdk'
import { deriveUserWalletFromFogoTx, describeStatus, findUserInboxAuthorityPda, WormholescanClient } from '@fogo-onre/sdk'
import { Connection, PublicKey } from '@solana/web3.js'
// Auto-registration on import is deprecated in sdk 4.x; call `register()`
// explicitly so `deserialize('Ntt:WormholeTransfer', bytes)` resolves.
import { register as registerNttPayloads } from '@wormhole-foundation/sdk-definitions-ntt'
import { SolanaNtt } from '@wormhole-foundation/sdk-solana-ntt'
import chalk from 'chalk'

registerNttPayloads()

// Wormhole Core Bridge program ID (Solana mainnet). Stable on-chain
// identifier; testnet/devnet would need a different value but this CLI
// is mainnet-targeted by default (see context.ts:resolveRpcUrl).
export const WORMHOLE_CORE_MAINNET = 'worm2ZoG2kUd4vFXhvjh93UUH596ayRfgQ2MgjNMTth'

// Default NTT IDL version for SolanaNtt. The on-chain ONyc NTT manager
// version determines whether `release_wormhole_outbound` needs the
// extra `manager` + `outboxItemSigner` accounts (v3+) or not (v2).
// Override with `--ntt-version` if a future deploy bumps the manager.
export const DEFAULT_NTT_VERSION = '3.0.0'

export const DEFAULT_WORMHOLESCAN_URL = 'https://api.wormholescan.io'

// FOGO-side constants for the cross-chain redeem step. The ONyc NTT
// manager and mint are mirrored from the webapp (`packages/webapp/src/constants.ts`).
// FOGO mainnet Wormhole core program id is published in
// `@wormhole-foundation/sdk-base` (constants/contracts/core.js).
export const FOGO_ONYC_NTT_MANAGER_ID = 'nttpna5vXW7BN2Aa4AfTbkCncJWTEoBsnWvjS87Xgsd'
export const FOGO_ONYC_MINT = 'oNyCm1QsAatj3ckaEwZjtAPWvstPn3Zm5MAYPtkjEfa'
export const FOGO_WORMHOLE_CORE_MAINNET = 'worm2mrQkG1B1KTz37erMfWN8anHkSK24nzca7UD8BB'
// First-party Fogo Labs RPC, matching the webapp default in
// `packages/webapp/src/store/settings.ts`.
export const FOGO_RPC_DEFAULT = 'https://mainnet.fogo.io'

// OnRe `take_offer_one` discriminator (anchor sighash) — the deposit-leg
// swap payload for the route-agnostic `swap` instruction.
export const TAKE_OFFER_DISCRIMINATOR = Buffer.from([37, 190, 224, 77, 197, 39, 203, 230])

/**
 * Source label for `userWallet` resolution, threaded into plan output so
 * the operator can audit how the CLI picked the wallet that seeds the
 * inbox-authority PDA.
 *
 *   flag             — explicit `--user-wallet`
 *   signer-auto      — current keypair derives the matching PDA
 *   sender-auto      — VAA's NTT `sender` field derives the matching PDA
 *                      (true for non-Session direct deposits)
 *   fogo-tx-recovery — read FOGO source tx's `bridge_ntt_tokens`
 *                      source-ATA owner; only firing when the first two
 *                      probes miss (Fogo Sessions case: VAA sender is the
 *                      session keypair, not the wallet that owns the ATA)
 *   sender-fallback  — none matched; used by `claim-usdc` so Pre-flight 4
 *                      can throw the standard mismatch diagnostic
 */
export type UserWalletSource = 'flag' | 'signer-auto' | 'sender-auto' | 'fogo-tx-recovery' | 'sender-fallback'

export interface ResolveUserWalletArgs {
  programId: PublicKey
  signer: PublicKey
  resolved: { recipientOnSolana: PublicKey, senderOnSource: PublicKey }
  fogoConnection: Connection
  fogoTx: string
}

/**
 * Three-stage userWallet auto-detect — kept in lockstep with the daemon's
 * resolver in `packages/cranker/src/relayer/claim-usdc.ts`.
 *
 * Order matters: cheap PDA derivations first, network round-trip last.
 *   1. Signer  — operator cranking their own deposit (most common)
 *   2. VAA sender — non-Session direct FOGO deposit
 *   3. FOGO source-ATA owner — Sessions deposit. The session keypair
 *      signed the bridge ix (so it appears as VAA sender), but the per-
 *      user inbox PDA is seeded against the main wallet that owns the
 *      USDC.s ATA the burn pulled from. The SDK helper reads that ATA's
 *      owner from the FOGO tx; one RPC call, gates exactly the case the
 *      first two probes miss.
 *
 * Returns `null` when all three miss — callers decide whether to throw
 * with a precise message or fall through to a downstream pre-flight that
 * will throw with the standard mismatch diagnostic.
 */
export async function autoDetectUserWallet(
  args: ResolveUserWalletArgs,
): Promise<{ wallet: PublicKey, source: 'signer-auto' | 'sender-auto' | 'fogo-tx-recovery' } | null> {
  const deriveInboxAuthority = (wallet: PublicKey): PublicKey => {
    const [pda] = findUserInboxAuthorityPda(wallet, args.programId)
    return pda
  }
  const target = args.resolved.recipientOnSolana
  if (deriveInboxAuthority(args.signer).equals(target)) {
    return { wallet: args.signer, source: 'signer-auto' }
  }
  if (deriveInboxAuthority(args.resolved.senderOnSource).equals(target)) {
    return { wallet: args.resolved.senderOnSource, source: 'sender-auto' }
  }
  const recovered = await deriveUserWalletFromFogoTx(args.fogoConnection, args.fogoTx).catch(() => null)
  if (recovered && deriveInboxAuthority(recovered).equals(target)) {
    return { wallet: recovered, source: 'fogo-tx-recovery' }
  }
  return null
}

export interface FetchVaaArgs {
  fogoTx: string
  vaaHex?: string
  wormholescanUrl?: string
}

export async function fetchVaaBytes(args: FetchVaaArgs): Promise<Uint8Array> {
  if (args.vaaHex) {
    const hex = args.vaaHex.startsWith('0x') ? args.vaaHex.slice(2) : args.vaaHex
    if (!/^[0-9a-f]+$/i.test(hex) || hex.length % 2 !== 0) {
      throw new Error('--vaa must be a hex string (optional 0x prefix)')
    }
    return Uint8Array.from(Buffer.from(hex, 'hex'))
  }
  const wh = new WormholescanClient({ baseUrl: args.wormholescanUrl })
  const bytes = await wh.resolveVaaByTxHash(args.fogoTx)
  if (!bytes) {
    throw new Error(
      `Wormholescan returned no VAA for tx ${args.fogoTx} — `
      + `guardians may not have observed it yet (typical lag: a few seconds), `
      + `or the tx didn't emit a Wormhole message.`,
    )
  }
  return bytes
}

export function printFlow(label: string, flow: FlowAccount) {
  console.log(chalk.cyan(`\nFlow (${label})`))
  console.log(chalk.dim(`  recipient:  ${flow.recipient.toBase58()}`))
  console.log(chalk.dim(`  status:     ${describeStatus(flow.status)}`))
  console.log(chalk.dim(`  amount:     ${flow.amount.toString()}`))
  console.log(chalk.dim(`  payer:      ${flow.payer.toBase58()}`))
}

export function nextDepositStep(status: FlowAccount['status'], fogoTx: string): string {
  // Deposit chain (set by relayer instructions, see programs/relayer/src/instructions/*.rs):
  //   receive → Received
  //   swap    → Swapped
  //   send    → Flow closed (no terminal status — handled by !inflight branch upstream)
  if ('received' in status) {
    return `cranker swap-usdc-to-onyc --fogo-tx ${fogoTx}`
  }
  if ('swapped' in status) {
    return `cranker lock-onyc --fogo-tx ${fogoTx}`
  }
  return `unknown — inflight Flow in unexpected state ${describeStatus(status)} for the deposit chain`
}

export function nextWithdrawStep(status: FlowAccount['status'], fogoTx: string): string {
  // Withdraw chain:
  //   receive → Received
  //   swap    → Swapped
  //   send    → Flow closed
  if ('received' in status) {
    return `cranker swap-onyc-to-usdc --fogo-tx ${fogoTx}  (not yet implemented in CLI v1)`
  }
  if ('swapped' in status) {
    return `cranker send-usdc-to-user --fogo-tx ${fogoTx}  (not yet implemented in CLI v1)`
  }
  return `unknown — outflight Flow in unexpected state ${describeStatus(status)} for the withdraw chain`
}

export interface MakeSolanaNttArgs {
  connection: Connection
  manager: PublicKey
  token: PublicKey
  wormholeCore: string
  version: string
}

/**
 * Build a `SolanaNtt` instance configured for the OnRe ONyc deployment.
 * The transceiver is baked into the manager binary, so we wire
 * `transceiver.wormhole = manager`. Used both directly by
 * `release-outbound` and by the `advance` orchestrator step.
 */
export function makeSolanaNtt(args: MakeSolanaNttArgs): SolanaNtt<'Mainnet', 'Solana'> {
  return new SolanaNtt(
    'Mainnet',
    'Solana',
    args.connection,
    {
      coreBridge: args.wormholeCore,
      ntt: {
        manager: args.manager.toBase58(),
        token: args.token.toBase58(),
        // Baked-in: transceiver program ID == manager program ID.
        transceiver: { wormhole: args.manager.toBase58() },
      },
    },
    args.version,
  )
}

/**
 * Derive the 7-pubkey `release` argument for `client.send({...})` from
 * a `SolanaNtt` instance. Pulls the wormhole-core PDAs (bridge,
 * fee_collector, sequence) and the v3 `outbox_item_signer` PDA out of the
 * NTT SDK's own `createReleaseWormholeOutboundIx` so we don't have to
 * mirror those derivations here. Index positions match the NTT v3 IDL
 * for `releaseWormholeOutbound` (verified against
 * `idl/3_0_0/json/example_native_token_transfers.json`):
 *   k[ 3] = transceiver (registered_transceiver PDA)
 *   k[ 4] = wormhole_message (writable, init'd by NTT v3)
 *   k[ 5] = emitter
 *   k[ 6] = wormhole.bridge
 *   k[ 7] = wormhole.fee_collector
 *   k[ 8] = wormhole.sequence
 *   k[ 9] = wormhole.program
 *   k[14] = outbox_item_signer (v3)
 *
 * Mirrors `packages/cranker/src/relayer/lock-onyc.ts:deriveLockOnycReleaseAccounts`;
 * the CLI and daemon must use the same indexes or `lock_onyc` aborts
 * with Anchor `ConstraintSeeds (2006)` on `wormhole_message`.
 */
export async function deriveLockOnycReleaseAccounts(
  ntt: SolanaNtt<'Mainnet', 'Solana'>,
  payer: PublicKey,
  outboxItem: PublicKey,
): Promise<{
  wormholeProgram: PublicKey
  wormholeBridge: PublicKey
  wormholeFeeCollector: PublicKey
  wormholeSequence: PublicKey
  outboxItemSigner: PublicKey
  wormholeMessage: PublicKey
  emitter: PublicKey
}> {
  const xcvr = await ntt.getWormholeTransceiver()
  if (!xcvr) {
    throw new Error('SolanaNttWormholeTransceiver wiring failed.')
  }
  const releaseIx = await xcvr.createReleaseWormholeOutboundIx(payer, outboxItem, false)
  const k = releaseIx.keys
  return {
    wormholeMessage: k[4].pubkey,
    emitter: k[5].pubkey,
    wormholeBridge: k[6].pubkey,
    wormholeFeeCollector: k[7].pubkey,
    wormholeSequence: k[8].pubkey,
    wormholeProgram: k[9].pubkey,
    outboxItemSigner: k[14].pubkey,
  }
}
