import chalk from 'chalk'
import { program as cli } from 'commander'
import { relayerCommands } from './commands/relayer'
import { initContext } from './context'

const READ_ONLY_COMMANDS = new Set(['show'])

cli
  .name('fogo-onre')
  .description('CLI for the Fogo OnRe relayer program')
  .version('0.0.1')
  .option('-u, --url <url>', 'RPC URL or cluster name [env: SOLANA_RPC_URL]', process.env.SOLANA_RPC_URL ?? 'mainnet-beta')
  .option('-k, --keypair <path>', 'Path to keypair file [env: SOLANA_KEYPAIR]')
  .hook('preAction', (command, actionCommand) => {
    const opts = command.opts()
    const isReadOnly = READ_ONLY_COMMANDS.has(actionCommand.name())
    const { connection, keypair } = initContext({
      url: opts.url,
      keypair: isReadOnly ? undefined : opts.keypair,
      readOnly: isReadOnly,
    })

    if (isReadOnly) {
      console.log(chalk.dim(`rpc: ${connection.rpcEndpoint}`))
    }
    else {
      console.log(chalk.dim(JSON.stringify({
        rpc: connection.rpcEndpoint,
        signer: keypair.publicKey.toBase58(),
      }, null, 2)))
    }
    console.log()
  })

cli.addCommand(relayerCommands())

cli.parseAsync()
  .then(() => process.exit(0))
  .catch((e: unknown) => {
    const msg = e instanceof Error ? e.message : String(e)
    console.error(chalk.red(msg))
    process.exit(1)
  })
