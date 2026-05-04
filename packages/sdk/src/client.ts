import type { Provider } from '@anchor-lang/core'
import type { PublicKey } from '@solana/web3.js'
import type { NttRedeemContext, NttTransferLockContext } from './ntt'
import type { OnreSwapContext } from './onre'
import type { Relayer } from './types/fogo_onre_relayer'
import { BN, Program } from '@anchor-lang/core'

import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token'
import {
  SystemProgram,
} from '@solana/web3.js'
import { FOGO_WORMHOLE_CHAIN_ID, NTT_PROGRAM_ID } from './constants'
import IDL from './idl/fogo_onre_relayer.json' with { type: 'json' }
import {
  findInboxRateLimitPda,
  findNttConfigPda,
  findNttPeerPda,
  findOutboxRateLimitPda,
  findRegisteredTransceiverPda,
  findSessionAuthorityPda,
  findTokenAuthorityPda,
  nttTransferArgsHash,
} from './ntt'
import {
  buildOnreCancelRedemptionRequestRemainingAccounts,
  buildOnreCreateRedemptionRequestRemainingAccounts,
  buildOnreSwapRemainingAccounts,
} from './onre'
import {
  findAuthorityPda,
  findConfigPda,
  findInflightFlowPda,
  findOutflightFlowPda,
  findRedemptionTrackerPda,
} from './pda'

export class RelayerClient {
  readonly program: Program<Relayer>
  readonly configPda: PublicKey
  readonly authorityPda: PublicKey

  constructor(provider: Provider) {
    this.program = new Program<Relayer>(IDL as unknown as Relayer, provider)
    ;[this.configPda] = findConfigPda(this.program.programId)
    ;[this.authorityPda] = findAuthorityPda(this.program.programId)
  }

  /**
   * One-time setup: create config PDA + relayer-authority-owned ATAs.
   *
   * `feeVault` MUST be a pre-existing token account holding the ONyc mint
   * AND MUST NOT alias the relayer-owned ONyc ATA — every fee transfer
   * would otherwise become a no-op self-transfer, commingling user funds
   * with fees in the operating ATA. The relayer enforces both checks.
   */
  initialize(params: {
    authority: PublicKey
    usdcMint: PublicKey
    onycMint: PublicKey
    feeVault: PublicKey
    depositFeeBps: number
    withdrawFeeBps: number
  }) {
    return this.program.methods
      .initialize(params.depositFeeBps, params.withdrawFeeBps)
      .accounts({
        authority: params.authority,
        relayerConfig: this.configPda,
        relayerAuthority: this.authorityPda,
        usdcMint: params.usdcMint,
        onycMint: params.onycMint,
        usdcAta: this.ata(params.usdcMint),
        onycAta: this.ata(params.onycMint),
        feeVault: params.feeVault,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      } as any)
  }

  /**
   * Update admin-mutable config. All fields are optional (see prior
   * docstring). Authority-only.
   */
  async configure(params: {
    authority?: PublicKey
    onycMint?: PublicKey
    feeVault?: PublicKey | null
    depositFeeBps?: number | null
    withdrawFeeBps?: number | null
    newAuthority?: PublicKey | null
  } = {}) {
    const authority = params.authority
      ?? (this.program.provider as any).wallet?.publicKey
      ?? (this.program.provider as any).publicKey
    if (!authority) {
      throw new Error('configure: no authority provided and provider has no wallet')
    }

    const onycMint = params.onycMint ?? ((await this.fetchConfig()).onycMint as PublicKey)

    return this.program.methods
      .configure(
        params.depositFeeBps ?? null,
        params.withdrawFeeBps ?? null,
        params.newAuthority ?? null,
      )
      .accounts({
        authority,
        relayerConfig: this.configPda,
        relayerAuthority: this.authorityPda,
        onycMint,
        onycAta: this.ata(onycMint),
        feeVault: params.feeVault ?? null,
        tokenProgram: TOKEN_PROGRAM_ID,
      } as any)
  }

  async acceptAuthority(params: {
    pendingAuthority?: PublicKey
  } = {}) {
    const pending = params.pendingAuthority
      ?? (this.program.provider as any).wallet?.publicKey
      ?? (this.program.provider as any).publicKey
    if (!pending) {
      throw new Error('acceptAuthority: no pendingAuthority provided and provider has no wallet')
    }
    return this.program.methods
      .acceptAuthority()
      .accounts({
        pendingAuthority: pending,
        relayerConfig: this.configPda,
      } as any)
  }

