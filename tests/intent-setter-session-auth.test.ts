/**
 * Session-rail proof: the OnRe `intent_transfer` fork can debit a user's token
 * account on FOGO's *patched* token program via the FOGO **session rail** —
 * with no canonical-setter privilege and no SPL delegate approve.
 *
 * Why this is faithful: the patched token program (program/src/processor.rs
 * `process_transfer`) blesses a non-owner mover when the authority is a session
 * account (owner = SESSION_MANAGER_ID) whose `Session.user == source.owner` and
 * whose authorized programs include the caller — proven by finding the caller's
 * program-signer PDA among the transfer's extra accounts as a signer. A harness
 * deployed at the fork id, emitting the canonical 5-account in-session
 * `transfer_checked` (authority = session, program_signer = PDA([b"fogo_session_
 * program_signer"], fork_id) appended), exercises that exact authorization arm
 * against the real FOGO bytecode.
 *
 * Case A: an authorizing session (user = source.owner, authorized_tokens = All,
 * authorized_programs = Specific([(fork_id, programSigner)])) → debit succeeds.
 * Case B: a session NOT authorizing the fork (Specific list omits it) → the
 * program-signer is absent from its authorized set → UnauthorizedProgram, debit
 * rejected, balance untouched.
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ONRE_INTENT_PROGRAM_ID } from '@fogo-onre/sdk'
import { TOKEN_PROGRAM_ID } from '@solana/spl-token'
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

/** Session manager program — owns every session account on FOGO. */
const SESSION_MANAGER_ID = new PublicKey('SesswvJ7puvAgpyqp7N8HnjNnvpnS8447tKNF3sPgbC')
/** Anchor discriminator for the `Session` account (= sha256("account:Session")[..8]). */
const SESSION_DISCRIMINATOR = Buffer.from([243, 81, 72, 115, 214, 188, 72, 144])
const PROGRAM_SIGNER_SEED = Buffer.from('fogo_session_program_signer')

const DECIMALS = 6
const FUND = 5_000_000n
const DEBIT = 1_000_000n
const AMOUNT_OFFSET = 64

/**
 * Borsh-encode a V1 active `Session` account body for the patched token program.
 * Layout: discriminator(8) | sponsor(32) | major:u8 | SessionInfo::V1 tag(1) |
 *   ActiveSessionInfo{ user(32) | expiration:i64 | authorized_programs |
 *   authorized_tokens | extra }.
 * authorized_programs = Specific(Vec<{program_id(32), signer_pda(32)}>);
 * authorized_tokens = All; extra = empty vec.
 */
function encodeSession(
  sponsor: PublicKey,
  user: PublicKey,
  authorizedPrograms: { programId: PublicKey, signerPda: PublicKey }[],
): Buffer {
  const parts: Buffer[] = []
  parts.push(SESSION_DISCRIMINATOR)
  parts.push(sponsor.toBuffer())
  parts.push(Buffer.from([0])) // major = 0
  parts.push(Buffer.from([1])) // SessionInfo::V1
  parts.push(user.toBuffer())

  const expiration = Buffer.alloc(8)
  expiration.writeBigInt64LE(9_223_372_036_854_775_807n) // i64::MAX — never expires
  parts.push(expiration)

  parts.push(Buffer.from([0])) // AuthorizedPrograms::Specific
  const len = Buffer.alloc(4)
  len.writeUInt32LE(authorizedPrograms.length)
  parts.push(len)
  for (const p of authorizedPrograms) {
    parts.push(p.programId.toBuffer())
    parts.push(p.signerPda.toBuffer())
  }

  parts.push(Buffer.from([1])) // AuthorizedTokens::All
  parts.push(Buffer.alloc(4)) // extra: empty vec (len 0)
  return Buffer.concat(parts)
}

function sessionDebitIx(
  source: PublicKey,
  mint: PublicKey,
  dest: PublicKey,
  session: PublicKey,
  programSigner: PublicKey,
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
      { pubkey: session, isSigner: true, isWritable: false },
      { pubkey: programSigner, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data,
  })
}

describe('intent_transfer fork debit via the FOGO session rail', () => {
  const payer = Keypair.generate()
  const user = Keypair.generate()
  const session = Keypair.generate()
  let svm: ReturnType<typeof createSvm>
  let mint: PublicKey
  let source: PublicKey
  let dest: PublicKey
  let programSigner: PublicKey

  beforeEach(() => {
    svm = createSvm()
    svm.addProgramFromFile(TOKEN_PROGRAM_ID, FOGO_TOKEN_SO)
    svm.airdrop(payer.publicKey, BigInt(10e9))

    ;[programSigner] = PublicKey.findProgramAddressSync(
      [PROGRAM_SIGNER_SEED],
      ONRE_INTENT_PROGRAM_ID,
    )
    const mintKp = createMint(svm, payer, DECIMALS)
    mint = mintKp.publicKey
    source = mintTo(svm, payer, mint, user.publicKey, FUND)
    dest = mintTo(svm, payer, mint, session.publicKey, 0n)
  })

  function setSession(authorized: { programId: PublicKey, signerPda: PublicKey }[]) {
    const data = encodeSession(payer.publicKey, user.publicKey, authorized)
    svm.setAccount(session.publicKey, {
      executable: false,
      owner: SESSION_MANAGER_ID,
      lamports: 5_000_000,
      data: new Uint8Array(data),
      rentEpoch: 0,
    })
  }

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

  it('authorizes the debit when the session authorizes the fork', () => {
    setSession([{ programId: ONRE_INTENT_PROGRAM_ID, signerPda: programSigner }])

    const res = send(
      new Transaction().add(sessionDebitIx(source, mint, dest, session.publicKey, programSigner, DEBIT)),
      session,
    )
    expect(res).not.toBeInstanceOf(FailedTransactionMetadata)
    expect(tokenAmount(source)).toBe(FUND - DEBIT)
    expect(tokenAmount(dest)).toBe(DEBIT)
  })

  it('rejects the debit when the session does not authorize the fork', () => {
    const otherProgram = Keypair.generate().publicKey
    const [otherSigner] = PublicKey.findProgramAddressSync([PROGRAM_SIGNER_SEED], otherProgram)
    setSession([{ programId: otherProgram, signerPda: otherSigner }])

    const res = send(
      new Transaction().add(sessionDebitIx(source, mint, dest, session.publicKey, programSigner, DEBIT)),
      session,
    )
    expect(res).toBeInstanceOf(FailedTransactionMetadata)
    expect(tokenAmount(source)).toBe(FUND)
  })
})
