/**
 * One-shot recovery: publish a stranded NTT OutboxItem on FOGO via
 * `release_wormhole_outbound`, producing the missing VAA so the
 * cross-chain withdraw flow can finish.
 *
 * Why this exists: prior versions of the webapp's withdraw path sent
 * only the `transfer_burn` ix and skipped `release_wormhole_outbound`.
 * The user's tokens were burned, an OutboxItem PDA was created, but
 * no Wormhole message was ever published — so guardians never observed
 * anything to attest. Newer webapp builds bundle the publish ix into
 * the same tx, but already-stranded outbox items need this manual run.
 *
 * The release ix is permissionless on-chain — anyone can crank it.
 * What it costs: a small FOGO SOL fee (tx fee + WH-Core message fee).
 * Pass any funded FOGO keypair as `--keypair`.
 *
 * Run:
 *   cd packages/cli && node ../../scripts/release-fogo-outbound.mjs \
 *     --outbox-item <pubkey> \
 *     --keypair    /path/to/fogo-payer-keypair.json \
 *     [--fogo-rpc  https://mainnet.fogo.io]
 *     [--dry-run]   # build + simulate only, do not send
 *
 * Mirrors `packages/webapp/src/lib/bridge/releaseFogoOutbound.ts` —
 * keep the two in lockstep on any NTT IDL bump.
 */
import { readFileSync } from 'node:fs'
import { sha256 } from '@noble/hashes/sha2.js'
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_CLOCK_PUBKEY,
  SYSVAR_RENT_PUBKEY,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js'

const FOGO_RPC_DEFAULT = 'https://mainnet.fogo.io'
const NTT_ONYC_PROGRAM_ID = new PublicKey('nttpna5vXW7BN2Aa4AfTbkCncJWTEoBsnWvjS87Xgsd')
const FOGO_WORMHOLE_CORE = new PublicKey('worm2mrQkG1B1KTz37erMfWN8anHkSK24nzca7UD8BB')

function ixDiscriminator(name) {
  return Buffer.from(sha256(new TextEncoder().encode(`global:${name}`))).subarray(0, 8)
}

function pda(seeds, programId) {
  return PublicKey.findProgramAddressSync(seeds.map(s => typeof s === 'string' ? Buffer.from(s) : s), programId)[0]
}

function readonly(pubkey) { return { pubkey, isSigner: false, isWritable: false } }
function writable(pubkey) { return { pubkey, isSigner: false, isWritable: true } }
function signerWritable(pubkey) { return { pubkey, isSigner: true, isWritable: true } }

function parseArgs(argv) {
  const out = { dryRun: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--outbox-item') {
      out.outboxItem = argv[++i]
    } else if (a === '--keypair') {
      out.keypair = argv[++i]
    } else if (a === '--fogo-rpc') {
      out.fogoRpc = argv[++i]
    } else if (a === '--dry-run') {
      out.dryRun = true
    } else if (a === '-h' || a === '--help') { out.help = true }
  }
  return out
}

function usage() {
  console.log(`Usage:
  node scripts/release-fogo-outbound.mjs --outbox-item <pubkey> --keypair <path> [--fogo-rpc <url>] [--dry-run]

Options:
  --outbox-item <pubkey>   Stranded OutboxItem PDA (extract from the burn tx on Fogoscan).
  --keypair <path>         Path to a JSON-encoded FOGO-funded keypair.
  --fogo-rpc <url>         RPC URL (default: ${FOGO_RPC_DEFAULT}).
  --dry-run                Simulate only — do not broadcast.`)
}

function loadKeypair(path) {
  const arr = JSON.parse(readFileSync(path, 'utf8'))
  return Keypair.fromSecretKey(Uint8Array.from(arr))
}

