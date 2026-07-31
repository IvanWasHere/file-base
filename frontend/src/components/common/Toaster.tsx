import { CircleAlert, CircleCheck, Info, Loader2, X } from 'lucide-react'
import { useToastStore, type Toast, type ToastTone } from '@/stores/toastStore'

/**
 * The toast surface for operation results (PLAN.md M6).
 *
 * Bottom-right, above the status bar, so it never covers the breadcrumb or the
 * row the user just acted on.
 */

const ICONS: Record<ToastTone, typeof Info> = {
  info: Info,
  success: CircleCheck,
  error: CircleAlert,
  progress: Loader2,
}

const TONE_CLASS: Record<ToastTone, string> = {
  info: 'text-accent',
  success: 'text-[var(--success,var(--accent))]',
  error: 'text-[var(--danger)]',
  progress: 'text-muted',
}

function ToastRow({ toast }: { toast: Toast }) {
  const dismiss = useToastStore((state) => state.dismiss)
  const Icon = ICONS[toast.tone]

  return (
    <div
      className="bg-elevated border-edge flex w-[320px] items-start gap-2.5 rounded-lg border p-3 shadow-lg"
      // Errors are announced assertively; progress and success should not
      // interrupt whatever the screen reader is currently saying.
      role={toast.tone === 'error' ? 'alert' : 'status'}
    >
      <Icon
        size={15}
        className={`mt-px shrink-0 ${TONE_CLASS[toast.tone]} ${
          toast.tone === 'progress' ? 'animate-spin' : ''
        }`}
      />

      <div className="min-w-0 flex-1">
        <p className="text-primary text-[13px] leading-snug">{toast.message}</p>
        {toast.detail && <p className="text-muted mt-0.5 text-xs leading-snug">{toast.detail}</p>}
        {toast.action && (
          <button
            type="button"
            onClick={() => {
              toast.action?.run()
              dismiss(toast.id)
            }}
            className="text-accent hover:text-primary mt-1.5 text-xs font-medium transition-colors"
          >
            {toast.action.label}
          </button>
        )}
      </div>

      {toast.tone !== 'progress' && (
        <button
          type="button"
          aria-label="Dismiss"
          onClick={() => dismiss(toast.id)}
          className="text-muted hover:text-primary shrink-0 transition-colors"
        >
          <X size={13} />
        </button>
      )}
    </div>
  )
}

export function Toaster() {
  const toasts = useToastStore((state) => state.toasts)
  if (toasts.length === 0) return null

  return (
    <div
      aria-label="Notifications"
      className="pointer-events-none fixed right-4 bottom-10 z-50 flex flex-col gap-2"
    >
      {toasts.map((toast) => (
        <div key={toast.id} className="pointer-events-auto">
          <ToastRow toast={toast} />
        </div>
      ))}
    </div>
  )
}
