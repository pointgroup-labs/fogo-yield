import type { Provider } from '@anchor-lang/core'
import type { PublicKey } from '@solana/web3.js'
import type { Relayer } from './types/fogo_relayer'
import { BN, Program } from '@anchor-lang/core'
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token'
import {
  SystemProgram,
} from '@solana/web3.js'

import IDL from './idl/fogo_relayer.json'
import { findAuthorityPda, findConfigPda, findInflightFlowPda, findOutflightFlowPda } from './pda'

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class RelayerClient {
  readonly program: Program<Relayer>
  readonly configPda: PublicKey
  readonly authorityPda: PublicKey

  constructor(provider: Provider) {
    this.program = new Program<Relayer>(IDL as Relayer, provider)
    ;[this.configPda] = findConfigPda(this.program.programId)
    ;[this.authorityPda] = findAuthorityPda(this.program.programId)
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private ata(mint: PublicKey, owner: PublicKey = this.authorityPda) {
    return getAssociatedTokenAddressSync(mint, owner, true)
  }

  // -------------------------------------------------------------------------
  // Admin
  // -------------------------------------------------------------------------

  /** One-time setup: create config PDA + ATAs. */
  initialize(params: {
    authority: PublicKey
    usdcMint: PublicKey
    onycMint: PublicKey
    depositFeeBps: number
    withdrawFeeBps: number
  }) {
    return this.program.methods
      .initialize(params.depositFeeBps, params.withdrawFeeBps)
      .accounts({
        authority: params.authority,
        relayer_config: this.configPda,
        relayer_authority: this.authorityPda,
        usdc_mint: params.usdcMint,
        onyc_mint: params.onycMint,
        usdc_ata: this.ata(params.usdcMint),
        onyc_ata: this.ata(params.onycMint),
        token_program: TOKEN_PROGRAM_ID,
        associated_token_program: ASSOCIATED_TOKEN_PROGRAM_ID,
        system_program: SystemProgram.programId,
      })
  }

  /** Update fee basis points. Authority-only. */
  updateFees(params: {
    authority: PublicKey
    depositFeeBps: number
    withdrawFeeBps: number
  }) {
    return this.program.methods
      .update_fees(params.depositFeeBps, params.withdrawFeeBps)
      .accounts({
        authority: params.authority,
        relayer_config: this.configPda,
      })
  }

  /** Withdraw accumulated fees to a destination ATA. Authority-only. */
  withdrawFees(params: {
    authority: PublicKey
    mint: PublicKey
    toAta: PublicKey
    amount: BN
  }) {
    return this.program.methods
      .withdraw_fees(params.amount)
      .accounts({
        authority: params.authority,
        relayer_config: this.configPda,
        relayer_authority: this.authorityPda,
        mint: params.mint,
        from_ata: this.ata(params.mint),
        to_ata: params.toAta,
        token_program: TOKEN_PROGRAM_ID,
      })
  }

  /** Cancel a stuck flow PDA. Authority-only. */
  cancelFlow(params: {
    authority: PublicKey
    flow: PublicKey
    rentDestination: PublicKey
  }) {
    return this.program.methods
      .cancel_flow()
      .accounts({
        authority: params.authority,
        relayer_config: this.configPda,
        flow: params.flow,
        rent_destination: params.rentDestination,
      })
  }

  // -------------------------------------------------------------------------
  // Deposit flow (USDC → ONyc → bONyc back to FOGO)
  // -------------------------------------------------------------------------

  /** Claim bridged USDC and create an inflight flow PDA. */
  claimUsdc(params: {
    payer: PublicKey
    usdcMint: PublicKey
    postedVaa: PublicKey
    gatewayClaim: PublicKey
  }) {
    const [inflightFlow] = findInflightFlowPda(params.gatewayClaim, this.program.programId)
    return this.program.methods
      .claim_usdc()
      .accounts({
        payer: params.payer,
        relayer_config: this.configPda,
        relayer_authority: this.authorityPda,
        usdc_mint: params.usdcMint,
        usdc_ata: this.ata(params.usdcMint),
        posted_vaa: params.postedVaa,
        gateway_claim: params.gatewayClaim,
        inflight_flow: inflightFlow,
        token_program: TOKEN_PROGRAM_ID,
        system_program: SystemProgram.programId,
      })
  }

  /** Swap USDC to ONyc via OnRe. */
  swapUsdcToOnyc(params: {
    usdcMint: PublicKey
    onycMint: PublicKey
    gatewayClaim: PublicKey
  }) {
    const [inflightFlow] = findInflightFlowPda(params.gatewayClaim, this.program.programId)
    return this.program.methods
      .swap_usdc_to_onyc()
      .accounts({
        relayer_config: this.configPda,
        relayer_authority: this.authorityPda,
        usdc_mint: params.usdcMint,
        onyc_mint: params.onycMint,
        usdc_ata: this.ata(params.usdcMint),
        onyc_ata: this.ata(params.onycMint),
        gateway_claim: params.gatewayClaim,
        inflight_flow: inflightFlow,
        token_program: TOKEN_PROGRAM_ID,
      })
  }

  /** Lock ONyc via NTT, sending bONyc to the FOGO user. Consumes the flow PDA. */
  lockOnyc(params: {
    payer: PublicKey
    onycMint: PublicKey
    gatewayClaim: PublicKey
    rentDestination: PublicKey
  }) {
    const [inflightFlow] = findInflightFlowPda(params.gatewayClaim, this.program.programId)
    return this.program.methods
      .lock_onyc()
      .accounts({
        payer: params.payer,
        relayer_config: this.configPda,
        relayer_authority: this.authorityPda,
        onyc_mint: params.onycMint,
        onyc_ata: this.ata(params.onycMint),
        gateway_claim: params.gatewayClaim,
        inflight_flow: inflightFlow,
        rent_destination: params.rentDestination,
        token_program: TOKEN_PROGRAM_ID,
      })
  }

  // -------------------------------------------------------------------------
  // Withdrawal flow (bONyc → ONyc → USDC back to FOGO)
  // -------------------------------------------------------------------------

  /** Unlock ONyc from NTT and create an outflight flow PDA. */
  unlockOnyc(params: {
    payer: PublicKey
    onycMint: PublicKey
    nttInboxItem: PublicKey
    vaa: Buffer
    redeemAccountsLen: number
  }) {
    const [outflightFlow] = findOutflightFlowPda(params.nttInboxItem, this.program.programId)
    return this.program.methods
      .unlock_onyc(params.vaa, params.redeemAccountsLen)
      .accounts({
        payer: params.payer,
        relayer_config: this.configPda,
        relayer_authority: this.authorityPda,
        onyc_mint: params.onycMint,
        onyc_ata: this.ata(params.onycMint),
        ntt_inbox_item: params.nttInboxItem,
        outflight_flow: outflightFlow,
        token_program: TOKEN_PROGRAM_ID,
        system_program: SystemProgram.programId,
      })
  }

  /** Swap ONyc to USDC via OnRe. */
  swapOnycToUsdc(params: {
    usdcMint: PublicKey
    onycMint: PublicKey
    nttInboxItem: PublicKey
  }) {
    const [outflightFlow] = findOutflightFlowPda(params.nttInboxItem, this.program.programId)
    return this.program.methods
      .swap_onyc_to_usdc()
      .accounts({
        relayer_config: this.configPda,
        relayer_authority: this.authorityPda,
        usdc_mint: params.usdcMint,
        onyc_mint: params.onycMint,
        usdc_ata: this.ata(params.usdcMint),
        onyc_ata: this.ata(params.onycMint),
        ntt_inbox_item: params.nttInboxItem,
        outflight_flow: outflightFlow,
        token_program: TOKEN_PROGRAM_ID,
      })
  }

  /** Send USDC back to the FOGO user. Consumes the flow PDA. */
  sendUsdcToUser(params: {
    payer: PublicKey
    usdcMint: PublicKey
    nttInboxItem: PublicKey
    rentDestination: PublicKey
  }) {
    const [outflightFlow] = findOutflightFlowPda(params.nttInboxItem, this.program.programId)
    return this.program.methods
      .send_usdc_to_user()
      .accounts({
        payer: params.payer,
        relayer_config: this.configPda,
        relayer_authority: this.authorityPda,
        usdc_mint: params.usdcMint,
        usdc_ata: this.ata(params.usdcMint),
        ntt_inbox_item: params.nttInboxItem,
        outflight_flow: outflightFlow,
        rent_destination: params.rentDestination,
        token_program: TOKEN_PROGRAM_ID,
      })
  }

  // -------------------------------------------------------------------------
  // Account fetchers
  // -------------------------------------------------------------------------

  /** Fetch the relayer config account. */
  async fetchConfig() {
    return this.program.account.RelayerConfig.fetch(this.configPda)
  }

  /** Fetch an inflight (deposit) flow PDA. */
  async fetchInflightFlow(gatewayClaim: PublicKey) {
    const [pda] = findInflightFlowPda(gatewayClaim, this.program.programId)
    return this.program.account.Flow.fetch(pda)
  }

  /** Fetch an outflight (withdrawal) flow PDA. */
  async fetchOutflightFlow(nttInboxItem: PublicKey) {
    const [pda] = findOutflightFlowPda(nttInboxItem, this.program.programId)
    return this.program.account.Flow.fetch(pda)
  }
}