  /**
   * Claim bridged USDC.s via NTT (`redeem` + `release_inbound_unlock`) and
   * create an inflight Flow PDA bound to the per-VAA `ntt_inbox_item`.
   * Mirrors `unlockOnyc` but on the USDC mint.
   */
  claimUsdc(params: {
    payer: PublicKey
    usdcMint: PublicKey
    nttInboxItem: PublicKey
    nttTransceiverMessage: PublicKey
    /**
     * NTT redeem+release context (custody account from NTT config, plus the
     * USDC.s transceiver address). When omitted (failure-path tests) the
     * caller MUST supply `redeemAccountsLen` and chain `.remainingAccounts`.
     */
    ntt?: NttRedeemContext
    redeemAccountsLen?: number
  }) {
    const [inflightFlow] = findInflightFlowPda(params.nttInboxItem, this.program.programId)
    const [redemptionTracker] = findRedemptionTrackerPda(this.program.programId)
    const built = params.ntt
      ? this.buildNttRedeemReleaseAccounts({
          mint: params.usdcMint,
          nttInboxItem: params.nttInboxItem,
          nttTransceiverMessage: params.nttTransceiverMessage,
          ntt: params.ntt,
        })
      : null

    const builder = this.program.methods
      .claimUsdc(built ? built.redeemAccountsLen : (params.redeemAccountsLen ?? 0))
      .accounts({
        payer: params.payer,
        relayerConfig: this.configPda,
        relayerAuthority: this.authorityPda,
        usdcMint: params.usdcMint,
        usdcAta: this.ata(params.usdcMint),
        nttInboxItem: params.nttInboxItem,
        nttTransceiverMessage: params.nttTransceiverMessage,
        inflightFlow,
        redemptionTracker,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      } as any)

    return built ? builder.remainingAccounts(built.remainingAccounts) : builder
  }

  /**
   * Swap USDC to ONyc via OnRe (deposit leg). The SDK assembles OnRe's
   * 22-entry `remainingAccounts` list when `onre` is supplied.
   */
  swapUsdcToOnyc(params: {
    usdcMint: PublicKey
    onycMint: PublicKey
    nttInboxItem: PublicKey
    onre?: OnreSwapContext
  }) {
    const [inflightFlow] = findInflightFlowPda(params.nttInboxItem, this.program.programId)
    const builder = this.program.methods
      .swapUsdcToOnyc()
      .accounts({
        relayerConfig: this.configPda,
        relayerAuthority: this.authorityPda,
        usdcMint: params.usdcMint,
        onycMint: params.onycMint,
        usdcAta: this.ata(params.usdcMint),
        onycAta: this.ata(params.onycMint),
        nttInboxItem: params.nttInboxItem,
        inflightFlow,
        tokenProgram: TOKEN_PROGRAM_ID,
      } as any)

    if (!params.onre) {
      return builder
    }
    return builder.remainingAccounts(
      buildOnreSwapRemainingAccounts({
        tokenInMint: params.usdcMint,
        tokenOutMint: params.onycMint,
        userTokenInAccount: this.ata(params.usdcMint),
        userTokenOutAccount: this.ata(params.onycMint),
        user: this.authorityPda,
        ctx: params.onre,
      }),
    )
  }

  /**
   * Lock ONyc via NTT, sending bONyc to `flow.fogo_sender`. Closes the
   * inflight Flow PDA. Caller MUST fetch the flow first to obtain
   * `flowAmount`/`flowFogoSender` (needed for `session_authority` derivation),
   * and supply a fresh `outboxItem` keypair (also via `.signers([])`).
   */
  lockOnyc(params: {
    payer: PublicKey
    onycMint: PublicKey
    nttInboxItem: PublicKey
    rentDestination: PublicKey
    flowAmount?: BN | bigint
    flowFogoSender?: Uint8Array
    outboxItem?: PublicKey
    ntt?: NttTransferLockContext
  }) {
    const builder = this.program.methods
      .lockOnyc()
      .accounts({
        payer: params.payer,
        relayerConfig: this.configPda,
        relayerAuthority: this.authorityPda,
        onycMint: params.onycMint,
        onycAta: this.ata(params.onycMint),
        nttInboxItem: params.nttInboxItem,
        inflightFlow: findInflightFlowPda(params.nttInboxItem, this.program.programId)[0],
        rentDestination: params.rentDestination,
        tokenProgram: TOKEN_PROGRAM_ID,
      } as any)

    if (!params.ntt) {
      return builder
    }

    if (!params.flowAmount || !params.flowFogoSender || !params.outboxItem) {
      throw new Error('lockOnyc: when `ntt` is provided, `flowAmount`, `flowFogoSender`, and `outboxItem` are also required')
    }

    return builder.remainingAccounts(
      this.buildNttTransferLockAccounts({
        mint: params.onycMint,
        flowAmount: typeof params.flowAmount === 'bigint'
          ? params.flowAmount
          : BigInt(params.flowAmount.toString()),
        flowFogoSender: params.flowFogoSender,
        outboxItem: params.outboxItem,
        ntt: params.ntt,
      }),
    )
  }

