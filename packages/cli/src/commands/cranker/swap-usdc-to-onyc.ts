import { buildOnreSwapRemainingAccounts, describeStatus, findAuthorityPda, findInflightFlowPda, findOnreOfferPda, NTT_USDC_PROGRAM_ID, ONRE_PROGRAM_ID, ONYC_MINT, resolveNttVaa, USDC_MINT } from '@fogo-onre/sdk'
import { getAssociatedTokenAddressSync } from '@solana/spl-token'
import { PublicKey } from '@solana/web3.js'
import chalk from 'chalk'
import { Command } from 'commander'
import { runTx, useContext } from '../../context'
import { DEFAULT_WORMHOLESCAN_URL, fetchVaaBytes, TAKE_OFFER_DISCRIMINATOR } from './shared'

export function swapUsdcToOnycCommand(): Command {
  return new Command('swap-usdc-to-onyc')
    .description('Swap claimed USDC into ONyc via OnRe (deposit leg, step 2)')
    .requiredOption('--fogo-tx <signature>', 'FOGO tx signature that emitted the bridge VAA')
    .option('--vaa <hex>', 'Override Wormholescan lookup with raw signed VAA bytes (hex)')
    .option('--usdc-mint <pubkey>', `USDC mint on Solana (default: ${USDC_MINT.toBase58()})`)
    .option('--onyc-mint <pubkey>', `ONyc mint (default from on-chain RelayerConfig, fallback ${ONYC_MINT.toBase58()})`)
    .option('--ntt-program <pubkey>', `NTT USDC.s manager program id (default: ${NTT_USDC_PROGRAM_ID.toBase58()})`)
    .option('--wormholescan-url <url>', `Wormholescan REST base URL [default: ${DEFAULT_WORMHOLESCAN_URL}]`)
    .option('--confirm', 'Actually broadcast the transaction (default: dry-run)')
    .action(async (opts: {
      fogoTx: string
      vaa?: string
      usdcMint?: string
      onycMint?: string
      nttProgram?: string
      wormholescanUrl?: string
      confirm?: boolean
    }) => {
      const { keypair, client } = useContext()
      const usdcMint = opts.usdcMint ? new PublicKey(opts.usdcMint) : USDC_MINT
      const nttProgram = opts.nttProgram ? new PublicKey(opts.nttProgram) : NTT_USDC_PROGRAM_ID
      const vaaBytes = await fetchVaaBytes({
        fogoTx: opts.fogoTx,
        vaaHex: opts.vaa,
        wormholescanUrl: opts.wormholescanUrl,
      })
      const resolved = resolveNttVaa({ vaaBytes, nttProgramId: nttProgram })

      // Pre-flight: Flow must exist with status=Received. Anything else
      // means the prior step hasn't run, or this step already did.
      const flow = await client.fetchInflightFlow(resolved.nttInboxItem).catch(() => null)
      if (!flow) {
        throw new Error(
          `No inflight Flow PDA for inbox-item ${resolved.nttInboxItem.toBase58()} — `
          + `run 'cranker claim-usdc' first.`,
        )
      }
      const flowStatus = describeStatus(flow.status)
      if (flowStatus !== 'Received') {
        throw new Error(
          `Flow status is ${flowStatus}, expected Received. swap-usdc-to-onyc has either already run or the chain is in an unexpected state.`,
        )
      }

      // ONyc mint and feeVault both come from on-chain RelayerConfig
      // unless explicitly overridden — single source of truth so we
      // can't drift from a `relayer configure` rotation.
      const cfg = await client.fetchConfig()
      const onycMint = opts.onycMint
        ? new PublicKey(opts.onycMint)
        : (cfg.assetMint as PublicKey)
      const feeVault = cfg.feeVault as PublicKey

      console.log(chalk.cyan('swap-usdc-to-onyc plan'))
      console.log(chalk.dim(`  payer (signer):         ${keypair.publicKey.toBase58()}`))
      console.log(chalk.dim(`  usdcMint:               ${usdcMint.toBase58()}`))
      console.log(chalk.dim(`  onycMint:               ${onycMint.toBase58()}`))
      console.log(chalk.dim(`  feeVault:               ${feeVault.toBase58()}`))
      console.log(chalk.dim(`  nttInboxItem:           ${resolved.nttInboxItem.toBase58()}`))
      console.log(chalk.dim(`  flow.amount:            ${flow.amount.toString()}`))
      console.log(chalk.dim(`  flow.status:            ${flowStatus}`))

      if (!opts.confirm) {
        console.log()
        console.log(chalk.yellow('dry-run only. Re-run with --confirm to broadcast.'))
        return
      }

      console.log()
      const [relayerAuthorityPda] = findAuthorityPda(client.program.programId)
      const [flowPda] = findInflightFlowPda(resolved.nttInboxItem, client.program.programId)
      const [onreOffer] = findOnreOfferPda(usdcMint, onycMint)
      const amountIn = Buffer.alloc(8)
      amountIn.writeBigUInt64LE(BigInt(flow.amount.toString()))
      const swapIxData = Buffer.concat([TAKE_OFFER_DISCRIMINATOR, amountIn, Buffer.from([0])])
      const swapAccounts = buildOnreSwapRemainingAccounts({
        tokenInMint: usdcMint,
        tokenOutMint: onycMint,
        userTokenInAccount: getAssociatedTokenAddressSync(usdcMint, relayerAuthorityPda, true),
        userTokenOutAccount: getAssociatedTokenAddressSync(onycMint, relayerAuthorityPda, true),
        user: relayerAuthorityPda,
      })
      const sig = await runTx(() =>
        client
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
          .rpc(),
      )

      console.log(chalk.green('swap-usdc-to-onyc landed'))
      console.log(chalk.dim(`  tx: ${sig}`))
    })
}
