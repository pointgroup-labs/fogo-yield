/* eslint-disable style/max-statements-per-line -- one-line decoder closures (`const v = data.readUInt8(off); off += 1; return v`) keep binary parsing compact */
/**
 * Diagnostic: inspect the ONyc NTT manager state on FOGO and resolve
 * the cross-chain status of a specific FOGO burn tx.
 *
 * Self-contained — inlines PDA seeds and minimal Anchor/Borsh decoders
 * so it can run via plain `node` without the SDK build pipeline.
 * Mirrors `packages/sdk/src/builders/{ntt-state,ntt}.ts`.
 *
 * Run:
 *   cd packages/cli && node ../../scripts/inspect-onyc-ntt-fogo.mjs [<fogoTxSig>]
 */
import { Connection, PublicKey } from '@solana/web3.js'

const FOGO_RPC = process.env.FOGO_RPC_URL ?? 'https://mainnet.fogo.io'
const NTT_ONYC_PROGRAM_ID = new PublicKey('nttpna5vXW7BN2Aa4AfTbkCncJWTEoBsnWvjS87Xgsd')
// In this build the WH transceiver IS the manager program (combined build).
const WH_TRANSCEIVER_PROGRAM_ID = NTT_ONYC_PROGRAM_ID
const SOLANA_WORMHOLE_CHAIN_ID = 1
const FOGO_WORMHOLE_CHAIN_ID = 51

const CONFIG_SEED = Buffer.from('config')
const PEER_SEED = Buffer.from('peer')
const OUTBOX_RATE_LIMIT_SEED = Buffer.from('outbox_rate_limit')
const REGISTERED_TRANSCEIVER_SEED = Buffer.from('registered_transceiver')
const EMITTER_SEED = Buffer.from('emitter')

function chainIdBeBuf(chainId) {
  const b = Buffer.alloc(2)
  b.writeUInt16BE(chainId, 0)
  return b
}

const findConfigPda = () => PublicKey.findProgramAddressSync([CONFIG_SEED], NTT_ONYC_PROGRAM_ID)
const findPeerPda = c => PublicKey.findProgramAddressSync([PEER_SEED, chainIdBeBuf(c)], NTT_ONYC_PROGRAM_ID)
const findOutboxRateLimitPda = () => PublicKey.findProgramAddressSync([OUTBOX_RATE_LIMIT_SEED], NTT_ONYC_PROGRAM_ID)
function findRegisteredTransceiverPda(xcvr) {
  return PublicKey.findProgramAddressSync([REGISTERED_TRANSCEIVER_SEED, xcvr.toBuffer()], NTT_ONYC_PROGRAM_ID)
}
const findEmitterPda = () => PublicKey.findProgramAddressSync([EMITTER_SEED], WH_TRANSCEIVER_PROGRAM_ID)

function decodeConfig(data) {
  let off = 8
  const u8 = () => { const v = data.readUInt8(off); off += 1; return v }
  const u16 = () => { const v = data.readUInt16LE(off); off += 2; return v }
  const u128 = () => {
    const lo = data.readBigUInt64LE(off); const hi = data.readBigUInt64LE(off + 8); off += 16
    return (hi << 64n) | lo
  }
  const bool = () => u8() !== 0
  const pubkey = () => { const k = new PublicKey(data.subarray(off, off + 32)); off += 32; return k }

  const bump = u8()
  const owner = pubkey()
  const pendingOwner = bool() ? pubkey() : null
  const mint = pubkey()
  const tokenProgram = pubkey()
  const modeByte = u8()
  const mode = modeByte === 0 ? 'Locking' : modeByte === 1 ? 'Burning' : `Unknown(${modeByte})`
  const chainId = u16()
  const nextTransceiverId = u8()
  const threshold = u8()
  const enabledTransceivers = u128()
  const paused = bool()
  const custody = pubkey()
  return { bump, owner, pendingOwner, mint, tokenProgram, mode, chainId, nextTransceiverId, threshold, enabledTransceivers, paused, custody }
}

/**
 * RegisteredTransceiver layout (per ntt-quoter / NTT IDL):
 *   discriminator: 8 bytes
 *   bump: u8
 *   id: u8
 *   transceiver_address: Pubkey  (the transceiver program id, same one the seed used)
 */
function decodeRegisteredTransceiver(data) {
  let off = 8
  const u8 = () => { const v = data.readUInt8(off); off += 1; return v }
  const pubkey = () => { const k = new PublicKey(data.subarray(off, off + 32)); off += 32; return k }
  return { bump: u8(), id: u8(), transceiverAddress: pubkey() }
}

/**
 * Pull the FOGO tx, scan logs for Wormhole-Core post_message output.
 * Wormhole core logs `Sequence: <N>` after a successful message
 * publication; that line is the most reliable extraction point.
 */
async function extractWormholeSequence(conn, sig) {
  const tx = await conn.getTransaction(sig, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 })
  if (tx === null) {
    return { tx: null, sequence: null, logs: [] }
  }
  const logs = tx.meta?.logMessages ?? []
  let sequence = null
  for (const line of logs) {
    const m = line.match(/Sequence:\s*(\d+)/)
    if (m !== null) {
      sequence = BigInt(m[1])
      break
    }
  }
  return { tx, sequence, logs }
}

