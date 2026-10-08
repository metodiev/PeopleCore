import { forwardRef, type InputHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { cn } from '../../lib/utils.js';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => <input ref={ref} className={cn('input', className)} {...props} />,
);
Input.displayName = 'Input';

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, rows = 3, ...props }, ref) => (
    <textarea ref={ref} rows={rows} className={cn('input h-auto py-2', className)} {...props} />
  ),
);
Textarea.displayName = 'Textarea';

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, children, ...props }, ref) => (
    <select ref={ref} className={cn('input pr-8', className)} {...props}>
      {children}
    </select>
  ),
);
Select.displayName = 'Select';

export function Field(props: { label: string; htmlFor?: string; error?: string | null; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="label" htmlFor={props.htmlFor}>
        {props.label}
      </label>
      {props.children}
      {props.hint && !props.error ? <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{props.hint}</p> : null}
      {props.error ? <p className="mt-1 text-xs text-rose-600 dark:text-rose-400">{props.error}</p> : null}
    </div>
  );
}
