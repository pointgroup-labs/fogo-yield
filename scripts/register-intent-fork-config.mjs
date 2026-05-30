// One-off admin: register NTT + fee config on the OnRe intent fork.
// Gated by UpgradeAuthority — the deployer key (fork upgrade authority)
// must sign. Single-byte instruction discriminators ([2]=register_ntt_config,
// [3]=register_fee_config) mirror the fork's Fogo-custom #[instruction] attrs.
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from '@solana/web3.js'

const RPC = process.env.FOGO_RPC ?? 'https://mainnet.fogo.io'
const FORK = new PublicKey('inTFf5S7ZtYr8SkwGG85mjDwAyJwjqEPdH2p2nuyrL9')
const BPF_LOADER = new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111')

const USDC_S_MINT = new PublicKey('uSd2czE61Evaf76RNbq4KPpXnkiL3irdzgLFUMe3NoG')
const USDC_S_MANAGER = new PublicKey('nttu74CdAmsErx5daJVCQNoDZujswFrskMzonoZSdGk')
const FOGO_ONYC_MINT = new PublicKey('oNyCm1QsAatj3ckaEwZjtAPWvstPn3Zm5MAYPtkjEfa')
const ONYC_MANAGER = new PublicKey('nttpna5vXW7BN2Aa4AfTbkCncJWTEoBsnWvjS87Xgsd')

// Mirrored byte-for-byte from upstream Fogo USDC.s fee_config on FOGO mainnet.
const USDC_S_FEE = { intrachain: 10000n, bridge: 2_000_000n }
// ONyc fee: same raw values as USDC.s (note: ONyc is 9-decimals).
const ONYC_FEE = { intrachain: 10000n, bridge: 2_000_000n }

const programData = PublicKey.findProgramAddressSync([FORK.toBuffer()], BPF_LOADER)[0]
const feeConfigPda = mint => PublicKey.findProgramAddressSync([Buffer.from('fee_config'), mint.toBuffer()], FORK)[0]
const nttConfigPda = mint => PublicKey.findProgramAddressSync([Buffer.from('expected_ntt_config'), mint.toBuffer()], FORK)[0]

function registerNttIx(signer, mint, manager) {
  return new TransactionInstruction({
    programId: FORK,
    keys: [
      { pubkey: signer, isSigner: true, isWritable: true },
      { pubkey: programData, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: nttConfigPda(mint), isSigner: false, isWritable: true },
      { pubkey: manager, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.from([2]),
  })
}

function registerFeeIx(signer, mint, fee) {
  const data = Buffer.alloc(1 + 8 + 8)
  data[0] = 3
  data.writeBigUInt64LE(fee.intrachain, 1)
  data.writeBigUInt64LE(fee.bridge, 9)
  return new TransactionInstruction({
    programId: FORK,
    keys: [
      { pubkey: signer, isSigner: true, isWritable: true },
      { pubkey: programData, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: feeConfigPda(mint), isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  })
}

const keypairPath = process.env.SOLANA_KEYPAIR ?? `${homedir()}/.config/solana/id.json`
const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(keypairPath, 'utf8'))))
const conn = new Connection(RPC, 'confirmed')

const steps = [
  ['register_ntt_config USDC.s', registerNttIx(payer.publicKey, USDC_S_MINT, USDC_S_MANAGER)],
  ['register_fee_config USDC.s', registerFeeIx(payer.publicKey, USDC_S_MINT, USDC_S_FEE)],
  ['register_ntt_config ONyc', registerNttIx(payer.publicKey, FOGO_ONYC_MINT, ONYC_MANAGER)],
  ['register_fee_config ONyc', registerFeeIx(payer.publicKey, FOGO_ONYC_MINT, ONYC_FEE)],
].filter(([label]) => !process.env.ONLY || label.includes(process.env.ONLY))

console.log('signer (upgrade authority):', payer.publicKey.toBase58())
console.log('program_data:', programData.toBase58())
for (const [label, ix] of steps) {
  const sig = await sendAndConfirmTransaction(conn, new Transaction().add(ix), [payer], { commitment: 'confirmed' })
  console.log(`OK  ${label}\n    sig ${sig}`)
}
