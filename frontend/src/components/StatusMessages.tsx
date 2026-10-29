import type { ReactNode } from 'react'
import { AlertIcon } from './icons'

export function Spinner({ label }: { label: string }) {
  return (
    <div role="status" className="flex items-center justify-center gap-3 py-10 text-muted">
      <span
        className="size-5 rounded-full border-2 border-brand-200 border-t-brand-600 motion-safe:animate-spin"
        aria-hidden="true"
      />
      <span>{label}</span>
    </div>
  )
}

interface ErrorStateProps {
  title: string
  message: string
  onRetry?: () => void
  children?: ReactNode
}

export function ErrorState({ title, message, onRetry, children }: ErrorStateProps) {
  return (
    <div
      role="alert"
      className="rounded-2xl border border-danger-700/20 bg-danger-50 p-5 text-center sm:p-6"
    >
      <AlertIcon className="mx-auto size-7 text-danger-700" />
      <h2 className="mt-2 font-semibold text-ink">{title}</h2>
      <p className="mt-1 text-sm text-muted">{message}</p>
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        {onRetry && (
          <button type="button" onClick={onRetry} className="btn-secondary">
            Try again
          </button>
        )}
        {children}
      </div>
    </div>
  )
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-line bg-surface p-6 text-center">
      <h2 className="font-semibold">{title}</h2>
      {children && <div className="mt-1 text-sm text-muted">{children}</div>}
    </div>
  )
}
