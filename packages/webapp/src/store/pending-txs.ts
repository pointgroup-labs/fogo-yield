'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type PendingTxKind = 'deposit' | 'withdraw'

export interface PendingTx {
  signature: string
  kind: PendingTxKind
  amount: string // base-units bigint serialized as decimal string
  submittedAt: number // ms epoch
  /** Marked complete once the destination ATA balance reflects delivery. */
  delivered: boolean
}

export interface PendingTxsState {
  txs: PendingTx[]
  append: (entry: PendingTx) => void
  markDelivered: (signature: string) => void
  remove: (signature: string) => void
}

const STORAGE_KEY = 'fogo-onre.pending-txs.v1'
const MAX_ENTRIES = 50

export const usePendingTxsStore = create<PendingTxsState>()(
  persist(
    set => ({
      txs: [],
      append: entry =>
        set((state) => {
          // Newest first; de-dupe by signature so re-renders don't double-add.
          const next = [entry, ...state.txs.filter(t => t.signature !== entry.signature)]
          return { txs: next.slice(0, MAX_ENTRIES) }
        }),
      markDelivered: signature =>
        set((state) => {
          let changed = false
          const next = state.txs.map((t) => {
            if (t.signature === signature && !t.delivered) {
              changed = true
              return { ...t, delivered: true }
            }
            return t
          })
          // No-op guard so subscribers don't re-render on every poll tick.
          return changed ? { txs: next } : state
        }),
      remove: signature =>
        set(state => ({ txs: state.txs.filter(t => t.signature !== signature) })),
    }),
    {
      name: STORAGE_KEY,
      partialize: state => ({ txs: state.txs }),
      // Validate persisted shape on rehydrate — drops malformed entries
      // rather than letting a corrupt localStorage poison the store.
      merge: (persisted, current) => {
        const raw = (persisted as { txs?: unknown } | undefined)?.txs
        if (!Array.isArray(raw)) {
          return current
        }
        const validated = raw.filter((entry): entry is PendingTx =>
          typeof entry === 'object'
          && entry !== null
          && typeof (entry as PendingTx).signature === 'string'
          && ((entry as PendingTx).kind === 'deposit' || (entry as PendingTx).kind === 'withdraw')
          && typeof (entry as PendingTx).amount === 'string'
          && typeof (entry as PendingTx).submittedAt === 'number'
          && typeof (entry as PendingTx).delivered === 'boolean')
        return { ...current, txs: validated.slice(0, MAX_ENTRIES) }
      },
    },
  ),
)
