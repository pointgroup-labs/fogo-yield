'use client'

import type { Toast, ToastKind } from '@/store/toasts'
import { useToastsStore } from '@/store/toasts'

/**
 * Fixed-position toast stack, bottom-right on desktop / bottom-center
 * on mobile. Mount once at the page root.
 */
export default function ToastHost() {
  const toasts = useToastsStore(s => s.toasts)
  const dismiss = useToastsStore(s => s.dismiss)

  if (toasts.length === 0) {
    return null
  }
  return (
    <div
      role="region"
      aria-label="Notifications"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-2 px-4 pb-4 sm:px-6"
    >
      {toasts.map(toast => (
        <ToastItem key={toast.id} toast={toast} onDismiss={() => dismiss(toast.id)} />
      ))}
    </div>
  )
}

const KIND_CLASS: Record<ToastKind, string> = {
  pending: 'border-neutral-700 bg-neutral-900 text-neutral-100',
  success: 'border-emerald-700/60 bg-emerald-950/80 text-emerald-100',
  error: 'border-red-700/60 bg-red-950/80 text-red-100',
  info: 'border-neutral-700 bg-neutral-900 text-neutral-100',
}

function ToastItem({ toast, onDismiss }: { toast: Toast, onDismiss: () => void }) {
  return (
    <div
      role={toast.kind === 'error' ? 'alert' : 'status'}
      className={`pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-lg border px-4 py-3 text-sm shadow-lg backdrop-blur ${KIND_CLASS[toast.kind]}`}
    >
      <KindIcon kind={toast.kind} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="font-medium">{toast.title}</span>
        {toast.description && (
          <span className="text-xs opacity-80 break-words">{toast.description}</span>
        )}
        {toast.href && (
          <a
            href={toast.href}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 text-xs underline decoration-dotted underline-offset-2 hover:opacity-100 opacity-90"
          >
            View on explorer →
          </a>
        )}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss notification"
        className="-mr-1 rounded p-0.5 opacity-60 hover:opacity-100"
      >
        ×
      </button>
    </div>
  )
}

function KindIcon({ kind }: { kind: ToastKind }) {
  if (kind === 'pending') {
    return (
      <svg className="mt-0.5 h-4 w-4 shrink-0 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <circle cx="12" cy="12" r="10" opacity="0.25" />
        <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" />
      </svg>
    )
  }
  if (kind === 'success') {
    return (
      <svg className="mt-0.5 h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <polyline points="20 6 9 17 4 12" />
      </svg>
    )
  }
  if (kind === 'error') {
    return (
      <svg className="mt-0.5 h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
    )
  }
  return (
    <svg className="mt-0.5 h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  )
}
