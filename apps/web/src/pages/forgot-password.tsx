import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { z } from 'zod';
import { api } from '../lib/api.js';
import { AuthLayout } from '../components/feature/auth-layout.js';
import { apiErrorMessage } from '../components/feature/query.js';
import { emailField } from '../components/feature/schemas.js';
import { Button } from '../components/ui/button.js';
import { Field, Input } from '../components/ui/input.js';

export function ForgotPasswordPage() {
  const { t } = useTranslation();
  const schema = z.object({
    email: emailField(t),
    tenantSlug: z.string().max(64).optional(),
  });
  type FormValues = z.infer<typeof schema>;
  const form = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { email: '', tenantSlug: '' } });

  const request = useMutation({
    mutationFn: (values: FormValues) =>
      api.post('/auth/forgot-password', {
        email: values.email,
        tenantSlug: values.tenantSlug || undefined,
      }),
    onError: (error) => toast.error(apiErrorMessage(error) ?? t('common.error')),
  });

  const onSubmit = form.handleSubmit(async (values) => {
    await request.mutateAsync(values);
  });

  return (
    <AuthLayout
      title={t('auth.forgotTitle')}
      subtitle={t('auth.forgotSubtitle')}
      footer={
        <Link to="/login" className="font-medium text-brand-600 hover:underline dark:text-brand-400">
          {t('auth.backToSignIn')}
        </Link>
      }
    >
      {request.isSuccess ? (
        <div className="space-y-3 text-sm text-slate-600 dark:text-slate-300">
          <p className="rounded-lg bg-emerald-50 px-3 py-2 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
            {t('auth.forgotSent')}
          </p>
          <p>{t('auth.forgotSentHint')}</p>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <Field label={t('auth.email')} htmlFor="forgot-email" error={form.formState.errors.email?.message}>
            <Input id="forgot-email" type="email" autoComplete="email" {...form.register('email')} />
          </Field>
          <Field label={t('auth.companySlug')} htmlFor="forgot-slug" hint={t('auth.companySlugHint')}>
            <Input id="forgot-slug" {...form.register('tenantSlug')} />
          </Field>
          <Button type="submit" className="w-full" loading={request.isPending}>
            {t('auth.sendResetLink')}
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
