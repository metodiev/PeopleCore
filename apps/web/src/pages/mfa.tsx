import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { z } from 'zod';
import { useAuth } from '../store/auth.js';
import { AuthLayout } from '../components/feature/auth-layout.js';
import { apiErrorMessage } from '../components/feature/query.js';
import { Button } from '../components/ui/button.js';
import { Field, Input } from '../components/ui/input.js';

const MFA_TOKEN_KEY = 'peoplecore.mfaToken';

export function MfaPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const completeMfa = useAuth((state) => state.completeMfa);
  const [recoveryMode, setRecoveryMode] = useState(false);
  const [token] = useState(() => {
    const fromState = (location.state as { mfaToken?: string } | null)?.mfaToken;
    return fromState ?? sessionStorage.getItem(MFA_TOKEN_KEY) ?? '';
  });

  const schema = z.object({
    code: z.string().min(6, t('auth.codeLength')).max(20, t('auth.codeLength')),
  });
  type FormValues = z.infer<typeof schema>;

  const form = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { code: '' } });

  useEffect(() => {
    if (!token) navigate('/login', { replace: true });
  }, [token, navigate]);

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await completeMfa(token, values.code.trim());
      sessionStorage.removeItem(MFA_TOKEN_KEY);
      const from = (location.state as { from?: string } | null)?.from;
      navigate(from ?? '/', { replace: true });
    } catch (error) {
      const message = apiErrorMessage(error) ?? t('auth.mfaFailed');
      form.setError('root', { message });
      toast.error(message);
    }
  });

  return (
    <AuthLayout
      title={t('auth.mfaTitle')}
      subtitle={recoveryMode ? t('auth.recoverySubtitle') : t('auth.mfaSubtitle')}
      footer={
        <button type="button" className="font-medium text-brand-600 hover:underline dark:text-brand-400" onClick={() => setRecoveryMode((current) => !current)}>
          {recoveryMode ? t('auth.useAuthenticator') : t('auth.useRecoveryCode')}
        </button>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <Field
          label={recoveryMode ? t('auth.recoveryCode') : t('auth.mfaCode')}
          htmlFor="mfa-code"
          hint={recoveryMode ? t('auth.recoveryHint') : undefined}
          error={form.formState.errors.code?.message}
        >
          <Input
            id="mfa-code"
            inputMode="text"
            autoComplete="one-time-code"
            autoFocus
            placeholder={recoveryMode ? 'XXXX-XXXX' : '123456'}
            {...form.register('code')}
          />
        </Field>
        {form.formState.errors.root?.message ? (
          <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">
            {form.formState.errors.root.message}
          </p>
        ) : null}
        <Button type="submit" className="w-full" loading={form.formState.isSubmitting}>
          {t('auth.verify')}
        </Button>
      </form>
      <p className="text-center text-sm text-slate-500 dark:text-slate-400">
        <Link to="/login" className="font-medium text-brand-600 hover:underline dark:text-brand-400">
          {t('auth.backToSignIn')}
        </Link>
      </p>
    </AuthLayout>
  );
}
