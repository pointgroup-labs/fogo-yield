/**
 * V1 proof: the OnRe `intent_transfer` fork can debit a user's token account
 * on FOGO's *patched* token program via the standard SPL delegate path — with
 * no Rust change to `bridge_ntt_tokens` and no canonical-setter privilege.
 *
 * Why this is faithful: the fork's only debit is a `transfer_checked` signed by
 * PDA([b"intent_transfer"], fork_id) (bridge_ntt_tokens.rs:300). The patched
 * token program's authorization (program/src/processor.rs) inspects only the
 * authority key, its signer flag, `source.owner`, and `source.delegate` — it
 * cannot tell which program issued the CPI. So a harness deployed at the fork
 * id issuing the identical signed `transfer_checked` exercises the exact
 * authorization decision against the *real* FOGO bytecode.
 *
 * Case A reproduces the production `0x4` (OwnerMismatch): the fork setter is
 * neither owner nor the hardcoded canonical global setter (EkYeW6…), so an
 * un-delegated debit is rejected. Case B is the fix: once the user approves the
 * fork setter as an SPL delegate, the patched program's delegate match-arm
 * authorizes the debit and clears the delegate when `delegated_amount` hits 0.
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { findIntentTransferSetterPda, ONRE_INTENT_PROGRAM_ID } from '@fogo-onre/sdk'
import { createApproveCheckedInstruction, TOKEN_PROGRAM_ID } from '@solana/spl-token'
import {
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js'
import { FailedTransactionMetadata } from 'litesvm'
import { beforeEach, describe, expect, it } from 'vitest'
import { createMint, mintTo } from './utils/mint'
import { createSvm } from './utils/svm'

const FIXTURES_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures',
)
/** FOGO mainnet patched token program, dumped to a non-auto-loaded path. */
const FOGO_TOKEN_SO = path.join(FIXTURES_DIR, 'fogo-token.so')
const FOGO_TOKEN_ELF_LEN = 157_648
/** Upgradeable-loader `ProgramData` header that precedes the ELF in-VM. */
const PROGRAMDATA_HEADER_LEN = 45
const BPF_LOADER_UPGRADEABLE = new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111')

const DECIMALS = 6
const FUND = 5_000_000n
const DEBIT = 1_000_000n

/** SPL TokenAccount layout offsets (packed, 165 bytes). */
const AMOUNT_OFFSET = 64
const DELEGATE_TAG_OFFSET = 72

function harnessDebitIx(
  source: PublicKey,
  mint: PublicKey,
  dest: PublicKey,
  setter: PublicKey,
  amount: bigint,
): TransactionInstruction {
  const data = Buffer.alloc(9)
  data.writeBigUInt64LE(amount, 0)
  data.writeUInt8(DECIMALS, 8)
  return new TransactionInstruction({
    programId: ONRE_INTENT_PROGRAM_ID,
    keys: [
      { pubkey: source, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: dest, isSigner: false, isWritable: true },
      { pubkey: setter, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data,
  })
}

describe('intent_transfer fork debit on the FOGO patched token program', () => {
  const payer = Keypair.generate()
  const user = Keypair.generate()
  let svm: ReturnType<typeof createSvm>
  let mint: PublicKey
  let source: PublicKey
  let dest: PublicKey
  let setter: PublicKey

  beforeEach(() => {
    svm = createSvm()
    // Swap the builtin stock SPL token for FOGO's patched program — per-test,
    // so no other suite is affected. The harness .so is already loaded at the
    // fork id by createSvm (fixtures/programs/inTFf5S7….so).
    svm.addProgramFromFile(TOKEN_PROGRAM_ID, FOGO_TOKEN_SO)
    svm.airdrop(payer.publicKey, BigInt(10e9))

    ;[setter] = findIntentTransferSetterPda(ONRE_INTENT_PROGRAM_ID)
    const mintKp = createMint(svm, payer, DECIMALS)
    mint = mintKp.publicKey
    source = mintTo(svm, payer, mint, user.publicKey, FUND)
    dest = mintTo(svm, payer, mint, setter, 0n)
  })

  function send(tx: Transaction, ...signers: Keypair[]) {
    tx.recentBlockhash = svm.latestBlockhash()
    tx.feePayer = payer.publicKey
    tx.sign(payer, ...signers)
    return svm.sendTransaction(tx)
  }

  function tokenAmount(ata: PublicKey): bigint {
    const acct = svm.getAccount(ata)
    if (!acct) {
      throw new Error('token account not found')
    }
    return new DataView(new Uint8Array(acct.data).buffer).getBigUint64(AMOUNT_OFFSET, true)
  }

  function delegateTag(ata: PublicKey): number {
    const acct = svm.getAccount(ata)
    if (!acct) {
      throw new Error('token account not found')
    }
    return acct.data[DELEGATE_TAG_OFFSET]
  }

  it('runs against the real patched token ELF loaded in the VM', () => {
    // The builtin stock SPL token is BPFLoader2-owned; only our explicit
    // override flips TokenkegQ to the upgradeable loader. Assert the derived
    // programdata holds the full 157,648-byte patched ELF — proving Case A/B
    // exercise FOGO's bytecode, not LiteSVM's stock token program.
    const [programData] = PublicKey.findProgramAddressSync(
      [TOKEN_PROGRAM_ID.toBuffer()],
      BPF_LOADER_UPGRADEABLE,
    )
    const acct = svm.getAccount(programData)
    expect(acct?.owner.equals(BPF_LOADER_UPGRADEABLE)).toBe(true)
    expect(acct?.data.length).toBe(FOGO_TOKEN_ELF_LEN + PROGRAMDATA_HEADER_LEN)
  })

  it('rejects an un-delegated setter debit with 0x4 (OwnerMismatch)', () => {
    const res = send(new Transaction().add(harnessDebitIx(source, mint, dest, setter, DEBIT)))
    expect(res).toBeInstanceOf(FailedTransactionMetadata)
    const logs = (res as FailedTransactionMetadata).meta().logs().join('\n')
    expect(logs).toMatch(/owner does not match|custom program error: 0x4/)
    expect(tokenAmount(source)).toBe(FUND)
  })

  it('authorizes the debit once the user approves the setter as delegate', () => {
    const approveRes = send(
      new Transaction().add(
        createApproveCheckedInstruction(
          source,
          mint,
          setter,
          user.publicKey,
          DEBIT,
          DECIMALS,
        ),
      ),
      user,
    )
    expect(approveRes).not.toBeInstanceOf(FailedTransactionMetadata)
    expect(delegateTag(source)).toBe(1)

    const debitRes = send(new Transaction().add(harnessDebitIx(source, mint, dest, setter, DEBIT)))
    expect(debitRes).not.toBeInstanceOf(FailedTransactionMetadata)

    expect(tokenAmount(source)).toBe(FUND - DEBIT)
    expect(tokenAmount(dest)).toBe(DEBIT)
    // Full delegated_amount consumed -> patched program clears the delegate.
    expect(delegateTag(source)).toBe(0)
  })
})