function buildReleaseIx({ payer, outboxItem }) {
  const manager = NTT_ONYC_PROGRAM_ID
  const transceiver = manager // combined NTT build
  const core = FOGO_WORMHOLE_CORE

  const configPda = pda(['config'], manager)
  const registeredTransceiverPda = pda(['registered_transceiver', transceiver.toBuffer()], manager)
  const wormholeMessage = pda(['message', outboxItem.toBuffer()], transceiver)
  const emitter = pda(['emitter'], transceiver)
  const wormholeBridge = pda(['Bridge'], core)
  const wormholeFeeCollector = pda(['fee_collector'], core)
  const wormholeSequence = pda(['Sequence', emitter.toBuffer()], core)
  const outboxItemSigner = pda(['outbox_item_signer'], transceiver)

  // Account ordering = upstream NTT v3 IDL `releaseWormholeOutbound`.
  // Mirrors `buildNttReleaseWormholeOutboundAccountList` in the SDK.
  const keys = [
    signerWritable(payer), //  0
    readonly(configPda), //  1
    writable(outboxItem), //  2
    readonly(registeredTransceiverPda), //  3
    writable(wormholeMessage), //  4
    readonly(emitter), //  5
    writable(wormholeBridge), //  6
    writable(wormholeFeeCollector), //  7
    writable(wormholeSequence), //  8
    readonly(core), //  9  wormhole.program
    readonly(SystemProgram.programId), // 10
    readonly(SYSVAR_CLOCK_PUBKEY), // 11
    readonly(SYSVAR_RENT_PUBKEY), // 12
    readonly(manager), // 13  manager (v3)
    readonly(outboxItemSigner), // 14  outbox_item_signer (v3)
  ]

  const disc = ixDiscriminator('release_wormhole_outbound')
  const data = Buffer.alloc(disc.length + 1)
  data.set(disc, 0)
  data.writeUInt8(0, disc.length) // revertOnDelay = false

  return new TransactionInstruction({ programId: transceiver, keys, data })
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help || !args.outboxItem || !args.keypair) {
    usage()
    process.exit(args.help ? 0 : 1)
  }

  const rpc = args.fogoRpc ?? FOGO_RPC_DEFAULT
  const conn = new Connection(rpc, 'confirmed')
  const payerKp = loadKeypair(args.keypair)
  const outboxItem = new PublicKey(args.outboxItem)

  console.log(`RPC:           ${rpc}`)
  console.log(`payer:         ${payerKp.publicKey.toBase58()}`)
  console.log(`outboxItem:    ${outboxItem.toBase58()}`)
  console.log()

  // Sanity: outbox account exists and is owned by the manager.
  const acc = await conn.getAccountInfo(outboxItem, 'confirmed')
  if (acc === null) {
    console.error('❌ OutboxItem account not found on FOGO — wrong network or wrong pubkey.')
    process.exit(1)
  }
  if (!acc.owner.equals(NTT_ONYC_PROGRAM_ID)) {
    console.error(`❌ OutboxItem owner ${acc.owner.toBase58()} != ONyc manager. Refusing to release.`)
    process.exit(1)
  }
  console.log(`OutboxItem owner: ✅ ${acc.owner.toBase58()} (${acc.data.length} bytes)`)

  // Has it already been published? After release, the WH message PDA
  // exists; before, it doesn't.
  const wormholeMessagePda = pda(['message', outboxItem.toBuffer()], NTT_ONYC_PROGRAM_ID)
  const msgAcc = await conn.getAccountInfo(wormholeMessagePda, 'confirmed')
  if (msgAcc !== null) {
    console.log(`⚠️  WormholeMessage PDA ${wormholeMessagePda.toBase58()} already exists — already released.`)
    console.log('    Nothing to do; check Wormholescan for the VAA by emitter+sequence.')
    process.exit(0)
  }

  const releaseIx = buildReleaseIx({ payer: payerKp.publicKey, outboxItem })

  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed')
  const message = new TransactionMessage({
    payerKey: payerKp.publicKey,
    recentBlockhash: blockhash,
    instructions: [releaseIx],
  }).compileToV0Message()
  const tx = new VersionedTransaction(message)
  tx.sign([payerKp])

  if (args.dryRun) {
    console.log('[dry-run] simulating…')
    const sim = await conn.simulateTransaction(tx, { commitment: 'confirmed' })
    console.log(`  err: ${JSON.stringify(sim.value.err)}`)
    console.log(`  logs (last 30):`)
    for (const l of (sim.value.logs ?? []).slice(-30)) { console.log(`    ${l}`) }
    return
  }

  const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false })
  console.log(`sent: ${sig}`)
  const conf = await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed')
  if (conf.value.err !== null) {
    console.error(`❌ tx failed: ${JSON.stringify(conf.value.err)}`)
    process.exit(1)
  }
  console.log('✅ release_wormhole_outbound landed. VAA should appear at Wormholescan within a few seconds.')
  console.log(`   https://fogoscan.com/tx/${sig}`)
}

main().catch((err) => { console.error('release failed:', err); process.exit(1) })
