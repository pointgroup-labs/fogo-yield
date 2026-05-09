'use client'

import type { TimelineRow } from '@/lib/bridgeHistory/types'
import { isEstablished, useSession } from '@fogo/sessions-sdk-react'
import { useIsRestoring } from '@tanstack/react-query'
import { ArrowDownLeft, ArrowUpRight, Check, ExternalLink, Inbox, Loader2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { FOGO_ONYC_DECIMALS, USDC_DECIMALS } from '@/constants'
import { useBridgeHistory } from '@/hooks/useBridgeHistory'
import { fogoTxUrl } from '@/utils/explorers'

export default function BridgeHistory() {
  // Same hydration pattern as PendingTxList: defer the restoring branch
  // to a post-mount render so the first client paint matches the SSR
  // empty render.
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    setMounted(true)
  }, [])
  const restoring = useIsRestoring()

  // 60s ticker drives relative-time labels in every row from a single
  // source of truth — keeps row renders pure and avoids N timers.
  const nowMs = useNowTicker(60_000)

  const session = useSession()
  const owner = isEstablished(session) ? session.walletPublicKey : null
  const { rows, isLoading, isError, hasNextPage, fetchNextPage, isFetchingNextPage } = useBridgeHistory(owner)

  if (owner === null) {
    return null
  }

  if (mounted && restoring) {
    return <SkeletonList count={2} />
  }

  if (isLoading) {
    return <SkeletonList count={3} />
  }

  if (isError && rows.length === 0) {
    return (
      <Alert>
        <AlertTitle>Bridge history unavailable</AlertTitle>
        <AlertDescription>Couldn&apos;t load history. Try again in a moment.</AlertDescription>
      </Alert>
    )
  }

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed py-8 text-center">
        <Inbox aria-hidden className="size-6 text-muted-foreground" />
        <p className="text-sm font-medium">No bridges yet</p>
        <p className="text-xs text-muted-foreground">Your deposits and withdrawals will appear here.</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <Card className="overflow-hidden p-0">
        <ul aria-label="Bridge history" className="divide-y">
          {rows.map(r => <BridgeRow key={r.signature} row={r} nowMs={nowMs} />)}
        </ul>
      </Card>
      {hasNextPage && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => fetchNextPage()}
          disabled={isFetchingNextPage}
          className="self-center text-xs text-muted-foreground"
        >
          {isFetchingNextPage ? 'Loading…' : 'Load more'}
        </Button>
      )}
    </div>
  )
}

function SkeletonList({ count }: { count: number }) {
  return (
    <Card className="overflow-hidden p-0">
      <ul className="divide-y">
        {Array.from({ length: count }, (_, i) => (
          <li key={i} className="px-4 py-3">
            <Skeleton className="h-10 rounded" />
          </li>
        ))}
      </ul>
    </Card>
  )
}

function BridgeRow({ row, nowMs }: { row: TimelineRow, nowMs: number }) {
  const isDeposit = row.kind === 'deposit'
  const decimals = isDeposit ? USDC_DECIMALS : FOGO_ONYC_DECIMALS
  const ticker = isDeposit ? 'USDC.s' : 'ONyc'
  // Verb form reads naturally next to the relative time:
  // "Deposited · 2h ago" / "Withdrew · 5m ago".
  const action = isDeposit ? 'Deposited' : 'Withdrew'
  const amount = formatAmount(row.amountRaw, decimals)
  const blockMs = row.blockTime * 1000
  const relTime = formatRelativeTime(blockMs, nowMs)
  const { absTime, isoTime } = useMemo(() => {
    const d = new Date(blockMs)
    return { absTime: d.toLocaleString(), isoTime: d.toISOString() }
  }, [blockMs])
  const DirectionIcon = isDeposit ? ArrowUpRight : ArrowDownLeft

  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <span
        aria-hidden
        className={`flex size-8 shrink-0 items-center justify-center rounded-full ${
          isDeposit ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
        }`}
      >
        <DirectionIcon className="size-4" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-baseline gap-1.5 text-base">
          <span className="font-semibold tabular-nums">
            {row.amountIsApproximate
              ? (
                  <span title="Approximate — reconstructed from on-chain data, may differ slightly from your typed amount">
                    ~
                    {amount}
                  </span>
                )
              : amount}
          </span>
          <span className="text-sm text-muted-foreground">{ticker}</span>
        </div>
        <div className="text-xs text-muted-foreground">
          {action}
          {' · '}
          <time dateTime={isoTime} title={absTime}>
            {relTime}
          </time>
        </div>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <StatusBadge row={row} />
        <a
          href={fogoTxUrl(row.signature)}
          target="_blank"
          rel="noreferrer noopener"
          aria-label="View source transaction on FogoScan"
          className="text-muted-foreground transition-colors hover:text-foreground"
        >
          <ExternalLink aria-hidden className="size-3.5" />
        </a>
      </div>
    </li>
  )
}

function StatusBadge({ row }: { row: TimelineRow }) {
  // Precedence: phase > status. `unknown` renders no badge (graceful degrade).
  // Visual loudness intentionally inverted from "important = bright": a
  // delivered row is the resting state and should recede; in-progress
  // rows are what need user attention so they get the filled treatment.
  if (row.phase !== null) {
    return (
      <Badge variant="secondary" aria-label={`status: ${row.phase}`} className="gap-1">
        <Loader2 aria-hidden className="size-3 animate-spin" />
        {row.phase}
      </Badge>
    )
  }
  if (row.status === 'delivered') {
    return (
      <Badge variant="outline" aria-label="status: delivered" className="gap-1 text-muted-foreground">
        <Check aria-hidden className="size-3 text-emerald-600 dark:text-emerald-400" />
        Delivered
      </Badge>
    )
  }
  if (row.status === 'pending') {
    return (
      <Badge variant="secondary" aria-label="status: bridging" className="gap-1">
        <Loader2 aria-hidden className="size-3 animate-spin" />
        Bridging
      </Badge>
    )
  }
  return null
}

/**
 * Re-renders subscribers every `intervalMs`. Cheaper than per-row
 * timers; the component using this can pass `nowMs` to children so
 * their renders stay pure.
 */
function useNowTicker(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => {
      setNow(Date.now())
    }, intervalMs)
    return () => {
      clearInterval(id)
    }
  }, [intervalMs])
  return now
}

/**
 * Compact relative-time label. Falls back to "MMM D" past a week to
 * avoid "37 days ago" looking sloppy. Caller threads `nowMs` so this
 * stays pure.
 */
function formatRelativeTime(thenMs: number, nowMs: number): string {
  const diff = Math.max(0, nowMs - thenMs)
  const sec = Math.floor(diff / 1000)
  if (sec < 45) {
    return 'just now'
  }
  const min = Math.floor(sec / 60)
  if (min < 60) {
    return `${min}m ago`
  }
  const hr = Math.floor(min / 60)
  if (hr < 24) {
    return `${hr}h ago`
  }
  const day = Math.floor(hr / 24)
  if (day < 7) {
    return `${day}d ago`
  }
  return new Date(thenMs).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function formatAmount(raw: bigint, decimals: number): string {
  // Display two decimal places of precision, dropping trailing zeros.
  const divisor = 10n ** BigInt(decimals)
  const whole = raw / divisor
  const fraction = raw % divisor
  const fractionStr = fraction.toString().padStart(decimals, '0').slice(0, 2)
  // Strip trailing zeros from the 2-char fraction
  const trimmed = fractionStr.replace(/0+$/, '')
  return trimmed.length > 0 ? `${whole}.${trimmed}` : whole.toString()
}
