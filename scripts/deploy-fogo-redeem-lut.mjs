#!/usr/bin/env node
/**
 * Deploys the ONyc redeem bridging LUT on FOGO — the redeem analogue of
 * `deploy-fogo-deposit-lut.mjs`. Without it the redeem `bridge_ntt_tokens`
 * tx exceeds Solana's 1232-byte legacy limit and the paymaster rejects it.
 *
 * Deposit and redeem are hard mirrors: identical account shape, only the
 * NTT manager/mint differ. So the redeem LUT = the deployed deposit union
 * LUT (all shared infra: fork setter, wormhole-core bridge/fee-collector,
 * executor programs, sysvars, token/system/ATA/metaplex/chain-id) PLUS the
 * ONyc-specific NTT + intent PDAs derived below. USDC extras carried over
 * from the deposit LUT are harmless.
 *
 * Self-check: we re-derive the USDC NTT set the same way and assert it is
 * already covered by the deposit LUT — proving the derivation matches the
 * live tx before we trust it for ONyc.
 *
 * Usage:
 *   FOGO_RPC_URL=https://mainnet.fogo.io \
 *   AUTHORITY_KEYPAIR=$HOME/.config/solana/id.json \
 *   node scripts/deploy-fogo-redeem-lut.mjs
 */

import fs from 'node:fs'
import { homedir } from 'node:os'
import { getAssociatedTokenAddressSync } from '@solana/spl-token'
import {
  AddressLookupTableProgram,
  Connection,
  Keypair,
  PublicKey,
  Transaction,
} from '@solana/web3.js'

const RPC = process.env.FOGO_RPC_URL ?? process.env.FOGO_RPC ?? 'https://mainnet.fogo.io'
const KEYPAIR_PATH = process.env.AUTHORITY_KEYPAIR ?? `${homedir()}/.config/solana/id.json`

const DEPOSIT_LUT = new PublicKey('DDu9vk67v32ZzvUmD3knTByz3mFmdGyzD81h6vg9mUmD')
const WORMHOLE_CORE = new PublicKey('worm2ZoG2kUd4vFXhvjh93UUH596ayRfgQ2MgjNMTth')
const FORK = new PublicKey('inTFf5S7ZtYr8SkwGG85mjDwAyJwjqEPdH2p2nuyrL9')
const METAPLEX = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s')

const ONYC_MANAGER = new PublicKey('nttpna5vXW7BN2Aa4AfTbkCncJWTEoBsnWvjS87Xgsd')
const FOGO_ONYC_MINT = new PublicKey('oNyCm1QsAatj3ckaEwZjtAPWvstPn3Zm5MAYPtkjEfa')
const USDC_S_MANAGER = new PublicKey('nttu74CdAmsErx5daJVCQNoDZujswFrskMzonoZSdGk')
const USDC_S_MINT = new PublicKey('uSd2czE61Evaf76RNbq4KPpXnkiL3irdzgLFUMe3NoG')

// Wormhole canonical chain id for Solana (redeem destination). NTT keys
// its peer + inbox-rate-limit PDAs by the *destination* chain.
const SOLANA_CHAIN_ID = 1
const EXTEND_CHUNK = 28

// Paymaster lane the redeem tx routes through. The bridge fee lands in
// the autoassigned sponsor's ONyc ATA, so that ATA is a stable account
// the tx always references — include it in the LUT or the compressed tx
// stays ~31 bytes over the 1232 legacy limit.
const PAYMASTER_URL = process.env.FOGO_PAYMASTER_URL ?? 'https://fogo-mainnet.dourolabs-paymaster.xyz'
const APP_DOMAIN = process.env.APP_DOMAIN ?? 'https://app.ignitionfi.xyz'

async function fetchBridgeSponsor() {
  const url = new URL('/api/sponsor_pubkey', PAYMASTER_URL)
  url.searchParams.set('domain', APP_DOMAIN)
  url.searchParams.set('index', 'autoassign')
  const resp = await fetch(url.toString())
  if (!resp.ok) {
    throw new Error(`sponsor_pubkey HTTP ${resp.status}: ${await resp.text()}`)
  }
  return new PublicKey((await resp.text()).trim())
}

function chainIdBe(id) {
  const b = Buffer.alloc(2)
  b.writeUInt16BE(id)
  return b
}
const pda = (seeds, programId) => PublicKey.findProgramAddressSync(seeds, programId)[0]

/**
 * The stable (non-per-user, non-per-tx) accounts `bridge_ntt_tokens`
 * references for one leg. Excludes source/nonce/intermediate/sponsor ATAs
 * (per-user) and session-authority/outbox-item/wormhole-message/payee
 * (per-tx) — those stay static in each tx.
 */