async function queryWormholescan(chain, emitterHex, sequence) {
  const url = `https://api.wormholescan.io/api/v1/vaas/${chain}/${emitterHex}/${sequence.toString()}`
  const res = await fetch(url, { headers: { accept: 'application/json' } })
  return { url, status: res.status, body: res.status === 200 ? await res.json() : await res.text() }
}

async function main() {
  const conn = new Connection(FOGO_RPC, 'confirmed')
  const fogoSig = process.argv[2] ?? null

  console.log(`RPC:                  ${FOGO_RPC}`)
  console.log(`ONyc NTT manager:     ${NTT_ONYC_PROGRAM_ID.toBase58()}`)
  console.log()

  // Manager-state PDAs.
  const [configPda] = findConfigPda()
  const [peerPda] = findPeerPda(SOLANA_WORMHOLE_CHAIN_ID)
  const [outboxPda] = findOutboxRateLimitPda()
  const [regXcvrPda] = findRegisteredTransceiverPda(WH_TRANSCEIVER_PROGRAM_ID)
  const [emitterPda] = findEmitterPda()

  const [configAcc, peerAcc, outboxAcc, regXcvrAcc] = await conn.getMultipleAccountsInfo(
    [configPda, peerPda, outboxPda, regXcvrPda], 'confirmed',
  )

  console.log(`Config PDA:           ${configPda.toBase58()}`)
  let cfg = null
  if (configAcc === null) {
    console.log('  STATUS: ❌ MISSING')
  } else {
    cfg = decodeConfig(configAcc.data)
    console.log(`  paused:             ${cfg.paused ? '❌ TRUE' : '✅ false'}`)
    console.log(`  mode:               ${cfg.mode}   chainId: ${cfg.chainId}   threshold: ${cfg.threshold}`)
    console.log(`  enabledTransceivers:0x${cfg.enabledTransceivers.toString(16)}`)
  }
  console.log()

  console.log(`Peer(chain=1) PDA:    ${peerPda.toBase58()}   ${peerAcc === null ? '❌ MISSING' : `✅ ${peerAcc.data.length} bytes`}`)
  console.log(`OutboxRateLimit PDA:  ${outboxPda.toBase58()}   ${outboxAcc === null ? '❌ MISSING' : `✅ ${outboxAcc.data.length} bytes`}`)
  console.log()

  console.log(`RegisteredTransceiver PDA: ${regXcvrPda.toBase58()}`)
  if (regXcvrAcc === null) {
    console.log('  STATUS: ❌ MISSING — manager has no transceiver registered for itself')
  } else {
    const reg = decodeRegisteredTransceiver(regXcvrAcc.data)
    console.log(`  id:                 ${reg.id}`)
    console.log(`  transceiverAddress: ${reg.transceiverAddress.toBase58()}`)
    const wired = reg.transceiverAddress.equals(WH_TRANSCEIVER_PROGRAM_ID)
    console.log(`  matches WH xcvr:    ${wired ? '✅ yes' : '❌ no — address points elsewhere'}`)
  }
  console.log()

  console.log(`WH emitter PDA:       ${emitterPda.toBase58()}`)
  console.log(`  emitter (hex):      ${Buffer.from(emitterPda.toBytes()).toString('hex')}`)
  console.log()

  // VAA resolution for a specific tx.
  if (fogoSig === null) {
    console.log('(no FOGO tx signature provided — skipping VAA resolution; pass one as argv[2])')
    return
  }

  console.log(`FOGO tx:              ${fogoSig}`)
  const { tx, sequence, logs } = await extractWormholeSequence(conn, fogoSig)
  if (tx === null) {
    console.log('  STATUS: ❌ tx not found on FOGO')
    return
  }
  console.log(`  slot:               ${tx.slot}`)
  console.log(`  blockTime:          ${tx.blockTime ?? 'n/a'}`)
  console.log(`  err:                ${tx.meta?.err === null ? '✅ none' : JSON.stringify(tx.meta?.err)}`)
  if (sequence === null) {
    console.log('  Sequence:           ❌ not found in logs (no Wormhole post_message?)')
    console.log('  --- raw logs (last 30) ---')
    for (const line of logs.slice(-30)) {
      console.log(`    ${line}`)
    }
    return
  }
  console.log(`  Sequence:           ${sequence}`)
  console.log()

  const emitterHex = Buffer.from(emitterPda.toBytes()).toString('hex')
  console.log('Querying Wormholescan directly by (chain, emitter, sequence)…')
  const r = await queryWormholescan(FOGO_WORMHOLE_CHAIN_ID, emitterHex, sequence)
  console.log(`  ${r.url}`)
  console.log(`  HTTP ${r.status}`)
  if (r.status === 200) {
    const data = r.body?.data ?? r.body
    const vaaB64 = data?.vaa
    console.log(`  ✅ VAA exists at Wormholescan${vaaB64 ? ` — ${vaaB64.length} chars b64` : ''}`)
    if (data?.guardianSetIndex !== undefined) {
      console.log(`     guardianSetIndex: ${data.guardianSetIndex}`)
    }
  } else if (r.status === 404) {
    console.log('  ❌ VAA NOT yet at Wormholescan')
    console.log('     → either guardians haven\'t observed it OR FOGO indexer lag')
  } else {
    console.log(`  ⚠️  unexpected: ${typeof r.body === 'string' ? r.body.slice(0, 200) : JSON.stringify(r.body).slice(0, 200)}`)
  }
}

main().catch((err) => { console.error('inspection failed:', err); process.exit(1) })
