import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, type ReactNode } from 'react';
import { useForm, type DefaultValues, type FieldValues, type Resolver, type UseFormReturn } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { z } from 'zod';
import { apiErrorMessage } from './query.js';
import { Button } from '../ui/button.js';
import { Dialog, DialogContent } from '../ui/dialog.js';
import { Field } from '../ui/input.js';

export interface FormDialogProps<TValues extends FieldValues> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  /**
   * Validation schema for the form. The input side is intentionally loose so
   * schemas that preprocess/coerce values (e.g. empty optional numbers) can be
   * used without matching the exact form value type.
   */
  schema: z.ZodType<TValues, any>;
  defaultValues: TValues;
  onSubmit: (values: TValues) => Promise<unknown>;
  /** Overrides the success toast. */
  successMessage?: string;
  submitLabel?: string;
  className?: string;
  children: (form: UseFormReturn<TValues>) => ReactNode;
}

/**
 * Dialog + react-hook-form + zod + mutation feedback. Field-level errors come
 * from the schema; API errors (`ApiError`) are surfaced as a toast and on the
 * form root so the user always sees the server message.
 */
export function FormDialog<TValues extends FieldValues>(props: FormDialogProps<TValues>) {
  const { t } = useTranslation();
  const form = useForm<TValues, unknown, TValues>({
    resolver: zodResolver(props.schema) as Resolver<TValues, unknown, TValues>,
    // react-hook-form models defaults as a deep partial; our defaults are complete values.
    defaultValues: props.defaultValues as DefaultValues<TValues>,
  });

  useEffect(() => {
    if (props.open) form.reset(props.defaultValues as DefaultValues<TValues>);
  }, [props.open, props.defaultValues, form]);

  const submit = form.handleSubmit(async (values) => {
    try {
      await props.onSubmit(values);
      toast.success(props.successMessage ?? t('common.saved'));
      props.onOpenChange(false);
    } catch (error) {
      const message = apiErrorMessage(error) ?? t('common.error');
      form.setError('root', { message });
      toast.error(message);
    }
  });

  const rootError = form.formState.errors.root?.message;

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent title={props.title} description={props.description} className={props.className}>
        <form onSubmit={submit} className="space-y-4" noValidate>
          {props.children(form)}
          {rootError ? (
            <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">
              {rootError}
            </p>
          ) : null}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => props.onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" loading={form.formState.isSubmitting}>
              {props.submitLabel ?? t('common.save')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Labelled field wired to a react-hook-form field, with error presentation. */
export function FormField(props: { label: string; htmlFor?: string; error?: string; hint?: string; children: ReactNode }) {
  return (
    <Field label={props.label} htmlFor={props.htmlFor} error={props.error} hint={props.hint}>
      {props.children}
    </Field>
  );
}
