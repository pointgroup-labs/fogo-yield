// One-off admin: authorize the OnRe intent fork to spend session-custodied
// tokens under our domain, via domain-registry `add_program`.
// Gated by the registry Config.authority — we read it first and refuse to
// send unless our signer matches (Fogo controls this registry otherwise).
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import {
  Connection,
  Keypair,
  PublicKey,
  sendAndConfirmTransaction,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js'

const RPC = process.env.FOGO_RPC ?? 'https://mainnet.fogo.io'
const DOMAIN = process.env.DOMAIN ?? 'https://app.ignitionfi.xyz'
const DOMAIN_REGISTRY = new PublicKey('DomaLfEueNY6JrQSEFjuXeUDiohFmSrFeTNTPamS2yog')
const FORK = new PublicKey('inTFf5S7ZtYr8SkwGG85mjDwAyJwjqEPdH2p2nuyrL9')
const ADD_PROGRAM_DISC = Buffer.from([100, 64, 60, 97, 158, 105, 164, 85])
const CONFIG_DISC = Buffer.from([155, 12, 170, 224, 30, 250, 204, 130])

const configPda = PublicKey.findProgramAddressSync([Buffer.from('config')], DOMAIN_REGISTRY)[0]
const domainHash = createHash('sha256').update(DOMAIN).digest()
const domainRecordPda = PublicKey.findProgramAddressSync(
  [Buffer.from('domain-record'), domainHash],
  DOMAIN_REGISTRY,
)[0]
const signerPda = PublicKey.findProgramAddressSync(
  [Buffer.from('fogo_session_program_signer')],
  FORK,
)[0]

function encodeAddProgram(domain) {
  const domainBytes = Buffer.from(domain, 'utf8')
  const len = Buffer.alloc(4)
  len.writeUInt32LE(domainBytes.length, 0)
  return Buffer.concat([ADD_PROGRAM_DISC, len, domainBytes])
}

const keypairPath = process.env.SOLANA_KEYPAIR ?? `${homedir()}/.config/solana/id.json`
const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(keypairPath, 'utf8'))))
const conn = new Connection(RPC, 'confirmed')

console.log('signer:        ', payer.publicKey.toBase58())
console.log('domain:        ', DOMAIN)
console.log('config pda:    ', configPda.toBase58())
console.log('domain record: ', domainRecordPda.toBase58())
console.log('fork signer pda:', signerPda.toBase58())

const configInfo = await conn.getAccountInfo(configPda)
if (!configInfo) {
  throw new Error(`Config PDA ${configPda.toBase58()} not found on ${RPC}`)
}
if (!configInfo.data.subarray(0, 8).equals(CONFIG_DISC)) {
  throw new Error('Config account discriminator mismatch')
}
const registryAuthority = new PublicKey(configInfo.data.subarray(8, 40))
console.log('registry authority:', registryAuthority.toBase58())

if (!registryAuthority.equals(payer.publicKey)) {
  console.log('\nSTOP: our signer is NOT the registry authority.')
  console.log('Fogo controls the domain registry; add_program will fail.')
  console.log('Hand this off to the registry authority above.')
  process.exit(1)
}

const ix = new TransactionInstruction({
  programId: DOMAIN_REGISTRY,
  keys: [
    { pubkey: payer.publicKey, isSigner: true, isWritable: true },
    { pubkey: configPda, isSigner: false, isWritable: false },
    { pubkey: domainRecordPda, isSigner: false, isWritable: true },
    { pubkey: FORK, isSigner: false, isWritable: false },
    { pubkey: signerPda, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ],
  data: encodeAddProgram(DOMAIN),
})

const sig = await sendAndConfirmTransaction(conn, new Transaction().add(ix), [payer], { commitment: 'confirmed' })
console.log(`\nOK  add_program ${FORK.toBase58()} -> ${DOMAIN}\n    sig ${sig}`)
