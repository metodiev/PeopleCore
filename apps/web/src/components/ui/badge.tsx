import { cva, type VariantProps } from 'class-variance-authority';
import type { HTMLAttributes } from 'react';
import { cn } from '../../lib/utils.js';

const badgeVariants = cva('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium', {
  variants: {
    tone: {
      neutral: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
      brand: 'bg-brand-50 text-brand-700 dark:bg-brand-900/40 dark:text-brand-200',
      success: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
      warning: 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
      danger: 'bg-rose-50 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300',
      info: 'bg-sky-50 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300',
    },
  },
  defaultVariants: { tone: 'neutral' },
});

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}

/** Maps domain statuses to a consistent colour across the product. */
export function statusTone(status: string): BadgeProps['tone'] {
  const value = status.toUpperCase();
  if (['APPROVED', 'ACTIVE', 'COMPLETED', 'PRESENT', 'CONNECTED', 'ACKNOWLEDGED', 'RESOLVED', 'VALID', 'REIMBURSED'].includes(value)) return 'success';
  if (['PENDING', 'IN_PROGRESS', 'SUBMITTED', 'PROBATION', 'ON_TRACK', 'TENTATIVE', 'CHANGES_REQUESTED', 'INVITED', 'TRIAL', 'EXPIRING', 'WAITING_EMPLOYEE', 'ASSIGNED'].includes(value)) return 'warning';
  if (['REJECTED', 'TERMINATED', 'CANCELLED', 'EXPIRED', 'ABSENT', 'ERROR', 'OVERDUE', 'LOST', 'SUSPENDED', 'OFF_TRACK', 'AT_RISK', 'FAILED', 'REVOKED'].includes(value)) return 'danger';
  if (['REMOTE', 'LEAVE', 'HOLIDAY', 'DRAFT', 'DISCONNECTED', 'ARCHIVED', 'CLOSED'].includes(value)) return 'info';
  return 'neutral';
}
