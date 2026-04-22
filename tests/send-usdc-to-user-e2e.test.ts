/**
 * E2E test for `send_usdc_to_user` against the real Wormhole Token Bridge `.so`.
 *
 * Independently verifies the outbound PDA helpers in
 * `packages/sdk/src/gateway.ts` (authority_signer, emitter, sender, Sequence,
 * Bridge config, fee_collector) and the 19-account ordering of
 * `buildTransferWrappedRemainingAccounts`. If any seed is wrong, TB
 * re-derives internally and the CPI fails with a constraint or
 * "AccountNotFound" error.
 *
 * Setup is intentionally minimal:
 *   - Flow PDA is synthesized in `Swapped` status — `send_usdc_to_user` only
 *     reads `status`, `amount`, `fogo_sender`, `payer`.
 *   - Wrapped-USDC ATA is hand-funded; mint supply patched to match so the
 *     burn doesn't underflow.
 *   - 4 mainnet PDAs loaded from on-disk fixtures; the relayer-scoped TB
 *     `sender` PDA is synthesized (no mainnet capture exists for our custom
 *     program ID).
 */

import {
  findAuthorityPda,
  findCoreBridgeSequencePda,
  findOutflightFlowPda,
  findTokenBridgeEmitterPda,
  findTokenBridgeSenderPda,
  FOGO_WORMHOLE_CHAIN_ID,
  RelayerClient,
  WORMHOLE_CORE_BRIDGE_ID,
} from '@fogo-onre/sdk'
import { getAssociatedTokenAddressSync } from '@solana/spl-token'
import { Keypair, PublicKey, SystemProgram } from '@solana/web3.js'
import { Clock, LiteSVM } from 'litesvm'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  createAta,
  createMint,
  createProvider,
  createSvm,
  createWrappedMint,
  FlowStatus,
  loadFixture,
  setFlowAccount,
  setupForeignEndpoint,
  setupMintAuthority,
  setupTokenBridgeConfig,
  setupWrappedMeta,
} from './utils'

// Mainnet captures used in-place; helper re-derivation is asserted by
// `tests/gateway-pda-derivations.test.ts`.
const TB_AUTHORITY_SIGNER_FIXTURE = '7oPa2PHQdZmjSPqvpZN7MQxnC7Dcf3uL4oLqknGLk2S3'
const TB_EMITTER_FIXTURE = 'Gv1KWf8DT1jKv5pKBmGaTmVszqa56Xn8YGx2Pg7i7qAk'
const CB_CONFIG_FIXTURE = '2yVjuQwpsvdsrywzsJJVs9Ueh4zayyo5DYJbBNc3DDpn'
const CB_FEE_COLLECTOR_FIXTURE = '9bFNrXNb2WTx8fMHXCheaZqkLZ3YCCaiqTftHxeintHy'

