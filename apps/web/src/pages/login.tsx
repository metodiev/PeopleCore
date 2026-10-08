import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { z } from 'zod';
import { api } from '../lib/api.js';
import { useAuth } from '../store/auth.js';
import { AuthLayout } from '../components/feature/auth-layout.js';
import { apiErrorMessage } from '../components/feature/query.js';
import { emailField } from '../components/feature/schemas.js';
import { Button } from '../components/ui/button.js';
import { Field, Input } from '../components/ui/input.js';
import { Tooltip } from '../components/ui/misc.js';

interface OAuthStatus {
  provider: string;
  configured: boolean;
}

export function LoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const login = useAuth((state) => state.login);
  const state = location.state as { from?: string; invited?: boolean } | null;

  const schema = z.object({
    email: emailField(t),
    password: z.string().min(1, t('common.required')),
    tenantSlug: z.string().max(64).optional(),
  });
  type FormValues = z.infer<typeof schema>;

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: '', password: '', tenantSlug: '' },
  });

  const google = useQuery({
    queryKey: ['oauth-status', 'google'],
    queryFn: () => api.get<OAuthStatus>('/auth/oauth/google/status'),
    staleTime: 5 * 60_000,
  });
  const microsoft = useQuery({
    queryKey: ['oauth-status', 'microsoft'],
    queryFn: () => api.get<OAuthStatus>('/auth/oauth/microsoft/status'),
    staleTime: 5 * 60_000,
  });

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const result = await login(values.email, values.password, values.tenantSlug || undefined);
      if (result.mfaRequired && result.mfaToken) {
        sessionStorage.setItem('peoplecore.mfaToken', result.mfaToken);
        navigate('/mfa', { state: { from: state?.from } });
        return;
      }
      navigate(state?.from ?? '/', { replace: true });
    } catch (error) {
      const message = apiErrorMessage(error) ?? t('auth.loginFailed');
      form.setError('root', { message });
      toast.error(message);
    }
  });

  const startOAuth = (provider: 'google' | 'microsoft') => {
    const params = new URLSearchParams();
    const slug = form.getValues('tenantSlug');
    if (slug) params.set('tenantSlug', slug);
    if (state?.from) params.set('redirectTo', state.from);
    window.location.assign(`/api/v1/auth/oauth/${provider}/start?${params.toString()}`);
  };

  const oauthButton = (provider: 'google' | 'microsoft', label: string, configured: boolean | undefined, loading: boolean) => (
    <Tooltip label={configured ? label : t('auth.oauthNotConfigured', { provider: label })}>
      <span className="inline-flex w-full">
        <Button
          type="button"
          variant="outline"
          className="w-full"
          disabled={!configured || loading}
          onClick={() => startOAuth(provider)}
        >
          <span aria-hidden className="text-xs font-semibold uppercase text-slate-400">
            {provider === 'google' ? 'G' : 'MS'}
          </span>
          {label}
        </Button>
      </span>
    </Tooltip>
  );

  return (
    <AuthLayout
      title={t('auth.signInTitle')}
      subtitle={t('auth.signInSubtitle')}
      footer={
        <Link to="/forgot-password" className="font-medium text-brand-600 hover:underline dark:text-brand-400">
          {t('auth.forgot')}
        </Link>
      }
    >
      {state?.invited ? (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
          {t('auth.invitationAccepted')}
        </p>
      ) : null}
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <Field label={t('auth.email')} htmlFor="login-email" error={form.formState.errors.email?.message}>
          <Input id="login-email" type="email" autoComplete="email" {...form.register('email')} />
        </Field>
        <Field label={t('auth.password')} htmlFor="login-password" error={form.formState.errors.password?.message}>
          <Input id="login-password" type="password" autoComplete="current-password" {...form.register('password')} />
        </Field>
        <Field label={t('auth.companySlug')} htmlFor="login-slug" hint={t('auth.companySlugHint')} error={form.formState.errors.tenantSlug?.message}>
          <Input id="login-slug" autoComplete="organization" {...form.register('tenantSlug')} />
        </Field>
        {form.formState.errors.root?.message ? (
          <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">
            {form.formState.errors.root.message}
          </p>
        ) : null}
        <Button type="submit" className="w-full" loading={form.formState.isSubmitting}>
          {t('auth.signIn')}
        </Button>
      </form>
      <div className="space-y-2 border-t border-slate-100 pt-4 dark:border-slate-800">
        <p className="text-center text-xs font-medium uppercase tracking-wide text-slate-400">{t('auth.orContinueWith')}</p>
        {oauthButton('google', t('auth.google'), google.data?.configured, google.isPending)}
        {oauthButton('microsoft', t('auth.microsoft'), microsoft.data?.configured, microsoft.isPending)}
      </div>
    </AuthLayout>
  );
}
