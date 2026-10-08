import * as AvatarPrimitive from '@radix-ui/react-avatar';
import * as SwitchPrimitive from '@radix-ui/react-switch';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { cn, initials } from '../../lib/utils.js';

export function Avatar(props: { firstName?: string | null; lastName?: string | null; src?: string | null; className?: string }) {
  return (
    <AvatarPrimitive.Root
      className={cn(
        'inline-flex size-9 shrink-0 select-none items-center justify-center overflow-hidden rounded-full bg-brand-100 text-sm font-semibold text-brand-700 dark:bg-slate-800 dark:text-brand-200',
        props.className,
      )}
    >
      {props.src ? <AvatarPrimitive.Image src={props.src} alt="" className="size-full object-cover" /> : null}
      <AvatarPrimitive.Fallback>{initials(props.firstName, props.lastName)}</AvatarPrimitive.Fallback>
    </AvatarPrimitive.Root>
  );
}

export function Switch({ checked, onCheckedChange, id }: { checked: boolean; onCheckedChange: (checked: boolean) => void; id?: string }) {
  return (
    <SwitchPrimitive.Root
      id={id}
      checked={checked}
      onCheckedChange={onCheckedChange}
      className="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full bg-slate-300 transition-colors data-[state=checked]:bg-brand-600 dark:bg-slate-700"
    >
      <SwitchPrimitive.Thumb className="block size-5 translate-x-0.5 rounded-full bg-white shadow transition-transform data-[state=checked]:translate-x-[1.4rem]" />
    </SwitchPrimitive.Root>
  );
}

export function TooltipProvider({ children }: { children: React.ReactNode }) {
  return <TooltipPrimitive.Provider delayDuration={200}>{children}</TooltipPrimitive.Provider>;
}

export function Tooltip({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          sideOffset={6}
          className="z-50 rounded-md bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-white shadow-lg dark:bg-slate-700"
        >
          {label}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}

export function PageHeader(props: { title: string; description?: string; actions?: React.ReactNode; breadcrumb?: React.ReactNode }) {
  return (
    <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        {props.breadcrumb ? <div className="mb-1 text-xs text-slate-500 dark:text-slate-400">{props.breadcrumb}</div> : null}
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-50">{props.title}</h1>
        {props.description ? <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{props.description}</p> : null}
      </div>
      {props.actions ? <div className="flex flex-wrap items-center gap-2">{props.actions}</div> : null}
    </header>
  );
}

export function Pagination(props: { page: number; totalPages: number; total: number; onPageChange: (page: number) => void }) {
  return (
    <div className="flex items-center justify-between gap-3 px-5 py-3 text-sm text-slate-600 dark:text-slate-300">
      <span className="tabular-nums">
        {props.total} record{props.total === 1 ? '' : 's'} · page {props.page} of {Math.max(1, props.totalPages)}
      </span>
      <div className="flex gap-2">
        <button
          type="button"
          className="rounded-md border border-slate-300 px-3 py-1 disabled:opacity-40 dark:border-slate-700"
          disabled={props.page <= 1}
          onClick={() => props.onPageChange(props.page - 1)}
        >
          Previous
        </button>
        <button
          type="button"
          className="rounded-md border border-slate-300 px-3 py-1 disabled:opacity-40 dark:border-slate-700"
          disabled={props.page >= props.totalPages}
          onClick={() => props.onPageChange(props.page + 1)}
        >
          Next
        </button>
      </div>
    </div>
  );
}
