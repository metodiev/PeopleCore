import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { z } from 'zod';
import { api } from '../lib/api.js';
import { AuthLayout } from '../components/feature/auth-layout.js';
import { apiErrorMessage } from '../components/feature/query.js';
import { passwordField } from '../components/feature/schemas.js';
import { Button } from '../components/ui/button.js';
import { EmptyState } from '../components/ui/feedback.js';
import { Field, Input } from '../components/ui/input.js';

export function ResetPasswordPage() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';

  const schema = z
    .object({
      password: passwordField(t),
      confirm: z.string().min(1, t('common.required')),
    })
    .refine((values) => values.password === values.confirm, {
      path: ['confirm'],
      message: t('auth.passwordMismatch'),
    });
  type FormValues = z.infer<typeof schema>;
  const form = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { password: '', confirm: '' } });

  const reset = useMutation({
    mutationFn: (values: FormValues) => api.post('/auth/reset-password', { token, password: values.password }),
    onError: (error) => toast.error(apiErrorMessage(error) ?? t('common.error')),
  });

  const onSubmit = form.handleSubmit(async (values) => {
    await reset.mutateAsync(values);
  });

  return (
    <AuthLayout
      title={t('auth.resetTitle')}
      subtitle={t('auth.resetSubtitle')}
      footer={
        <Link to="/login" className="font-medium text-brand-600 hover:underline dark:text-brand-400">
          {t('auth.backToSignIn')}
        </Link>
      }
    >
      {!token ? (
        <EmptyState title={t('auth.invalidToken')} description={t('auth.invalidTokenHint')} />
      ) : reset.isSuccess ? (
        <div className="space-y-3">
          <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
            {t('auth.resetDone')}
          </p>
          <Link to="/login" className="block text-center text-sm font-medium text-brand-600 hover:underline dark:text-brand-400">
            {t('auth.signIn')}
          </Link>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <Field label={t('auth.newPassword')} htmlFor="reset-password" error={form.formState.errors.password?.message} hint={t('auth.passwordHint')}>
            <Input id="reset-password" type="password" autoComplete="new-password" {...form.register('password')} />
          </Field>
          <Field label={t('auth.confirmPassword')} htmlFor="reset-confirm" error={form.formState.errors.confirm?.message}>
            <Input id="reset-confirm" type="password" autoComplete="new-password" {...form.register('confirm')} />
          </Field>
          <Button type="submit" className="w-full" loading={reset.isPending}>
            {t('auth.resetPassword')}
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
