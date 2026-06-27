import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { address, getTransactionDecoder } from '@solana/kit'
import { Keypair, PublicKey, SendTransactionError, Transaction, VersionedTransaction } from '@solana/web3.js'
import { LiteSVMProvider } from 'anchor-litesvm'
import bs58 from 'bs58'
import { FailedTransactionMetadata, LiteSVM } from 'litesvm'

const FIXTURES_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../fixtures',
)

/** In-repo program — loaded from `target/deploy/`, never from the fixtures dir. */
const RELAYER_PROGRAM_ID = 'onrenRKgX54qtWeK3cuaTBE71xx7dWMXn82ubH61vAp'
const RELAYER_SO_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../target/deploy/fogo_ntt_relayer.so',
)

/**
 * litesvm 1.2.0 moved its public API to @solana/kit (Address/kit-Transaction).
 * This suite and anchor-litesvm@0.2.1 speak @solana/web3.js, so we patch the
 * instance back to the pre-1.0 web3.js signatures, converting at the boundary.
 * The napi core is unchanged, so the round-trip is faithful.
 */
function asWeb3Svm(svm: LiteSVM): LiteSVM {
  const kit = {
    getAccount: svm.getAccount.bind(svm),
    setAccount: svm.setAccount.bind(svm),
    airdrop: svm.airdrop.bind(svm),
    addProgramFromFile: svm.addProgramFromFile.bind(svm),
    addProgram: svm.addProgram.bind(svm),
    sendTransaction: svm.sendTransaction.bind(svm),
  }
  const toAddr = (pk: PublicKey) => address(pk.toBase58())
  const toKitTx = (tx: Transaction | VersionedTransaction) => {
    const wire = tx instanceof Transaction
      ? tx.serialize({ requireAllSignatures: false, verifySignatures: false })
      : tx.serialize()
    return getTransactionDecoder().decode(new Uint8Array(wire))
  }

  const patched = svm as any
  patched.getAccount = (pk: PublicKey) => {
    const acc = kit.getAccount(toAddr(pk))
    return acc.exists
      ? {
          executable: acc.executable,
          owner: new PublicKey(acc.programAddress),
          lamports: Number(acc.lamports),
          data: acc.data as Uint8Array,
          rentEpoch: 0,
        }
      : null
  }
  patched.setAccount = (pk: PublicKey, acct: { data: Uint8Array, owner: PublicKey, lamports: number, executable: boolean }) =>
    kit.setAccount({
      address: toAddr(pk),
      data: acct.data,
      executable: acct.executable,
      lamports: BigInt(acct.lamports) as any,
      programAddress: toAddr(acct.owner),
      space: BigInt(acct.data.length),
    })
  patched.airdrop = (pk: PublicKey, lamports: bigint | number) => kit.airdrop(toAddr(pk), BigInt(lamports) as any)
  patched.addProgramFromFile = (pk: PublicKey, p: string) => kit.addProgramFromFile(toAddr(pk), p)
  patched.addProgram = (pk: PublicKey, bytes: Uint8Array) => kit.addProgram(toAddr(pk), bytes)
  patched.sendTransaction = (tx: Transaction | VersionedTransaction) => kit.sendTransaction(toKitTx(tx))
  return svm
}

/**
 * Create a LiteSVM instance. Third-party programs (NTT, OnRe, Wormhole core
 * + token bridge) come from `tests/fixtures/programs/` (filename = program
 * ID). The relayer itself is loaded straight from the `anchor build` output
 * so tests always run against the current source — no fixture sync required.
 */
export function createSvm(): LiteSVM {
  const svm = asWeb3Svm(new LiteSVM())
  const programsDir = path.join(FIXTURES_DIR, 'programs')
  for (const file of fs.readdirSync(programsDir).filter(f => f.endsWith('.so'))) {
    const programId = path.basename(file, '.so')
    if (programId === RELAYER_PROGRAM_ID) {
      continue
    }
    svm.addProgramFromFile(new PublicKey(programId), path.join(programsDir, file))
  }
  if (!fs.existsSync(RELAYER_SO_PATH)) {
    throw new Error(
      `Relayer .so not found at ${RELAYER_SO_PATH}. Run \`anchor build\` first `
      + `(or rely on the \`pretest\` hook).`,
    )
  }
  svm.addProgramFromFile(new PublicKey(RELAYER_PROGRAM_ID), RELAYER_SO_PATH)
  return svm
}

/** Minimal Wallet implementation compatible with anchor-litesvm's Wallet interface. */
class SimpleWallet {
  constructor(readonly payer: Keypair) {}
  get publicKey() { return this.payer.publicKey }
  async signTransaction<T extends Transaction>(tx: T): Promise<T> {
    tx.partialSign(this.payer)
    return tx
  }

  async signAllTransactions<T extends Transaction>(txs: T[]): Promise<T[]> {
    txs.forEach(tx => tx.partialSign(this.payer))
    return txs
  }
}

/**
 * Create a LiteSVM + LiteSVMProvider pair, airdropping SOL to the payer.
 * Uses `as any` cast because anchor-litesvm@0.2.1 declares dependency on
 * @coral-xyz/anchor while we use @anchor-lang/core (structurally compatible).
 */
export function createProvider(svm: LiteSVM, payer: Keypair): LiteSVMProvider {
  svm.airdrop(payer.publicKey, BigInt(10e9))
  const provider = new LiteSVMProvider(svm as any, new SimpleWallet(payer) as any)

  // Patch sendAndConfirm to use our litesvm@1.2.0's FailedTransactionMetadata.
  // anchor-litesvm bundles litesvm@0.3.3 internally, so its `instanceof` check
  // against FailedTransactionMetadata fails when we pass an LiteSVM from 1.2.0.
  provider.sendAndConfirm = async (tx: Transaction, signers?: any[], _opts?: any) => {
    // Let anchor-litesvm build & sign the tx normally
    tx.feePayer = tx.feePayer ?? provider.wallet.publicKey
    tx.recentBlockhash = svm.latestBlockhash()
    signers?.forEach((s: any) => tx.partialSign(s))
    await provider.wallet.signTransaction(tx)

    if (!tx.signature) {
      throw new Error('Missing fee payer signature')
    }
    const signature = bs58.encode(tx.signature)

    const res = svm.sendTransaction(tx)
    if (res instanceof FailedTransactionMetadata) {
      throw new SendTransactionError({
        action: 'send',
        signature,
        transactionMessage: res.err().toString(),
        logs: res.meta().logs(),
      })
    }

    return signature
  }

  return provider
}