function deriveLegStable(managerProgram, fromMint) {
  const tokenAuthority = pda([Buffer.from('token_authority')], managerProgram)
  const emitter = pda([Buffer.from('emitter')], managerProgram)
  return {
    nttManager: managerProgram,
    nttConfig: pda([Buffer.from('config')], managerProgram),
    nttInboxRateLimit: pda([Buffer.from('inbox_rate_limit'), chainIdBe(SOLANA_CHAIN_ID)], managerProgram),
    nttOutboxRateLimit: pda([Buffer.from('outbox_rate_limit')], managerProgram),
    nttPeer: pda([Buffer.from('peer'), chainIdBe(SOLANA_CHAIN_ID)], managerProgram),
    nttTokenAuthority: tokenAuthority,
    nttCustody: getAssociatedTokenAddressSync(fromMint, tokenAuthority, true),
    transceiver: pda([Buffer.from('registered_transceiver'), managerProgram.toBuffer()], managerProgram),
    emitter,
    wormholeSequence: pda([Buffer.from('Sequence'), emitter.toBuffer()], WORMHOLE_CORE),
    expectedNttConfig: pda([Buffer.from('expected_ntt_config'), fromMint.toBuffer()], FORK),
    feeConfig: pda([Buffer.from('fee_config'), fromMint.toBuffer()], FORK),
    metadata: pda([Buffer.from('metadata'), METAPLEX.toBuffer(), fromMint.toBuffer()], METAPLEX),
    mint: fromMint,
  }
}

function loadKeypair(path) {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(path, 'utf8'))))
}

async function sendAndConfirm(connection, payer, ix) {
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed')
  const tx = new Transaction({ blockhash, lastValidBlockHeight, feePayer: payer.publicKey }).add(ix)
  tx.sign(payer)
  const sig = await connection.sendRawTransaction(tx.serialize(), { preflightCommitment: 'confirmed' })
  await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed')
  return sig
}

function dedupe(keys) {
  const seen = new Set()
  const out = []
  for (const k of keys) {
    const s = k.toBase58()
    if (!seen.has(s)) {
      seen.add(s)
      out.push(k)
    }
  }
  return out
}

async function main() {
  const connection = new Connection(RPC, 'confirmed')
  const authority = loadKeypair(KEYPAIR_PATH)
  console.log('Authority/payer:', authority.publicKey.toBase58())
  console.log('Balance:', await connection.getBalance(authority.publicKey), 'lamports')

  const depositResp = await connection.getAddressLookupTable(DEPOSIT_LUT)
  if (!depositResp.value) {
    throw new Error(`Deposit LUT ${DEPOSIT_LUT.toBase58()} not found on ${RPC}`)
  }
  const depositAddrs = depositResp.value.state.addresses
  const depositSet = new Set(depositAddrs.map(a => a.toBase58()))
  console.log(`Deposit LUT base: ${depositAddrs.length} entries`)

  // Self-check: the USDC stable set must already be covered by the deposit
  // LUT. A miss means our derivation drifts from the live tx — surface loudly.
  const usdcStable = Object.values(deriveLegStable(USDC_S_MANAGER, USDC_S_MINT))
  const usdcMissing = usdcStable.filter(a => !depositSet.has(a.toBase58()))
  console.log(`USDC self-check: ${usdcStable.length - usdcMissing.length}/${usdcStable.length} covered by deposit LUT`)
  for (const m of usdcMissing) {
    console.log('  NOT in deposit LUT:', m.toBase58())
  }

  const onycStable = deriveLegStable(ONYC_MANAGER, FOGO_ONYC_MINT)
  console.log('\nONyc stable accounts to add:')
  for (const [label, key] of Object.entries(onycStable)) {
    console.log(`  ${label.padEnd(20)} ${key.toBase58()}${depositSet.has(key.toBase58()) ? ' (already in deposit LUT)' : ''}`)
  }

  const sponsor = await fetchBridgeSponsor()
  const feeDestination = getAssociatedTokenAddressSync(FOGO_ONYC_MINT, sponsor, true)
  console.log(`\nSponsor ${sponsor.toBase58()} ONyc fee ATA: ${feeDestination.toBase58()}`)

  const unionList = dedupe([...depositAddrs, ...Object.values(onycStable), feeDestination])
  console.log(`\nUnion: ${unionList.length} entries (deposit ${depositAddrs.length} + ONyc new ${unionList.length - depositAddrs.length})`)

  if (process.env.DRY_RUN === '1') {
    console.log('DRY_RUN=1 — not deploying.')
    return
  }

  const slot = await connection.getSlot('confirmed')
  const [createIx, lut] = AddressLookupTableProgram.createLookupTable({
    authority: authority.publicKey,
    payer: authority.publicKey,
    recentSlot: slot,
  })
  console.log('\nLUT pubkey will be:', lut.toBase58())
  console.log('  created:', await sendAndConfirm(connection, authority, createIx))

  for (let i = 0; i < unionList.length; i += EXTEND_CHUNK) {
    const chunk = unionList.slice(i, i + EXTEND_CHUNK)
    const sig = await sendAndConfirm(connection, authority, AddressLookupTableProgram.extendLookupTable({
      payer: authority.publicKey,
      authority: authority.publicKey,
      lookupTable: lut,
      addresses: chunk,
    }))
    console.log(`  extended +${chunk.length} (${i + chunk.length}/${unionList.length}):`, sig)
  }

  for (let attempt = 0; attempt < 10; attempt++) {
    const resp = await connection.getAddressLookupTable(lut)
    if (resp.value && resp.value.state.addresses.length === unionList.length) {
      console.log('Verified: on-chain has', resp.value.state.addresses.length, 'entries')
      break
    }
    await new Promise(r => setTimeout(r, 500))
  }

  console.log('\nDONE. Set in packages/webapp/src/constants.ts:')
  console.log(`  FOGO_REDEEM_LUT_DEFAULT_BY_NETWORK[Network.Mainnet] = '${lut.toBase58()}'`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
