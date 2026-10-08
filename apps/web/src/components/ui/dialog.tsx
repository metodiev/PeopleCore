import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../../lib/utils.js';

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent(props: { children: ReactNode; className?: string; title?: string; description?: string }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-slate-900/50 backdrop-blur-sm" />
      <DialogPrimitive.Content
        className={cn(
          'fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[min(96vw,42rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900',
          props.className,
        )}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            {props.title ? (
              <DialogPrimitive.Title className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                {props.title}
              </DialogPrimitive.Title>
            ) : null}
            {props.description ? (
              <DialogPrimitive.Description className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                {props.description}
              </DialogPrimitive.Description>
            ) : null}
          </div>
          <DialogPrimitive.Close className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800">
            <X className="size-4" />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        </div>
        {props.children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function ConfirmDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  confirmLabel?: string;
  destructive?: boolean;
  onConfirm: () => void | Promise<void>;
  loading?: boolean;
}) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent title={props.title} description={props.description}>
        <div className="flex justify-end gap-2">
          <DialogPrimitive.Close className="inline-flex h-10 items-center rounded-lg border border-slate-300 px-4 text-sm font-medium hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800">
            Cancel
          </DialogPrimitive.Close>
          <button
            type="button"
            onClick={() => void props.onConfirm()}
            disabled={props.loading}
            className={cn(
              'inline-flex h-10 items-center rounded-lg px-4 text-sm font-medium text-white disabled:opacity-50',
              props.destructive ? 'bg-rose-600 hover:bg-rose-700' : 'bg-brand-600 hover:bg-brand-700',
            )}
          >
            {props.confirmLabel ?? 'Confirm'}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
