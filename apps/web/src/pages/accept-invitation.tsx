import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { z } from 'zod';
import { api } from '../lib/api.js';
import { AuthLayout } from '../components/feature/auth-layout.js';
import { apiErrorMessage } from '../components/feature/query.js';
import { passwordField } from '../components/feature/schemas.js';
import { Button } from '../components/ui/button.js';
import { EmptyState } from '../components/ui/feedback.js';
import { Field, Input } from '../components/ui/input.js';

export function AcceptInvitationPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';

  const schema = z
    .object({
      firstName: z.string().min(1, t('common.required')).max(80),
      lastName: z.string().min(1, t('common.required')).max(80),
      password: passwordField(t),
      confirm: z.string().min(1, t('common.required')),
    })
    .refine((values) => values.password === values.confirm, {
      path: ['confirm'],
      message: t('auth.passwordMismatch'),
    });
  type FormValues = z.infer<typeof schema>;
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { firstName: '', lastName: '', password: '', confirm: '' },
  });

  const accept = useMutation({
    mutationFn: (values: FormValues) =>
      api.post('/auth/invitations/accept', {
        token,
        password: values.password,
        firstName: values.firstName,
        lastName: values.lastName,
      }),
    onSuccess: () => {
      toast.success(t('auth.invitationAccepted'));
      navigate('/login', { state: { invited: true }, replace: true });
    },
    onError: (error) => toast.error(apiErrorMessage(error) ?? t('common.error')),
  });

  const onSubmit = form.handleSubmit(async (values) => {
    await accept.mutateAsync(values);
  });

  return (
    <AuthLayout
      title={t('auth.invitationTitle')}
      subtitle={t('auth.invitationSubtitle')}
      footer={
        <Link to="/login" className="font-medium text-brand-600 hover:underline dark:text-brand-400">
          {t('auth.backToSignIn')}
        </Link>
      }
    >
      {!token ? (
        <EmptyState title={t('auth.invalidToken')} description={t('auth.invalidTokenHint')} />
      ) : (
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('auth.firstName')} htmlFor="invite-first" error={form.formState.errors.firstName?.message}>
              <Input id="invite-first" autoComplete="given-name" {...form.register('firstName')} />
            </Field>
            <Field label={t('auth.lastName')} htmlFor="invite-last" error={form.formState.errors.lastName?.message}>
              <Input id="invite-last" autoComplete="family-name" {...form.register('lastName')} />
            </Field>
          </div>
          <Field label={t('auth.newPassword')} htmlFor="invite-password" error={form.formState.errors.password?.message} hint={t('auth.passwordHint')}>
            <Input id="invite-password" type="password" autoComplete="new-password" {...form.register('password')} />
          </Field>
          <Field label={t('auth.confirmPassword')} htmlFor="invite-confirm" error={form.formState.errors.confirm?.message}>
            <Input id="invite-confirm" type="password" autoComplete="new-password" {...form.register('confirm')} />
          </Field>
          <Button type="submit" className="w-full" loading={accept.isPending}>
            {t('auth.acceptInvitation')}
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
