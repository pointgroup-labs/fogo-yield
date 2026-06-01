import { NTT_ONYC_PROGRAM_ID, ONYC_MINT } from '@fogo-onre/sdk'
import { PublicKey, Transaction } from '@solana/web3.js'
import chalk from 'chalk'
import { Command } from 'commander'
import { runTx, useContext } from '../../context'
import { DEFAULT_NTT_VERSION, makeSolanaNtt, WORMHOLE_CORE_MAINNET } from './shared'

export function releaseOutboundCommand(): Command {
  return new Command('release-outbound')
    .description(
      'Release a queued NTT OutboxItem so the Wormhole VAA is emitted '
      + '(deposit leg, step 4 — runs after lock_onyc).',
    )
    .requiredOption('--outbox-item <pubkey>', 'OutboxItem account written by lock_onyc (printed by `cranker lock-onyc`)')
    .option('--onyc-mint <pubkey>', `ONyc mint (default from on-chain RelayerConfig, fallback ${ONYC_MINT.toBase58()})`)
    .option('--ntt-program <pubkey>', `ONyc NTT manager program id (default: ${NTT_ONYC_PROGRAM_ID.toBase58()})`)
    .option('--ntt-version <ver>', `NTT IDL version for the on-chain manager [default: ${DEFAULT_NTT_VERSION}]`)
    .option('--wormhole-core <pubkey>', `Wormhole Core program id [default: ${WORMHOLE_CORE_MAINNET}]`)
    .option('--revert-on-delay', 'Pass revertOnDelay=true to NTT (default: false)')
    .option('--confirm', 'Actually broadcast the transaction (default: dry-run)')
    .action(async (opts: {
      outboxItem: string
      onycMint?: string
      nttProgram?: string
      nttVersion?: string
      wormholeCore?: string
      revertOnDelay?: boolean
      confirm?: boolean
    }) => {
      const { connection, keypair, client } = useContext()
      const outboxItem = new PublicKey(opts.outboxItem)
      const nttProgramId = opts.nttProgram ? new PublicKey(opts.nttProgram) : NTT_ONYC_PROGRAM_ID
      const wormholeCore = opts.wormholeCore ?? WORMHOLE_CORE_MAINNET
      const nttVersion = opts.nttVersion ?? DEFAULT_NTT_VERSION
      const cfg = await client.fetchConfig()
      const onycMint = opts.onycMint ? new PublicKey(opts.onycMint) : (cfg.assetMint as PublicKey)

      const ntt = makeSolanaNtt({
        connection,
        manager: nttProgramId,
        token: onycMint,
        wormholeCore,
        version: nttVersion,
      })

      // Idempotency: read the OutboxItem and check the wormhole transceiver
      // bit (bit 0) on the released bitmap. If already set, exit clean —
      // re-running is wasted gas.
      const outboxAccount = await ntt.program.account.outboxItem.fetchNullable(outboxItem)
      if (!outboxAccount) {
        throw new Error(
          `OutboxItem ${outboxItem.toBase58()} not found on chain. `
          + 'Either lock_onyc never ran, the OutboxItem pubkey is wrong, or the NTT program id is wrong '
          + `(checked under ${nttProgramId.toBase58()}).`,
        )
      }
      // `released.map` is a u128 (Bitmap.map field per IDL). The wormhole
      // xcvr is at bit 0 because SolanaNtt registers it first.
      const releasedMap = (outboxAccount as { released?: { map: { toString: () => string } } }).released?.map
      const releasedMask = releasedMap ? BigInt(releasedMap.toString()) : 0n
      const wormholeBit = 1n
      if ((releasedMask & wormholeBit) === wormholeBit) {
        console.log(chalk.green('OutboxItem already released for the wormhole transceiver — nothing to do.'))
        console.log(chalk.dim(`  outboxItem:     ${outboxItem.toBase58()}`))
        console.log(chalk.dim(`  released.map:   0x${releasedMask.toString(16)}`))
        return
      }

      const xcvr = await ntt.getWormholeTransceiver()
      if (!xcvr) {
        throw new Error('Failed to construct SolanaNttWormholeTransceiver — manager/transceiver wiring mismatch.')
      }
      const releaseIx = await xcvr.createReleaseWormholeOutboundIx(
        keypair.publicKey,
        outboxItem,
        opts.revertOnDelay ?? false,
      )

      // Useful diagnostics: emitter is the Wormhole sender of this VAA;
      // the redeemer on FOGO will need it (alongside sequence) to look
      // up the signed VAA. The OutboxItem already carries
      // recipient_chain / recipient_address that we surface for sanity.
      const emitter = (await xcvr.getAddress()).address.toString()
      const recipientChain = (outboxAccount as { recipientChain?: { id?: number } | number }).recipientChain
      const recipientChainId = typeof recipientChain === 'object' && recipientChain !== null && 'id' in recipientChain
        ? recipientChain.id
        : (recipientChain as number | undefined)
      const recipientAddrBytes = (outboxAccount as { recipientAddress?: number[] | Uint8Array }).recipientAddress
      const recipientAddrPk = recipientAddrBytes
        ? new PublicKey(Uint8Array.from(recipientAddrBytes as ArrayLike<number>)).toBase58()
        : '(unknown)'

      console.log(chalk.cyan('release-outbound plan'))
      console.log(chalk.dim(`  payer (signer):         ${keypair.publicKey.toBase58()}`))
      console.log(chalk.dim(`  nttProgram:             ${nttProgramId.toBase58()}`))
      console.log(chalk.dim(`  nttVersion:             ${nttVersion}`))
      console.log(chalk.dim(`  wormholeCore:           ${wormholeCore}`))
      console.log(chalk.dim(`  outboxItem:             ${outboxItem.toBase58()}`))
      console.log(chalk.dim(`  emitter (wormhole):     ${emitter}`))
      console.log(chalk.dim(`  recipientChain:         ${recipientChainId ?? '(unknown)'}`))
      console.log(chalk.dim(`  recipientAddress:       ${recipientAddrPk}`))
      console.log(chalk.dim(`  released.map (before):  0x${releasedMask.toString(16)}`))

      if (!opts.confirm) {
        console.log()
        console.log(chalk.yellow('dry-run only. Re-run with --confirm to broadcast.'))
        return
      }

      const tx = new Transaction().add(releaseIx)
      tx.feePayer = keypair.publicKey
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed')
      tx.recentBlockhash = blockhash
      tx.sign(keypair)

      const sig = await runTx(async () => {
        const s = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false })
        await connection.confirmTransaction({ signature: s, blockhash, lastValidBlockHeight }, 'confirmed')
        return s
      })

      console.log(chalk.green('release-outbound landed — Wormhole VAA emitted'))
      console.log(chalk.dim(`  tx:        ${sig}`))
      console.log(chalk.dim(`  emitter:   ${emitter}`))
      console.log(chalk.yellow('Next: fetch the signed VAA from Wormholescan/guardian RPC and submit FOGO redeem.'))
    })
}
