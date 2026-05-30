#!/usr/bin/env node
/**
 * One-shot LUT extender. Adds the sponsor's wFOGO ATA
 * (2YSaT1e3iYJMDPKCjyb5bq6UwaUqicSJ3S1VrDrFWj3Q) to the already-
 * deployed FOGO deposit LUT (DDu9vk67…) so the bridge tx compresses
 * one more writable static key. Without it the bridge serializes to
 * 1246 bytes — 14 over the 1232 packet limit; with it, ~1215.
 *
 * Why this key was missed in the original deploy: the seven EXTRA_KEYS
 * baked into deploy-fogo-deposit-lut.mjs were taken from the readonly
 * tail of a failing tx's static-key list. The sponsor wFOGO ATA shows
 * up in the *writable* segment (it's debited the executor base fee +
 * margin), and that segment was inspected later, after the first deploy.
 *
 * Why this can be a one-shot extend rather than a redeploy: the LUT's
 * authority is intentionally kept live (see comment in
 * deploy-fogo-deposit-lut.mjs) precisely so we can chase upstream
 * bridging-LUT drift and our own oversights without minting a new LUT
 * pubkey and rotating it through constants.ts.
 *
 * Usage (same env as the deploy script):
 *   FOGO_RPC_URL=https://mainnet.fogo.io \
 *   AUTHORITY_KEYPAIR=/path/to/keypair.json \
 *   node scripts/extend-fogo-deposit-lut.mjs
 */

import fs from 'node:fs'
import {
  AddressLookupTableProgram,
  Connection,
  Keypair,
  PublicKey,
  Transaction,
} from '@solana/web3.js'

const RPC = process.env.FOGO_RPC_URL ?? 'https://mainnet.fogo.io'
const KEYPAIR_PATH = process.env.AUTHORITY_KEYPAIR
if (!KEYPAIR_PATH) {
  console.error('Set AUTHORITY_KEYPAIR=/path/to/keypair.json (must be the LUT authority)')
  process.exit(1)
}

const LUT_PUBKEY = new PublicKey('DDu9vk67v32ZzvUmD3knTByz3mFmdGyzD81h6vg9mUmD')

// Fork re-point round. The deposit `bridge_ntt_tokens` now targets the
// OnRe fork (inTFf5S7…) instead of upstream Xfry4dW…, so every
// program-derived fixed account changed pubkey. The LUT still holds the
// upstream equivalents (left in place — harmless, and useful for the
// {OnRe,Fogo} switch-back), but the four fork addresses below ride
// uncompressed → bridge tx serializes to 1302 bytes (70 over the 1232
// limit). All four are global (program id + deterministic PDAs against
// fixed seeds/mints), so safe to LUT.
//
//   fork program id        = inTFf5S7…
//   fork setter            = PDA(["intent_transfer"], fork)
//   fork ntt_config(USDC.s) = PDA(["expected_ntt_config", USDC.s], fork)
//   fork fee_config(USDC.s) = PDA(["fee_config", USDC.s], fork)
const NEW_KEYS = [
  new PublicKey('inTFf5S7ZtYr8SkwGG85mjDwAyJwjqEPdH2p2nuyrL9'),
  new PublicKey('E11HNeVDA7ZMemjezZaqfWTfdyL1PVkDfLY4xj762wKx'),
  new PublicKey('6cZMFsFQ8deQmnkC2Frdb2x3wRym5pyJnJyWN1L5q4CF'),
  new PublicKey('7i5UFAHZTKb8St5q4LkZAYmocYSajyd6cqd26CoMvXo6'),
]

function loadKeypair(path) {
  const raw = JSON.parse(fs.readFileSync(path, 'utf8'))
  return Keypair.fromSecretKey(Uint8Array.from(raw))
}

async function main() {
  const connection = new Connection(RPC, 'confirmed')
  const authority = loadKeypair(KEYPAIR_PATH)
  console.log('Authority/payer:', authority.publicKey.toBase58())

  // Catch an authority mismatch client-side for a clearer error than the
  // runtime failure the extend would otherwise hit.
  const before = await connection.getAddressLookupTable(LUT_PUBKEY)
  if (!before.value) {
    console.error('LUT not found:', LUT_PUBKEY.toBase58())
    process.exit(1)
  }
  const onchainAuth = before.value.state.authority
  if (!onchainAuth || !onchainAuth.equals(authority.publicKey)) {
    console.error('Authority mismatch.')
    console.error('  on-chain:', onchainAuth?.toBase58() ?? '<frozen>')
    console.error('  loaded:  ', authority.publicKey.toBase58())
    process.exit(1)
  }
  console.log(`LUT currently has ${before.value.state.addresses.length} entries`)

  // Skip keys already present — duplicates cost rent without changing
  // semantics.
  const existing = new Set(before.value.state.addresses.map(a => a.toBase58()))
  const toAdd = NEW_KEYS.filter(k => !existing.has(k.toBase58()))
  if (toAdd.length === 0) {
    console.log('All requested keys already in LUT — nothing to do.')
    return
  }
  console.log(`Adding ${toAdd.length} new key(s):`)
  toAdd.forEach(k => console.log('  +', k.toBase58()))

  const extendIx = AddressLookupTableProgram.extendLookupTable({
    payer: authority.publicKey,
    authority: authority.publicKey,
    lookupTable: LUT_PUBKEY,
    addresses: toAdd,
  })

  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed')
  const tx = new Transaction({ blockhash, lastValidBlockHeight, feePayer: authority.publicKey })
  tx.add(extendIx)
  tx.sign(authority)
  const sig = await connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
    preflightCommitment: 'confirmed',
  })
  await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed')
  console.log('Extended:', sig)

  // Poll for activation — newly extended LUT slots aren't readable
  // until the next slot lands.
  for (let attempt = 0; attempt < 10; attempt++) {
    const after = await connection.getAddressLookupTable(LUT_PUBKEY)
    if (after.value && after.value.state.addresses.length === before.value.state.addresses.length + toAdd.length) {
      console.log(`Verified: on-chain now has ${after.value.state.addresses.length} entries`)
      return
    }
    await new Promise(r => setTimeout(r, 500))
  }
  console.warn('Extend confirmed but on-chain state still lagging — check manually.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
