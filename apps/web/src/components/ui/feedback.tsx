import { AlertTriangle, Inbox, Loader2, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../../lib/utils.js';

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('size-5 animate-spin text-brand-600', className)} aria-label="Loading" />;
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton h-4 w-full', className)} />;
}

export function TableSkeleton({ rows = 5, columns = 5 }: { rows?: number; columns?: number }) {
  return (
    <div className="space-y-3 p-5">
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <div key={rowIndex} className="grid gap-4" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
          {Array.from({ length: columns }).map((__, columnIndex) => (
            <Skeleton key={columnIndex} className="h-5" />
          ))}
        </div>
      ))}
    </div>
  );
}

export function EmptyState(props: { icon?: LucideIcon; title: string; description?: string; action?: ReactNode }) {
  const Icon = props.icon ?? Inbox;
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
      <div className="rounded-full bg-slate-100 p-3 text-slate-500 dark:bg-slate-800 dark:text-slate-400">
        <Icon className="size-6" />
      </div>
      <div>
        <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{props.title}</p>
        {props.description ? <p className="mt-1 max-w-md text-sm text-slate-500 dark:text-slate-400">{props.description}</p> : null}
      </div>
      {props.action}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-12 text-center">
      <div className="rounded-full bg-rose-50 p-3 text-rose-600 dark:bg-rose-900/30 dark:text-rose-300">
        <AlertTriangle className="size-6" />
      </div>
      <p className="text-sm text-slate-700 dark:text-slate-200">{message}</p>
      {onRetry ? (
        <button type="button" onClick={onRetry} className="text-sm font-medium text-brand-600 hover:underline dark:text-brand-400">
          Try again
        </button>
      ) : null}
    </div>
  );
}
