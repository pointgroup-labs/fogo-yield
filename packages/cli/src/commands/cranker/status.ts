import { NTT_USDC_PROGRAM_ID, resolveNttVaa } from '@fogo-onre/sdk'
import { PublicKey } from '@solana/web3.js'
import chalk from 'chalk'
import { Command } from 'commander'
import { useContext } from '../../context'
import { DEFAULT_WORMHOLESCAN_URL, fetchVaaBytes, nextDepositStep, nextWithdrawStep, printFlow } from './shared'

export function statusCommand(): Command {
  return new Command('status')
    .description('Read on-chain Flow state for a FOGO bridge tx; print the next crank step')
    .requiredOption('--fogo-tx <signature>', 'FOGO tx signature that emitted the bridge VAA')
    .option('--vaa <hex>', 'Override Wormholescan lookup with raw signed VAA bytes (hex)')
    .option('--ntt-program <pubkey>', `NTT manager program id (default USDC.s: ${NTT_USDC_PROGRAM_ID.toBase58()})`)
    .option('--wormholescan-url <url>', `Wormholescan REST base URL [default: ${DEFAULT_WORMHOLESCAN_URL}]`)
    .action(async (opts: {
      fogoTx: string
      vaa?: string
      nttProgram?: string
      wormholescanUrl?: string
    }) => {
      const { client } = useContext()
      const nttProgram = opts.nttProgram ? new PublicKey(opts.nttProgram) : NTT_USDC_PROGRAM_ID
      const vaaBytes = await fetchVaaBytes({
        fogoTx: opts.fogoTx,
        vaaHex: opts.vaa,
        wormholescanUrl: opts.wormholescanUrl,
      })
      const resolved = resolveNttVaa({ vaaBytes, nttProgramId: nttProgram })

      console.log(chalk.cyan('VAA'))
      console.log(chalk.dim(`  emitterChain:           ${resolved.fromChain}`))
      console.log(chalk.dim(`  sequence:               ${resolved.vaa.sequence}`))
      console.log(chalk.dim(`  sender (source chain):  ${resolved.senderOnSource.toBase58()}`))
      console.log(chalk.dim(`  recipient (Solana):     ${resolved.recipientOnSolana.toBase58()}`))
      console.log(chalk.dim(`  trimmedAmount:          ${resolved.manager.trimmedAmount} (decimals=${resolved.manager.trimmedDecimals})`))
      console.log(chalk.dim(`  nttInboxItem:           ${resolved.nttInboxItem.toBase58()}`))
      console.log(chalk.dim(`  nttTransceiverMessage:  ${resolved.nttTransceiverMessage.toBase58()}`))

      const inflight = await client.fetchInflightFlow(resolved.nttInboxItem).catch(() => null)
      const outflight = await client.fetchOutflightFlow(resolved.nttInboxItem).catch(() => null)

      console.log(chalk.cyan('\nFlow state'))
      if (!inflight && !outflight) {
        console.log(chalk.yellow('  no Flow PDA exists yet'))
        console.log(chalk.green('\nNext step:  cranker claim-usdc --fogo-tx <SIG>  (deposit leg)'))
        console.log(chalk.dim('             cranker unlock-onyc --fogo-tx <SIG> (withdraw leg, once implemented)'))
        return
      }
      if (inflight) {
        printFlow('inflight (deposit chain)', inflight)
        const next = nextDepositStep(inflight.status, opts.fogoTx)
        console.log(chalk.green(`\nNext step:  ${next}`))
      }
      if (outflight) {
        printFlow('outflight (withdraw chain)', outflight)
        const next = nextWithdrawStep(outflight.status, opts.fogoTx)
        console.log(chalk.green(`\nNext step:  ${next}`))
      }
    })
}
