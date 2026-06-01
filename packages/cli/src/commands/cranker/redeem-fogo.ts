import { AnchorProvider, Wallet } from '@anchor-lang/core'
import { resolveNttVaa } from '@fogo-onre/sdk'
import { getAssociatedTokenAddressSync } from '@solana/spl-token'
import { Connection, PublicKey, VersionedTransaction } from '@solana/web3.js'
import { deserialize } from '@wormhole-foundation/sdk-definitions'
import { SolanaNtt } from '@wormhole-foundation/sdk-solana-ntt'
import chalk from 'chalk'
import { Command } from 'commander'
import { runTx, useContext } from '../../context'
import { DEFAULT_NTT_VERSION, FOGO_ONYC_MINT, FOGO_ONYC_NTT_MANAGER_ID, FOGO_RPC_DEFAULT, FOGO_WORMHOLE_CORE_MAINNET } from './shared'

export function redeemFogoCommand(): Command {
  return new Command('redeem-fogo')
    .description(
      'Submit the NTT redeem on FOGO so ONyc is minted to the user '
      + '(deposit leg, step 5 — runs after release-outbound emits the VAA).',
    )
    .requiredOption('--vaa <hex>', 'Signed Wormhole VAA bytes (hex, optional 0x prefix)')
    .option('--fogo-rpc <url>', `FOGO RPC URL [env: FOGO_RPC_URL, default: ${FOGO_RPC_DEFAULT}]`)
    .option('--ntt-manager <pubkey>', `FOGO ONyc NTT manager program id [default: ${FOGO_ONYC_NTT_MANAGER_ID}]`)
    .option('--fogoOnyc-mint <pubkey>', `ONyc mint on FOGO [default: ${FOGO_ONYC_MINT}]`)
    .option('--wormhole-core <pubkey>', `FOGO Wormhole core program id [default: ${FOGO_WORMHOLE_CORE_MAINNET}]`)
    .option('--ntt-version <ver>', `NTT IDL version for the FOGO ONyc manager [default: ${DEFAULT_NTT_VERSION}]`)
    .option('--confirm', 'Actually broadcast the transaction(s) (default: dry-run)')
    .action(async (opts: {
      vaa: string
      fogoRpc?: string
      nttManager?: string
      fogoOnycMint?: string
      wormholeCore?: string
      nttVersion?: string
      confirm?: boolean
    }) => {
      // FOGO is a separate Solana-VM cluster; do NOT reuse the Solana
      // context's Connection/AnchorProvider — only the keypair carries
      // over (same Ed25519 format on both chains).
      const { keypair } = useContext()
      const fogoRpcUrl = opts.fogoRpc ?? process.env.FOGO_RPC_URL ?? FOGO_RPC_DEFAULT
      const fogoConnection = new Connection(fogoRpcUrl, 'confirmed')
      const fogoProvider = new AnchorProvider(
        fogoConnection,
        new Wallet(keypair),
        { commitment: 'confirmed' },
      )
      const nttManagerId = opts.nttManager ?? FOGO_ONYC_NTT_MANAGER_ID
      const fogoOnycMint = opts.fogoOnycMint ?? FOGO_ONYC_MINT
      const wormholeCore = opts.wormholeCore ?? FOGO_WORMHOLE_CORE_MAINNET
      const nttVersion = opts.nttVersion ?? DEFAULT_NTT_VERSION

      // Parse VAA hex → bytes → typed Wormhole NTT attestation. The
      // `Ntt:WormholeTransfer` payload literal is registered as a side
      // effect of importing `@wormhole-foundation/sdk-definitions-ntt`
      // at the top of this file.
      const hex = opts.vaa.startsWith('0x') ? opts.vaa.slice(2) : opts.vaa
      if (!/^[0-9a-f]+$/i.test(hex) || hex.length % 2 !== 0) {
        throw new Error('--vaa must be a hex string (optional 0x prefix)')
      }
      const vaaBytes = Uint8Array.from(Buffer.from(hex, 'hex'))
      const attestation = deserialize('Ntt:WormholeTransfer', vaaBytes)

      // Surface the same diagnostics our other subcommands print so the
      // operator can cross-check VAA → recipient before signing.
      const resolved = resolveNttVaa({
        vaaBytes,
        nttProgramId: new PublicKey(nttManagerId),
      })
      const recipientAta = getAssociatedTokenAddressSync(
        new PublicKey(fogoOnycMint),
        resolved.recipientOnSolana,
      )

      // 'Fogo' is a registered Wormhole chain in @wormhole-foundation/sdk-base
      // 4.18.x and is included in the Solana platform's chain set, so
      // SolanaNtt accepts it natively — no workaround needed.
      const ntt = new SolanaNtt(
        'Mainnet',
        'Fogo',
        fogoConnection,
        {
          coreBridge: wormholeCore,
          ntt: {
            manager: nttManagerId,
            token: fogoOnycMint,
            // Same compiled-in-the-manager pattern as the Solana side.
            transceiver: { wormhole: nttManagerId },
          },
        },
        nttVersion,
      )

      // Idempotency: if the inbox_item PDA already has the `released`
      // bit set, the redeem has already landed and re-running burns gas.
      // `getIsExecuted` reads that bit; `getIsApproved` distinguishes
      // "redeem partially run, release pending" from "fully missing".
      const isExecuted = await ntt.getIsExecuted(attestation).catch(() => false)
      if (isExecuted) {
        console.log(chalk.green('VAA already redeemed on FOGO — nothing to do.'))
        console.log(chalk.dim(`  emitterChain:    ${resolved.fromChain}`))
        console.log(chalk.dim(`  sequence:        ${resolved.vaa.sequence}`))
        console.log(chalk.dim(`  recipient:       ${resolved.recipientOnSolana.toBase58()}`))
        console.log(chalk.dim(`  recipientAta:    ${recipientAta.toBase58()}`))
        return
      }
      const isApproved = await ntt.getIsApproved(attestation).catch(() => false)

      console.log(chalk.cyan('redeem-fogo plan'))
      console.log(chalk.dim(`  fogoRpc:                ${fogoRpcUrl}`))
      console.log(chalk.dim(`  payer (signer):         ${keypair.publicKey.toBase58()}`))
      console.log(chalk.dim(`  nttManager (FOGO):      ${nttManagerId}`))
      console.log(chalk.dim(`  fogoOnycMint:              ${fogoOnycMint}`))
      console.log(chalk.dim(`  wormholeCore (FOGO):    ${wormholeCore}`))
      console.log(chalk.dim(`  nttVersion:             ${nttVersion}`))
      console.log(chalk.dim(`  emitterChain:           ${resolved.fromChain}`))
      console.log(chalk.dim(`  sequence:               ${resolved.vaa.sequence}`))
      console.log(chalk.dim(`  trimmedAmount:          ${resolved.manager.trimmedAmount} (decimals=${resolved.manager.trimmedDecimals})`))
      console.log(chalk.dim(`  recipient (FOGO):       ${resolved.recipientOnSolana.toBase58()}`))
      console.log(chalk.dim(`  recipientAta:           ${recipientAta.toBase58()}`))
      console.log(chalk.dim(`  inbox approved:         ${isApproved} ${isApproved ? '(redeem partially run; will resume)' : '(fresh)'}`))

      if (!opts.confirm) {
        console.log()
        console.log(chalk.yellow('dry-run only. Re-run with --confirm to broadcast.'))
        return
      }

      // SolanaNtt.redeem yields multiple unsigned txs in sequence:
      //   1. (verifyVaaShim path) post guardian signatures
      //   2. createAta(recipient) if missing
      //   3. receive_message + redeem + release_inbound_(unlock|mint)
      //      compiled into one v0 transaction with the manager's LUT.
      // The exact count depends on whether the manager uses the verify
      // VAA shim (3.x+) and whether the recipient ATA pre-exists.
      console.log()
      const signatures: string[] = []
      let txIndex = 0
      // SolanaNtt.redeem internally wraps `payer` with `new SolanaAddress(...)`,
      // which accepts a raw PublicKey. The TS signature wants an
      // `AccountAddress<'Fogo'>` so we cast — pulling in
      // `@wormhole-foundation/sdk-solana` just for the constructor would
      // duplicate a transitive dep.
      for await (const unsigned of ntt.redeem(
        [attestation],
        keypair.publicKey as unknown as Parameters<typeof ntt.redeem>[1],
      )) {
        txIndex += 1
        const tx = unsigned.transaction.transaction
        const signers = unsigned.transaction.signers ?? []
        const description = unsigned.description
        console.log(chalk.cyan(`TX ${txIndex}: ${description}`))

        const sig = await runTx(async () => {
          const { blockhash, lastValidBlockHeight } = await fogoConnection.getLatestBlockhash('confirmed')
          let raw: Uint8Array
          if (tx instanceof VersionedTransaction) {
            tx.message.recentBlockhash = blockhash
            tx.sign([keypair, ...signers])
            raw = tx.serialize()
          } else {
            tx.recentBlockhash = blockhash
            tx.feePayer = keypair.publicKey
            tx.sign(keypair, ...signers)
            raw = tx.serialize()
          }
          const s = await fogoConnection.sendRawTransaction(raw, { skipPreflight: false })
          await fogoConnection.confirmTransaction(
            { signature: s, blockhash, lastValidBlockHeight },
            'confirmed',
          )
          return s
        })
        console.log(chalk.dim(`  landed: ${sig}`))
        signatures.push(sig)
      }

      // Post-mint balance read. If the recipient ATA didn't exist
      // pre-redeem, the unlock/mint ix created it; either way it should
      // hold trimmedAmount * 10^(mintDecimals - trimmedDecimals) ONyc
      // by the time the last tx confirms. A failure here is informational
      // only — the redeem already landed.
      let mintedAmount: string | null = null
      try {
        const bal = await fogoConnection.getTokenAccountBalance(recipientAta, 'confirmed')
        mintedAmount = bal.value.amount
      } catch {
        // ATA read can race the unlock-mint commit on slow RPCs.
      }
      // Suppress unused-binding lint while keeping `provider` available
      // for future ix-builder helpers that take an AnchorProvider.
      void fogoProvider

      console.log()
      console.log(chalk.green('redeem-fogo landed — ONyc minted on FOGO'))
      console.log(chalk.dim(`  recipientAta:   ${recipientAta.toBase58()}`))
      if (mintedAmount !== null) {
        console.log(chalk.dim(`  ataBalance:     ${mintedAmount}`))
      }
      console.log(chalk.dim(`  txCount:        ${signatures.length}`))
      for (const [i, s] of signatures.entries()) {
        console.log(chalk.dim(`  tx[${i}]:        ${s}`))
      }
    })
}
