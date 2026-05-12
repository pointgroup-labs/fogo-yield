#!/usr/bin/env node
/**
 * Path-2 surgical workaround for the deployed `swap_onyc_to_usdc` handler
 * (relayer v0.1.3, mainnet): the handler derives `fee_vault_onyc_ata` as
 * `ATA(onyc_mint, relayer_config.fee_vault, allowOwnerOffCurve=true)` and
 * fails with Anchor 3012 (`AccountNotInitialized`) because the deployed
 * `initialize` stored `fee_vault` as a token-account address (an ATA) —
 * so the handler ends up looking at an ATA-of-an-ATA that has never been
 * created.
 *
 * This script creates that child ATA so the broken handler can succeed
 * for the currently stuck withdraw Flow. After upgrading the program with
 * the schema-fix patch, this script is no longer needed and the child
 * ATA becomes orphaned dust (off-curve owner = no signing key).
 *
 * Usage:
 *   SOLANA_RPC_URL=https://api.mainnet-beta.solana.com \
 *   SOLANA_KEYPAIR=/path/to/keypair.json \
 *   node scripts/create-fee-vault-child-ata.mjs
 *
 *   Optional: pass --dry-run to print derivations without sending a tx.
 */

import fs from 'node:fs'
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddress,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token'
import {
  Connection,
  Keypair,
  PublicKey,
  sendAndConfirmTransaction,
  Transaction,
} from '@solana/web3.js'

const RPC = process.env.SOLANA_RPC_URL ?? 'https://api.mainnet-beta.solana.com'
const KEYPAIR_PATH = process.env.SOLANA_KEYPAIR
if (!KEYPAIR_PATH) {
  console.error('Set SOLANA_KEYPAIR=/path/to/keypair.json')
  process.exit(1)
}
const dryRun = process.argv.includes('--dry-run')

const RELAYER_PROGRAM_ID = new PublicKey('onrenRKgX54qtWeK3cuaTBE71xx7dWMXn82ubH61vAp')
const CONFIG_SEED = Buffer.from('relayer_config')

// RelayerConfig field offsets (8 disc + 32 usdc + 32 onyc + 32 authority + 32 fee_vault).
const ONYC_MINT_OFFSET = 8 + 32
const FEE_VAULT_OFFSET = 8 + 32 + 32 + 32

function loadKeypair(path) {
  const raw = fs.readFileSync(path, 'utf8')
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw)))
}

async function main() {
  const connection = new Connection(RPC, 'confirmed')
  const payer = loadKeypair(KEYPAIR_PATH)

  const [configPda] = PublicKey.findProgramAddressSync([CONFIG_SEED], RELAYER_PROGRAM_ID)
  const cfg = await connection.getAccountInfo(configPda)
  if (!cfg) {
    throw new Error(`RelayerConfig PDA ${configPda.toBase58()} not found at RPC ${RPC}`)
  }

  const onycMint = new PublicKey(cfg.data.slice(ONYC_MINT_OFFSET, ONYC_MINT_OFFSET + 32))
  const feeVault = new PublicKey(cfg.data.slice(FEE_VAULT_OFFSET, FEE_VAULT_OFFSET + 32))

  // Off-curve allowed: feeVault is itself an ATA (PDA), so it sits off the
  // ed25519 curve and the standard ATA derivation would reject it.
  const childAta = await getAssociatedTokenAddress(
    onycMint,
    feeVault,
    true,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  )

  console.log('Relayer program:     ', RELAYER_PROGRAM_ID.toBase58())
  console.log('RelayerConfig PDA:   ', configPda.toBase58())
  console.log('onyc_mint:           ', onycMint.toBase58())
  console.log('fee_vault (config):  ', feeVault.toBase58())
  console.log('child ATA to create: ', childAta.toBase58())
  console.log('payer:               ', payer.publicKey.toBase58())

  const existing = await connection.getAccountInfo(childAta)
  if (existing) {
    console.log('\nchild ATA already exists — nothing to do.')
    return
  }

  if (dryRun) {
    console.log('\n--dry-run: not sending tx')
    return
  }

  const ix = createAssociatedTokenAccountInstruction(
    payer.publicKey,
    childAta,
    feeVault,
    onycMint,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  )

  const tx = new Transaction().add(ix)
  const sig = await sendAndConfirmTransaction(connection, tx, [payer], {
    commitment: 'confirmed',
    skipPreflight: false,
  })
  console.log('\nchild ATA created. tx:', sig)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