  /**
   * Unlock ONyc from NTT (`redeem` + `release_inbound_unlock`) and create
   * an outflight Flow PDA bound to the per-VAA `ntt_inbox_item`.
   */
  unlockOnyc(params: {
    payer: PublicKey
    onycMint: PublicKey
    nttInboxItem: PublicKey
    nttTransceiverMessage: PublicKey
    ntt?: NttRedeemContext
    redeemAccountsLen?: number
  }) {
    const [outflightFlow] = findOutflightFlowPda(params.nttInboxItem, this.program.programId)
    const built = params.ntt
      ? this.buildNttRedeemReleaseAccounts({
          mint: params.onycMint,
          nttInboxItem: params.nttInboxItem,
          nttTransceiverMessage: params.nttTransceiverMessage,
          ntt: params.ntt,
        })
      : null

    const builder = this.program.methods
      .unlockOnyc(built ? built.redeemAccountsLen : (params.redeemAccountsLen ?? 0))
      .accounts({
        payer: params.payer,
        relayerConfig: this.configPda,
        relayerAuthority: this.authorityPda,
        onycMint: params.onycMint,
        onycAta: this.ata(params.onycMint),
        nttInboxItem: params.nttInboxItem,
        nttTransceiverMessage: params.nttTransceiverMessage,
        outflightFlow,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      } as any)

    return built ? builder.remainingAccounts(built.remainingAccounts) : builder
  }

  /**
   * Send USDC.s back to `flow.fogo_sender` via NTT `transfer_lock`. Closes
   * the outflight Flow PDA. Mirrors `lockOnyc` on the USDC mint.
   */
  sendUsdcToUser(params: {
    payer: PublicKey
    usdcMint: PublicKey
    nttInboxItem: PublicKey
    rentDestination: PublicKey
    flowAmount?: BN | bigint
    flowFogoSender?: Uint8Array
    outboxItem?: PublicKey
    ntt?: NttTransferLockContext
  }) {
    const [outflightFlow] = findOutflightFlowPda(params.nttInboxItem, this.program.programId)
    const [redemptionTracker] = findRedemptionTrackerPda(this.program.programId)
    const builder = this.program.methods
      .sendUsdcToUser()
      .accounts({
        payer: params.payer,
        relayerConfig: this.configPda,
        relayerAuthority: this.authorityPda,
        usdcMint: params.usdcMint,
        usdcAta: this.ata(params.usdcMint),
        nttInboxItem: params.nttInboxItem,
        outflightFlow,
        rentDestination: params.rentDestination,
        redemptionTracker,
        tokenProgram: TOKEN_PROGRAM_ID,
      } as any)

    if (!params.ntt) {
      return builder
    }

    if (!params.flowAmount || !params.flowFogoSender || !params.outboxItem) {
      throw new Error('sendUsdcToUser: when `ntt` is provided, `flowAmount`, `flowFogoSender`, and `outboxItem` are also required')
    }

    return builder.remainingAccounts(
      this.buildNttTransferLockAccounts({
        mint: params.usdcMint,
        flowAmount: typeof params.flowAmount === 'bigint'
          ? params.flowAmount
          : BigInt(params.flowAmount.toString()),
        flowFogoSender: params.flowFogoSender,
        outboxItem: params.outboxItem,
        ntt: params.ntt,
      }),
    )
  }