describe('send_usdc_to_user e2e (outbound TB TransferWrappedWithPayload CPI)', () => {
  let svm: LiteSVM
  let authority: Keypair
  let client: RelayerClient
  /** Wrapped USDC.s mint = TB PDA, no private key. */
  let usdcMint: { publicKey: PublicKey }
  let onycMint: Keypair
  let relayerAuthorityPda: PublicKey
  let nttInboxItem: PublicKey
  let outflightFlow: PublicKey

  const fogoSender = new Uint8Array(32).fill(0xCD)
  const USDCS_SOURCE_CHAIN = FOGO_WORMHOLE_CHAIN_ID // 51
  const USDCS_TOKEN_ADDR = new Uint8Array(32).fill(0xCC)
  const FOGO_TB_EMITTER = new Uint8Array(32).fill(0xEE)
  const sendAmount = 200_000n // 0.2 USDC.s

  beforeEach(async () => {
    svm = createSvm()
    // Core Bridge stamps message.timestamp from the sysvar; any real value works.
    svm.setClock(new Clock(0n, 0n, 0n, 0n, 1_773_882_000n))

    authority = Keypair.generate()
    const provider = createProvider(svm, authority)
    client = new RelayerClient(provider as any)
    ;[relayerAuthorityPda] = findAuthorityPda(client.program.programId)

    // Wormhole TB state — same PDAs in both directions for wrapped USDC.
    usdcMint = createWrappedMint(svm, USDCS_SOURCE_CHAIN, USDCS_TOKEN_ADDR, 6)
    setupTokenBridgeConfig(svm)
    setupForeignEndpoint(svm, USDCS_SOURCE_CHAIN, FOGO_TB_EMITTER)
    setupWrappedMeta(svm, usdcMint.publicKey, USDCS_SOURCE_CHAIN, USDCS_TOKEN_ADDR, 6)
    setupMintAuthority(svm)

    // ONyc mint exists only because `initialize()` requires it.
    onycMint = createMint(svm, authority, 6)
    const feeVault = createAta(svm, authority, onycMint.publicKey, authority.publicKey)

    await client
      .initialize({
        authority: authority.publicKey,
        usdcMint: usdcMint.publicKey,
        onycMint: onycMint.publicKey,
        feeVault,
        depositFeeBps: 50,
        withdrawFeeBps: 100,
      })
      .rpc()

    // Several internal CPIs cost rent for ephemeral accounts.
    svm.airdrop(relayerAuthorityPda, BigInt(5e9))

    // Pre-fund relayer USDC ATA + bump wrapped mint supply to match.
    // SPL TokenAccount: amount @ offset 64. SPL Mint: supply @ offset 36.
    const usdcAta = getAssociatedTokenAddressSync(usdcMint.publicKey, relayerAuthorityPda, true)
    const ataAcct = svm.getAccount(usdcAta)!
    const ataData = new Uint8Array(ataAcct.data)
    new DataView(ataData.buffer, ataData.byteOffset).setBigUint64(64, sendAmount, true)
    svm.setAccount(usdcAta, { ...ataAcct, data: ataData })

    const mintAcct = svm.getAccount(usdcMint.publicKey)!
    const mintData = new Uint8Array(mintAcct.data)
    new DataView(mintData.buffer, mintData.byteOffset).setBigUint64(36, sendAmount, true)
    svm.setAccount(usdcMint.publicKey, { ...mintAcct, data: mintData })

    loadFixture(svm, TB_AUTHORITY_SIGNER_FIXTURE)
    loadFixture(svm, TB_EMITTER_FIXTURE)
    loadFixture(svm, CB_CONFIG_FIXTURE)
    loadFixture(svm, CB_FEE_COLLECTOR_FIXTURE)

    // TB sender PDA — no mainnet capture (seed depends on our program ID).
    // TB checks the address but doesn't read data; empty system account suffices.
    const [senderPda] = findTokenBridgeSenderPda(client.program.programId)
    svm.setAccount(senderPda, {
      executable: false,
      owner: SystemProgram.programId,
      lamports: 1_000_000,
      data: new Uint8Array(0),
      rentEpoch: 0,
    })

    // Synthesize Flow at status=Swapped — `send_usdc_to_user` reads only
    // these four fields.
    nttInboxItem = Keypair.generate().publicKey
    let outflightFlowBump: number
    ;[outflightFlow, outflightFlowBump] = findOutflightFlowPda(nttInboxItem, client.program.programId)
    setFlowAccount(
      svm,
      outflightFlow,
      {
        fogoSender,
        status: FlowStatus.Swapped,
        amount: sendAmount,
        payer: authority.publicKey,
        bump: outflightFlowBump,
      },
      client.program.programId,
    )
  })

  it('cPIs into TB TransferWrappedWithPayload, posts CB message, closes flow', async () => {
    const messageKp = Keypair.generate()
    const usdcAta = getAssociatedTokenAddressSync(usdcMint.publicKey, relayerAuthorityPda, true)

    try {
      await client
        .sendUsdcToUser({
          payer: authority.publicKey,
          usdcMint: usdcMint.publicKey,
          nttInboxItem,
          rentDestination: authority.publicKey,
          tokenBridge: {
            wrappedMint: usdcMint.publicKey,
            recipientChain: FOGO_WORMHOLE_CHAIN_ID,
          },
          message: messageKp.publicKey,
        })
        .signers([messageKp])
        .rpc()
    } catch (e: any) {
      console.log('SEND ERROR:', e.message)
      if (e.logs) {
        console.log('SEND LOGS:', e.logs)
      }
      throw e
    }

    // Flow PDA closed → rent refunded.
    expect(svm.getAccount(outflightFlow)).toBeNull()

    // Wrapped-USDC ATA drained by the burn.
    const finalAta = svm.getAccount(usdcAta)!
    const finalBal = new DataView(
      finalAta.data.buffer,
      finalAta.data.byteOffset,
    ).getBigUint64(64, true)
    expect(finalBal).toEqual(0n)

    // CB-created message account.
    const messageAcct = svm.getAccount(messageKp.publicKey)
    expect(messageAcct).not.toBeNull()
    expect(messageAcct!.owner.toBase58()).toEqual(WORMHOLE_CORE_BRIDGE_ID.toBase58())

    // Sequence PDA initialized off the TB emitter — proves
    // findCoreBridgeSequencePda + findTokenBridgeEmitterPda agree with TB.
    const [emitterPda] = findTokenBridgeEmitterPda()
    const [sequencePda] = findCoreBridgeSequencePda(emitterPda)
    const seqAcct = svm.getAccount(sequencePda)
    expect(seqAcct).not.toBeNull()
    expect(seqAcct!.owner.toBase58()).toEqual(WORMHOLE_CORE_BRIDGE_ID.toBase58())
  })
})
