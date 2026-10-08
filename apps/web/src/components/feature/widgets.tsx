import { Search } from 'lucide-react';
import { useEffect, useMemo, useState, type KeyboardEvent, type ReactNode } from 'react';import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils.js';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card.js';
import { TableRow } from '../ui/table.js';
import { Tooltip } from '../ui/misc.js';
import { Button, type ButtonProps } from '../ui/button.js';
import { EmptyState } from '../ui/feedback.js';

/** Debounces a rapidly changing value (search inputs, filters). */
export function useDebouncedValue<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

export function SearchInput(props: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  label?: string;
  className?: string;
  onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void;
  autoFocus?: boolean;
}) {
  const { t } = useTranslation();
  const label = props.label ?? t('common.search');
  return (
    <div className={cn('relative', props.className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden />
      <input
        type="search"
        aria-label={label}
        placeholder={props.placeholder ?? label}
        value={props.value}
        autoFocus={props.autoFocus}
        onChange={(event) => props.onChange(event.target.value)}
        onKeyDown={props.onKeyDown}
        className="input pl-9"
      />
    </div>
  );
}

/** Wraps filter controls and keeps them aligned on small screens. */
export function FilterBar({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center', className)}>{children}</div>;
}

/** Uniform label/value presentation used across detail cards. */
export function DefinitionList({ items, className }: { items: Array<{ label: string; value: ReactNode }>; className?: string }) {
  return (
    <dl className={cn('grid gap-x-6 gap-y-3 sm:grid-cols-2', className)}>
      {items.map((item) => (
        <div key={item.label} className="min-w-0">
          <dt className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{item.label}</dt>
          <dd className="mt-0.5 break-words text-sm text-slate-900 dark:text-slate-100">{item.value ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

export function SectionCard(props: { title?: string; description?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <Card className={props.className}>
      {props.title ? (
        <CardHeader className="flex-row items-center justify-between gap-3">
          <div>
            <CardTitle>{props.title}</CardTitle>
            {props.description ? <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{props.description}</p> : null}
          </div>
          {props.action}
        </CardHeader>
      ) : null}
      <CardContent>{props.children}</CardContent>
    </Card>
  );
}

/** Rendered instead of a section the caller is not allowed to see. */
export function LockedSection({ message }: { message?: string }) {
  const { t } = useTranslation();
  return (
    <EmptyState
      icon={undefined}
      title={t('common.noPermission')}
      description={message ?? t('common.noPermissionHint')}
    />
  );
}

/** Table row that behaves as a button for keyboard users. */
export function ClickableRow(props: { onActivate: () => void; children: ReactNode; className?: string }) {
  const handleKeyDown = (event: KeyboardEvent<HTMLTableRowElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      props.onActivate();
    }
  };
  return (
    <TableRow
      role="button"
      tabIndex={0}
      onClick={props.onActivate}
      onKeyDown={handleKeyDown}
      className={cn('cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-500', props.className)}
    >
      {props.children}
    </TableRow>
  );
}

export function ProgressBar({ value, max = 100, tone = 'brand' }: { value: number; max?: number; tone?: 'brand' | 'success' | 'warning' | 'danger' }) {
  const percent = useMemo(() => {
    if (max <= 0) return 0;
    return Math.min(100, Math.max(0, Math.round((value / max) * 100)));
  }, [value, max]);
  const toneClass = {
    brand: 'bg-brand-500',
    success: 'bg-emerald-500',
    warning: 'bg-amber-500',
    danger: 'bg-rose-500',
  }[tone];
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
      <div className={cn('h-full rounded-full transition-all', toneClass)} style={{ width: `${percent}%` }} />
    </div>
  );
}

/**
 * Button gated by a permission. When the caller lacks the permission the
 * button stays visible but disabled with an explanatory tooltip.
 */
export function PermissionButton(props: ButtonProps & { allowed: boolean; reason?: string }) {
  const { allowed, reason, ...buttonProps } = props;
  const { t } = useTranslation();
  if (allowed) return <Button {...buttonProps} />;
  return (
    <Tooltip label={reason ?? t('common.noPermissionHint')}>
      <span className="inline-flex">
        <Button {...buttonProps} disabled aria-disabled />
      </span>
    </Tooltip>
  );
}