  /**
   * Build the concatenated `redeem ‖ release ‖ NTT_PROGRAM_ID` account list
   * for `claim_usdc` / `unlock_onyc`. Mint-agnostic — caller supplies the
   * NTT-managed mint (USDC.s on the deposit leg, ONyc on the withdraw leg).
   *
   *   Redeem (10):  payer, config, peer, validatedMsg, registeredTransceiver,
   *                 mint, inboxItem(mut), inboxRateLimit(mut),
   *                 outboxRateLimit(mut), systemProgram
   *   Release (8):  payer, config, inboxItem(mut), recipientAta(mut),
   *                 tokenAuthority, mint(mut), tokenProgram, custody(mut)
   *   + NTT program appended after each slice (for invoke_signed resolution)
   */
  private buildNttRedeemReleaseAccounts(params: {
    mint: PublicKey
    nttInboxItem: PublicKey
    nttTransceiverMessage: PublicKey
    ntt: NttRedeemContext
  }) {
    const fromChain = FOGO_WORMHOLE_CHAIN_ID
    const mintAta = this.ata(params.mint)
    const [configPda] = findNttConfigPda()
    const [peerPda] = findNttPeerPda(fromChain)
    const [registeredTransceiverPda] = findRegisteredTransceiverPda(params.ntt.transceiverAddress)
    const [inboxRateLimitPda] = findInboxRateLimitPda(fromChain)
    const [outboxRateLimitPda] = findOutboxRateLimitPda()
    const [tokenAuthorityPda] = findTokenAuthorityPda()

    const redeem = [
      { pubkey: this.authorityPda, isSigner: false, isWritable: true },
      { pubkey: configPda, isSigner: false, isWritable: false },
      { pubkey: peerPda, isSigner: false, isWritable: false },
      { pubkey: params.nttTransceiverMessage, isSigner: false, isWritable: false },
      { pubkey: registeredTransceiverPda, isSigner: false, isWritable: false },
      { pubkey: params.mint, isSigner: false, isWritable: false },
      { pubkey: params.nttInboxItem, isSigner: false, isWritable: true },
      { pubkey: inboxRateLimitPda, isSigner: false, isWritable: true },
      { pubkey: outboxRateLimitPda, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ]

    const release = [
      { pubkey: this.authorityPda, isSigner: false, isWritable: true },
      { pubkey: configPda, isSigner: false, isWritable: false },
      { pubkey: params.nttInboxItem, isSigner: false, isWritable: true },
      { pubkey: mintAta, isSigner: false, isWritable: true },
      { pubkey: tokenAuthorityPda, isSigner: false, isWritable: false },
      { pubkey: params.mint, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: params.ntt.custody, isSigner: false, isWritable: true },
    ]

    const nttProgramMeta = { pubkey: NTT_PROGRAM_ID, isSigner: false, isWritable: false }
    return {
      remainingAccounts: [
        ...redeem,
        nttProgramMeta,
        ...release,
        nttProgramMeta,
      ],
      redeemAccountsLen: redeem.length + 1,
    }
  }

  /**
   * Build the NTT `transfer_lock` account list for `lock_onyc` /
   * `send_usdc_to_user`. Mint-agnostic.
   */
  private buildNttTransferLockAccounts(params: {
    mint: PublicKey
    flowAmount: bigint
    flowFogoSender: Uint8Array
    outboxItem: PublicKey
    ntt: NttTransferLockContext
  }) {
    const recipientChain = FOGO_WORMHOLE_CHAIN_ID
    const mintAta = this.ata(params.mint)
    const [configPda] = findNttConfigPda()
    const [peerPda] = findNttPeerPda(recipientChain)
    const [outboxRateLimitPda] = findOutboxRateLimitPda()
    const [inboxRateLimitPda] = findInboxRateLimitPda(recipientChain)
    const [tokenAuthorityPda] = findTokenAuthorityPda()

    const argsHash = nttTransferArgsHash({
      amount: params.flowAmount,
      recipientChain,
      recipientAddress: params.flowFogoSender,
      shouldQueue: false,
    })
    const [sessionAuthorityPda] = findSessionAuthorityPda(this.authorityPda, argsHash)

    return [
      { pubkey: this.authorityPda, isSigner: false, isWritable: true },
      { pubkey: configPda, isSigner: false, isWritable: false },
      { pubkey: params.mint, isSigner: false, isWritable: true },
      { pubkey: mintAta, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: params.outboxItem, isSigner: true, isWritable: true },
      { pubkey: outboxRateLimitPda, isSigner: false, isWritable: true },
      { pubkey: params.ntt.custody, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: inboxRateLimitPda, isSigner: false, isWritable: true },
      { pubkey: peerPda, isSigner: false, isWritable: false },
      { pubkey: sessionAuthorityPda, isSigner: false, isWritable: false },
      { pubkey: tokenAuthorityPda, isSigner: false, isWritable: false },
      { pubkey: NTT_PROGRAM_ID, isSigner: false, isWritable: false },
    ]
  }

  requestRedemptionOnyc(params: {
    payer: PublicKey
    usdcMint: PublicKey
    onycMint: PublicKey
    nttInboxItem: PublicKey
    onre?: {
      redemptionRequest: PublicKey
      tokenProgram?: PublicKey
      programId?: PublicKey
      state?: PublicKey
    }
  }) {
    const [outflightFlow] = findOutflightFlowPda(params.nttInboxItem, this.program.programId)
    const [redemptionTracker] = findRedemptionTrackerPda(this.program.programId)
    const builder = this.program.methods
      .requestRedemptionOnyc()
      .accounts({
        payer: params.payer,
        relayerConfig: this.configPda,
        relayerAuthority: this.authorityPda,
        usdcMint: params.usdcMint,
        onycMint: params.onycMint,
        usdcAta: this.ata(params.usdcMint),
        onycAta: this.ata(params.onycMint),
        nttInboxItem: params.nttInboxItem,
        outflightFlow,
        redemptionTracker,
        tokenProgram: TOKEN_PROGRAM_ID,
      } as any)

    if (!params.onre) {
      return builder
    }
    return builder.remainingAccounts(
      buildOnreCreateRedemptionRequestRemainingAccounts({
        tokenInMint: params.onycMint,
        tokenOutMint: params.usdcMint,
        redeemer: this.authorityPda,
        redeemerTokenAccount: this.ata(params.onycMint),
        redemptionRequest: params.onre.redemptionRequest,
        tokenProgram: params.onre.tokenProgram,
        programId: params.onre.programId,
        state: params.onre.state,
      }),
    )
  }

  claimRedemptionUsdc(params: {
    cranker: PublicKey
    usdcMint: PublicKey
    nttInboxItem: PublicKey
    redemptionRequest: PublicKey
    payerForClose: PublicKey
  }) {
    const [outflightFlow] = findOutflightFlowPda(params.nttInboxItem, this.program.programId)
    const [redemptionTracker] = findRedemptionTrackerPda(this.program.programId)
    return this.program.methods
      .claimRedemptionUsdc()
      .accounts({
        cranker: params.cranker,
        relayerConfig: this.configPda,
        relayerAuthority: this.authorityPda,
        usdcMint: params.usdcMint,
        usdcAta: this.ata(params.usdcMint),
        nttInboxItem: params.nttInboxItem,
        outflightFlow,
        redemptionTracker,
        payerForClose: params.payerForClose,
        redemptionRequest: params.redemptionRequest,
        tokenProgram: TOKEN_PROGRAM_ID,
      } as any)
  }

  cancelRedemptionOnyc(params: {
    authority: PublicKey
    onycMint: PublicKey
    nttInboxItem: PublicKey
    payerForClose: PublicKey
    onre?: {
      redemptionRequest: PublicKey
      redemptionAdmin: PublicKey
      usdcMint: PublicKey
      tokenProgram?: PublicKey
      programId?: PublicKey
      state?: PublicKey
    }
  }) {
    const [outflightFlow] = findOutflightFlowPda(params.nttInboxItem, this.program.programId)
    const [redemptionTracker] = findRedemptionTrackerPda(this.program.programId)
    const builder = this.program.methods
      .cancelRedemptionOnyc()
      .accounts({
        authority: params.authority,
        relayerConfig: this.configPda,
        relayerAuthority: this.authorityPda,
        onycMint: params.onycMint,
        onycAta: this.ata(params.onycMint),
        nttInboxItem: params.nttInboxItem,
        outflightFlow,
        redemptionTracker,
        payerForClose: params.payerForClose,
        tokenProgram: TOKEN_PROGRAM_ID,
      } as any)

    if (!params.onre) {
      return builder
    }
    return builder.remainingAccounts(
      buildOnreCancelRedemptionRequestRemainingAccounts({
        tokenInMint: params.onycMint,
        tokenOutMint: params.onre.usdcMint,
        signer: this.authorityPda,
        redeemer: this.authorityPda,
        redeemerTokenAccount: this.ata(params.onycMint),
        redemptionAdmin: params.onre.redemptionAdmin,
        redemptionRequest: params.onre.redemptionRequest,
        tokenProgram: params.onre.tokenProgram,
        programId: params.onre.programId,
        state: params.onre.state,
      }),
    )
  }

  async fetchConfig() {
    return (this.program.account as any).relayerConfig.fetch(this.configPda)
  }

  async fetchInflightFlow(nttInboxItem: PublicKey) {
    const [pda] = findInflightFlowPda(nttInboxItem, this.program.programId)
    return (this.program.account as any).flow.fetch(pda)
  }

  async fetchOutflightFlow(nttInboxItem: PublicKey) {
    const [pda] = findOutflightFlowPda(nttInboxItem, this.program.programId)
    return (this.program.account as any).flow.fetch(pda)
  }

  private ata(mint: PublicKey, owner: PublicKey = this.authorityPda) {
    return getAssociatedTokenAddressSync(mint, owner, true)
  }
}
