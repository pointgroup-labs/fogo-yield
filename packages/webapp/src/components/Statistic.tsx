import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

interface Props {
  label: string
  value: string
  hint?: string
  /**
   * Treat the value as not-yet-real: render a loading skeleton in
   * place of the number. Used when a fallback constant is being
   * shown while the live data source is still in flight; rendering
   * the placeholder as a skeleton (instead of amber-tinted text) is
   * less alarming and matches the Suspense fallback shown elsewhere
   * in the stats strip.
   */
  preview?: boolean
  className?: string
}

export default function Statistic({ label, value, hint, preview, className }: Props) {
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
      {preview && value !== '—'
        ? (
            // Match the height of the rendered value (text-2xl ≈ 2rem
            // line-height) so the card doesn't reflow when the real
            // number replaces the skeleton. Width is approximate;
            // values like "$1.0700" or "$1.23M" land in this range.
            <Skeleton className="h-8 w-24" />
          )
        : (
            <span
              className={cn(
                'text-2xl font-semibold tabular-nums',
                value === '—' && 'text-muted-foreground',
              )}
            >
              {value}
            </span>
          )}
      {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
    </div>
  )
}
