import type { TransactionInstruction } from '@solana/web3.js'
import { buildOnreSwapRemainingAccounts, describeStatus, findAuthorityPda, findInboxRateLimitPda, findInflightFlowPda, findNttPeerPda, findOnreOfferPda, findSessionAuthorityPda, findUserInboxAuthorityPda, FOGO_WORMHOLE_CHAIN_ID, NTT_ONYC_PROGRAM_ID, NTT_USDC_PROGRAM_ID, nttTransferArgsHash, ONRE_PROGRAM_ID, ONYC_MINT, resolveNttVaa, USDC_MINT } from '@fogo-onre/sdk'
import { createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync } from '@solana/spl-token'
import { Connection, Keypair, PublicKey, SystemProgram, Transaction } from '@solana/web3.js'
import chalk from 'chalk'
import { Command } from 'commander'
import { runTx, useContext } from '../../context'
import { autoDetectUserWallet, DEFAULT_NTT_VERSION, DEFAULT_WORMHOLESCAN_URL, deriveLockOnycReleaseAccounts, fetchVaaBytes, FOGO_RPC_DEFAULT, makeSolanaNtt, TAKE_OFFER_DISCRIMINATOR, WORMHOLE_CORE_MAINNET } from './shared'

// The "do everything" subcommand. Reads on-chain state to determine
// remaining steps, bundles them into one Solana transaction, and
// exits clean. Idempotent: re-running after partial completion
// detects what's already done and only does the rest.
//
// Stateless by design: the chain (Flow PDA + status, OutboxItem PDA
// existence) is the source of truth, so a second `advance` run picks
// up exactly where the first left off.
//
// Scope: bundles claim_usdc + swap_usdc_to_onyc + lock_onyc. After
// lock_onyc the OutboxItem is queued; the operator still needs a
// `release-outbound` step and a FOGO-side redeem to mint ONyc.
//
// Exit codes: 0 = fully complete, 1 = real failure, 2 = stopped
// because more work remains but can't be done yet.
export function advanceCommand(): Command {
  return new Command('advance')
    .description('Drive a deposit through every available step in one tx (deposit leg, all-in-one)')
    .requiredOption('--fogo-tx <signature>', 'FOGO tx signature that emitted the bridge VAA')
    .option('--vaa <hex>', 'Override Wormholescan lookup with raw signed VAA bytes (hex)')
    .option('--user-wallet <pubkey>', 'Override wallet attribution (default: VAA sender, with auto-detection)')
    .option('--usdc-mint <pubkey>', `USDC mint on Solana (default: ${USDC_MINT.toBase58()})`)
    .option('--onyc-mint <pubkey>', `ONyc mint (default from on-chain RelayerConfig, fallback ${ONYC_MINT.toBase58()})`)
    .option('--ntt-program <pubkey>', `NTT USDC.s manager program id (default: ${NTT_USDC_PROGRAM_ID.toBase58()})`)
    .option('--rent-destination <pubkey>', 'Destination for closed Flow PDA rent (default: signer)')
    .option('--outbox-item <pubkey>', 'OutboxItem from a prior `lock-onyc` run; required to chain release_outbound when relayer side is already done')
    .option('--ntt-version <ver>', `NTT IDL version for the ONyc manager (release_outbound only) [default: ${DEFAULT_NTT_VERSION}]`)
    .option('--wormhole-core <pubkey>', `Wormhole Core program id (release_outbound only) [default: ${WORMHOLE_CORE_MAINNET}]`)
    .option('--wormholescan-url <url>', `Wormholescan REST base URL [default: ${DEFAULT_WORMHOLESCAN_URL}]`)
    .option('--fogo-rpc <url>', `FOGO RPC URL for Sessions wallet recovery [env: FOGO_RPC_URL, default: ${FOGO_RPC_DEFAULT}]`)
    .option('--confirm', 'Actually broadcast the transaction (default: dry-run)')
    .action(async (opts: {
      fogoTx: string
      vaa?: string
      userWallet?: string
      usdcMint?: string
      onycMint?: string
      nttProgram?: string
      rentDestination?: string
      outboxItem?: string
      nttVersion?: string
      wormholeCore?: string
      wormholescanUrl?: string
      fogoRpc?: string
      confirm?: boolean
    }) => {
      const { connection, keypair, client } = useContext()
      const usdcMint = opts.usdcMint ? new PublicKey(opts.usdcMint) : USDC_MINT
      const nttProgram = opts.nttProgram ? new PublicKey(opts.nttProgram) : NTT_USDC_PROGRAM_ID
      const rentDestination = opts.rentDestination
        ? new PublicKey(opts.rentDestination)
        : keypair.publicKey
      const fogoRpcUrl = opts.fogoRpc ?? process.env.FOGO_RPC_URL ?? FOGO_RPC_DEFAULT
      const fogoConnection = new Connection(fogoRpcUrl, 'confirmed')

      const vaaBytes = await fetchVaaBytes({
        fogoTx: opts.fogoTx,
        vaaHex: opts.vaa,
        wormholescanUrl: opts.wormholescanUrl,
      })
      const resolved = resolveNttVaa({ vaaBytes, nttProgramId: nttProgram })

      // 1. State detection. Two signals are needed because lock_onyc
      // CLOSES the Flow PDA (rent refunded), so `flow == null` is
      // ambiguous: it means either "fresh deposit, never claimed" OR
      // "fully done, lock closed it." Disambiguate via NTT's inbox_item
      // PDA, which is created by NTT's redeem (called inside
      // receive) and persists forever after.
      //
      //   inbox_item missing + no Flow  → fresh deposit, do claim+swap, then lock
      //   inbox_item exists  + Flow.Received → swap pending, do swap, then lock
      //   inbox_item exists  + Flow.Swapped → lock pending, do lock alone
      //   inbox_item exists  + no Flow  → relayer side fully done; release_outbound + FOGO redeem pending (TODO)
      const cfg = await client.fetchConfig()
      const onycMint = opts.onycMint
        ? new PublicKey(opts.onycMint)
        : (cfg.assetMint as PublicKey)
      const feeVault = cfg.feeVault as PublicKey
      const [flow, inboxItemInfo] = await Promise.all([
        client.fetchInflightFlow(resolved.nttInboxItem).catch(() => null),
        connection.getAccountInfo(resolved.nttInboxItem).catch(() => null),
      ])
      const flowStatus = flow ? describeStatus(flow.status) : '(none)'
      const claimDone = inboxItemInfo !== null
      const needClaim = !claimDone
      const needSwap = (!flow && !claimDone) || (flow !== null && flowStatus === 'Received')
      const needLock = (flow !== null && (flowStatus === 'Received' || flowStatus === 'Swapped'))
        || (!flow && !claimDone) // brand-new path: lock is needed but in a 2nd tx after claim+swap

      console.log(chalk.cyan('VAA'))
      console.log(chalk.dim(`  emitterChain:           ${resolved.fromChain}`))
      console.log(chalk.dim(`  sequence:               ${resolved.vaa.sequence}`))
      console.log(chalk.dim(`  recipient (Solana):     ${resolved.recipientOnSolana.toBase58()}`))
      console.log(chalk.dim(`  trimmedAmount:          ${resolved.manager.trimmedAmount} (decimals=${resolved.manager.trimmedDecimals})`))
      console.log(chalk.dim(`  nttInboxItem:           ${resolved.nttInboxItem.toBase58()}`))

      console.log(chalk.cyan('\nCurrent state'))
      console.log(chalk.dim(`  NTT inbox_item exists:  ${claimDone}  ${claimDone ? '(claim_usdc has consumed this VAA)' : '(claim_usdc not yet run)'}`))
      console.log(chalk.dim(`  Flow PDA:               ${flow ? 'exists' : '(none)'}`))
      console.log(chalk.dim(`  Flow status:            ${flowStatus}`))

      // 2. Decide which steps remain.
      // After the lock_onyc merge, lock_onyc emits the Wormhole VAA
      // atomically (transfer_lock + release_wormhole_outbound in one ix).
      // So `claimDone && !flow` now means "Solana side fully done, FOGO
      // redeem is the only remaining step" — no `release_outbound`
      // tx to chain. The standalone `cranker release-outbound` command
      // is preserved as a recovery escape hatch for any pre-merge
      // OutboxItems that were queued without a VAA.
      const solanaSideDone = claimDone && !flow
      const txQueue: { label: string, build: () => Promise<{ ixs: TransactionInstruction[], signers: Keypair[] }> }[] = []

      // userWallet auto-detection — only relevant for claim_usdc.
      let userWallet = keypair.publicKey
      let userWalletNote = '(default: signer)'
      if (needClaim) {
        if (opts.userWallet) {
          userWallet = new PublicKey(opts.userWallet)
          userWalletNote = '(from --user-wallet)'
        } else {
          const auto = await autoDetectUserWallet({
            programId: client.program.programId,
            signer: keypair.publicKey,
            resolved,
            fogoConnection,
            fogoTx: opts.fogoTx,
          })
          if (!auto) {
            throw new Error(
              `Cannot auto-detect userWallet — none of the three probes matched the VAA recipient PDA `
              + `(${resolved.recipientOnSolana.toBase58()}). Tried: signer (${keypair.publicKey.toBase58()}), `
              + `VAA sender (${resolved.senderOnSource.toBase58()}), and FOGO source-ATA owner from tx ${opts.fogoTx}. `
              + `Pass --user-wallet explicitly. If this is a Sessions deposit, check that --fogo-rpc reaches a node `
              + `that has the FOGO tx (default: ${FOGO_RPC_DEFAULT}).`,
            )
          }
          userWallet = auto.wallet
          userWalletNote = `(auto: ${auto.source})`
        }
      }

      // TX 1: claim_usdc (if needed). claim+swap can't share one tx — the
      // combined NTT redeem + OnRe take_offer account list overflows the
      // 1232-byte legacy tx limit. Splitting is safe: swap gates on
      // `Flow.status === Received`, so a re-run picks up where it stopped.
      if (needClaim) {
        txQueue.push({
          label: 'claim_usdc',
          build: async () => {
            const ixs: TransactionInstruction[] = []
            const [userInboxAuthority] = findUserInboxAuthorityPda(userWallet, client.program.programId)
            const userInboxAta = getAssociatedTokenAddressSync(usdcMint, userInboxAuthority, true)
            ixs.push(
              createAssociatedTokenAccountIdempotentInstruction(
                keypair.publicKey,
                userInboxAta,
                userInboxAuthority,
                usdcMint,
              ),
            )
            // Top-up: NTT redeem inits `inbox_item` with relayer_authority
            // as payer (~1.41M); a stock PDA holds only its own rent-exempt
            // ~1.14M, so the inner System Transfer underflows. Top up to 3M,
            // idempotent once at-or-above target.
            const [relayerAuthorityPda] = findAuthorityPda(client.program.programId)
            const relayerAuthInfo = await connection.getAccountInfo(relayerAuthorityPda).catch(() => null)
            const RELAYER_AUTH_TOPUP = 3_000_000n
            const existing = BigInt(relayerAuthInfo?.lamports ?? 0)
            if (existing < RELAYER_AUTH_TOPUP) {
              ixs.push(SystemProgram.transfer({
                fromPubkey: keypair.publicKey,
                toPubkey: relayerAuthorityPda,
                lamports: Number(RELAYER_AUTH_TOPUP - existing),
              }))
            }
            const claimIx = await client
              .receive({
                payer: keypair.publicKey,
                direction: { deposit: {} },
                userWallet,
                recvMint: usdcMint,
                nttInboxItem: resolved.nttInboxItem,
                nttTransceiverMessage: resolved.nttTransceiverMessage,
                ntt: { transceiverAddress: nttProgram },
              })
              .instruction()
            ixs.push(claimIx)
            return { ixs, signers: [] }
          },
        })
      }

      // TX 2: swap_usdc_to_onyc (if needed). Builder is deferred
      // (lambda), so when this runs in the same `advance` invocation
      // as a fresh claim, the on-chain Flow PDA is already populated
      // with `status=Received` and `amount=USDC.received` by the time
      // swap's pre-flight runs inside the program. The instruction
      // itself is account-list-heavy but well under 1232 bytes solo.
      if (needSwap) {
        txQueue.push({
          label: 'swap_usdc_to_onyc',
          build: async () => {
            // Re-fetch Flow — a same-run claim populates amount/status.
            const refetched = await client.fetchInflightFlow(resolved.nttInboxItem)
            const [relayerAuthorityPda] = findAuthorityPda(client.program.programId)
            const [flowPda] = findInflightFlowPda(resolved.nttInboxItem, client.program.programId)
            const [onreOffer] = findOnreOfferPda(usdcMint, onycMint)
            const amountIn = Buffer.alloc(8)
            amountIn.writeBigUInt64LE(BigInt(refetched.amount.toString()))
            const swapIxData = Buffer.concat([TAKE_OFFER_DISCRIMINATOR, amountIn, Buffer.from([0])])
            const swapAccounts = buildOnreSwapRemainingAccounts({
              tokenInMint: usdcMint,
              tokenOutMint: onycMint,
              userTokenInAccount: getAssociatedTokenAddressSync(usdcMint, relayerAuthorityPda, true),
              userTokenOutAccount: getAssociatedTokenAddressSync(onycMint, relayerAuthorityPda, true),
              user: relayerAuthorityPda,
            })
            const swapIx = await client
              .swap({
                flowPda,
                baseMint: usdcMint,
                assetMint: onycMint,
                feeVault,
                nttInboxItem: resolved.nttInboxItem,
                onreOffer,
                swapProgram: ONRE_PROGRAM_ID,
                swapDelegate: relayerAuthorityPda,
                swapIxData,
                swapAccounts,
              })
              .instruction()
            return { ixs: [swapIx], signers: [] }
          },
        })
      }

      // TX 2: lock_onyc. Always its own tx so we can read post-swap
      // Flow.amount from chain and compute args_hash correctly.
      if (needLock) {
        txQueue.push({
          label: 'lock_onyc',
          build: async () => {
            // Re-fetch Flow — TX 1 may have just landed.
            const refetched = await client.fetchInflightFlow(resolved.nttInboxItem)
            if (!refetched) {
              throw new Error(
                'Flow PDA missing at lock-build time — TX 1 (claim/swap) may have failed silently. '
                + 'Re-run `cranker advance` to inspect chain state.',
              )
            }
            const refStatus = describeStatus(refetched.status)
            if (refStatus !== 'Swapped') {
              throw new Error(
                `Expected Flow.status=Swapped before lock_onyc, got ${refStatus}. `
                + 'TX 1 (swap) may have been skipped — re-run `cranker advance`.',
              )
            }
            const flowAmount = BigInt(refetched.amount.toString())
            const flowRecipient = refetched.recipient.toBytes()
            const outboxItem = Keypair.generate()

            // FOGO peer pre-flight.
            const [fogoPeerPda] = findNttPeerPda(FOGO_WORMHOLE_CHAIN_ID, NTT_ONYC_PROGRAM_ID)
            const [fogoInboxRateLimitPda] = findInboxRateLimitPda(FOGO_WORMHOLE_CHAIN_ID, NTT_ONYC_PROGRAM_ID)
            const [peerInfo, inboxRateLimitInfo] = await Promise.all([
              connection.getAccountInfo(fogoPeerPda).catch(() => null),
              connection.getAccountInfo(fogoInboxRateLimitPda).catch(() => null),
            ])
            if (!peerInfo || !inboxRateLimitInfo) {
              throw new Error(
                `FOGO chain (id=${FOGO_WORMHOLE_CHAIN_ID}) is not registered on the ONyc NTT manager — `
                + `peer or inbox_rate_limit missing.`,
              )
            }

            // Lamport top-ups for relayer_authority + session_authority.
            const RELAYER_AUTH_TOPUP = 3_000_000n
            const SESSION_AUTH_TOPUP = 2_000_000n
            const argsHash = nttTransferArgsHash({
              amount: flowAmount,
              recipientChain: FOGO_WORMHOLE_CHAIN_ID,
              recipientAddress: flowRecipient,
              shouldQueue: false,
            })
            const [relayerAuthorityPda] = findAuthorityPda(client.program.programId)
            const [sessionAuthorityPda] = findSessionAuthorityPda(
              relayerAuthorityPda,
              argsHash,
              NTT_ONYC_PROGRAM_ID,
            )
            const [relayerAuthInfo, sessionAuthInfo] = await Promise.all([
              connection.getAccountInfo(relayerAuthorityPda).catch(() => null),
              connection.getAccountInfo(sessionAuthorityPda).catch(() => null),
            ])
            const computeTopUp = (existing: number | undefined, target: bigint): bigint => {
              const e = BigInt(existing ?? 0)
              return e >= target ? 0n : target - e
            }
            const relayerTopUp = computeTopUp(relayerAuthInfo?.lamports, RELAYER_AUTH_TOPUP)
            const sessionTopUp = computeTopUp(sessionAuthInfo?.lamports, SESSION_AUTH_TOPUP)

            const ixs: TransactionInstruction[] = []
            if (relayerTopUp > 0n) {
              ixs.push(SystemProgram.transfer({
                fromPubkey: keypair.publicKey,
                toPubkey: relayerAuthorityPda,
                lamports: Number(relayerTopUp),
              }))
            }
            if (sessionTopUp > 0n) {
              ixs.push(SystemProgram.transfer({
                fromPubkey: keypair.publicKey,
                toPubkey: sessionAuthorityPda,
                lamports: Number(sessionTopUp),
              }))
            }

            const lockIx = await client
              .send({
                payer: keypair.publicKey,
                direction: { deposit: {} },
                baseMint: cfg.baseMint as PublicKey,
                assetMint: onycMint,
                nttInboxItem: resolved.nttInboxItem,
                rentDestination,
                flowAmount,
                flowRecipient,
                outboxItem: outboxItem.publicKey,
                release: await deriveLockOnycReleaseAccounts(
                  makeSolanaNtt({
                    connection,
                    manager: NTT_ONYC_PROGRAM_ID,
                    token: onycMint,
                    wormholeCore: opts.wormholeCore ?? WORMHOLE_CORE_MAINNET,
                    version: opts.nttVersion ?? DEFAULT_NTT_VERSION,
                  }),
                  keypair.publicKey,
                  outboxItem.publicKey,
                ),
              })
              .instruction()
            ixs.push(lockIx)

            console.log(chalk.dim(`    outboxItem (new):       ${outboxItem.publicKey.toBase58()}`))
            return { ixs, signers: [outboxItem] }
          },
        })
      }

      // After the lock_onyc merge, the relayer's lock step emits the
      // Wormhole VAA atomically. Nothing to enqueue here on the deposit
      // happy path. `cranker release-outbound` remains for recovery of
      // any pre-merge OutboxItems queued without a VAA — invoke it
      // manually rather than auto-chaining via `advance`.
      if (opts.outboxItem) {
        console.log(chalk.dim('  --outbox-item ignored: lock_onyc now emits the VAA atomically.'))
        console.log(chalk.dim('  For pre-merge recovery use `cranker release-outbound --outbox-item <pubkey>`.'))
      }

      console.log(chalk.cyan('\nPlanned transactions'))
      for (let i = 0; i < txQueue.length; i++) {
        console.log(chalk.dim(`  ${i + 1}. ${txQueue[i].label}`))
      }
      console.log(chalk.dim(`  payer (signer): ${keypair.publicKey.toBase58()} ${userWalletNote}`))

      if (!opts.confirm) {
        console.log()
        console.log(chalk.yellow('dry-run only. Re-run with --confirm to broadcast.'))
        return
      }

      // 3. Execute the queue. Each tx: build → simulate → send.
      for (let i = 0; i < txQueue.length; i++) {
        const { label, build } = txQueue[i]
        console.log(chalk.cyan(`\nTX ${i + 1}: ${label}`))
        const { ixs, signers } = await build()
        if (ixs.length === 0) {
          console.log(chalk.dim('  no-op (already done) — skipping'))
          continue
        }

        const tx = new Transaction().add(...ixs)
        tx.feePayer = keypair.publicKey
        const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed')
        tx.recentBlockhash = blockhash
        tx.sign(keypair, ...signers)

        const sim = await connection.simulateTransaction(tx, undefined, [])
        if (sim.value.err) {
          const logTail = (sim.value.logs ?? []).slice(-25).map(l => `  ${l}`).join('\n')
          throw new Error(
            `TX ${i + 1} (${label}) simulation failed: ${JSON.stringify(sim.value.err)}\n`
            + `Program logs (last 25):\n${logTail}\n`
            + `(No gas spent on this tx.)`,
          )
        }
        const cuConsumed = sim.value.unitsConsumed ?? 0
        console.log(chalk.dim(`  simulate ok — ${cuConsumed.toLocaleString()} CU`))

        const sig = await runTx(async () => {
          const s = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false })
          await connection.confirmTransaction({ signature: s, blockhash, lastValidBlockHeight }, 'confirmed')
          return s
        })
        console.log(chalk.green(`  landed: ${sig}`))
      }

      const releaseDone = solanaSideDone || needLock
      if (releaseDone) {
        console.log(chalk.green('\nadvance complete — Wormhole VAA emitted (lock_onyc atomically published it).'))
        console.log()
        console.log(chalk.yellow('Next step (not yet automated):'))
        console.log(chalk.dim('  FOGO redeem — submit signed VAA to FOGO ONyc NTT manager once guardians sign it.'))
        process.exit(0)
      }
      console.log(chalk.green('\nadvance complete — Solana relayer side done for this VAA'))
      console.log()
      console.log(chalk.yellow('Next steps (not yet automated):'))
      console.log(chalk.dim('  FOGO redeem — submit signed VAA to FOGO ONyc NTT manager.'))
      // Exit 2: relayer-side done, but the cross-chain delivery isn't.
      process.exit(2)
    })
}
