import { useMutation } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { AuthLayout } from '../components/feature/auth-layout.js';
import { apiErrorMessage } from '../components/feature/query.js';
import { Button } from '../components/ui/button.js';
import { ErrorState, Spinner } from '../components/ui/feedback.js';

export function VerifyEmailPage() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const started = useRef(false);

  const verify = useMutation({
    mutationFn: () => api.post('/auth/verify-email', { token }),
  });

  useEffect(() => {
    if (token && !started.current) {
      started.current = true;
      verify.mutate();
    }
  }, [token, verify]);

  return (
    <AuthLayout
      title={t('auth.verifyEmailTitle')}
      subtitle={t('auth.verifyEmailSubtitle')}
      footer={
        <Link to="/login" className="font-medium text-brand-600 hover:underline dark:text-brand-400">
          {t('auth.backToSignIn')}
        </Link>
      }
    >
      {!token ? (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
          {t('auth.missingToken')}
        </p>
      ) : verify.isPending ? (
        <div className="flex flex-col items-center gap-3 py-6">
          <Spinner />
          <p className="text-sm text-slate-500 dark:text-slate-400">{t('auth.verifying')}</p>
        </div>
      ) : verify.isError ? (
        <ErrorState message={apiErrorMessage(verify.error) ?? t('common.error')} onRetry={() => verify.mutate()} />
      ) : verify.isSuccess ? (
        <div className="space-y-3 text-center">
          <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
            {t('auth.verifyEmailDone')}
          </p>
          <Link to="/" className="block text-sm font-medium text-brand-600 hover:underline dark:text-brand-400">
            {t('nav.dashboard')}
          </Link>
        </div>
      ) : (
        <Button className="w-full" onClick={() => verify.mutate()}>
          {t('auth.verify')}
        </Button>
      )}
    </AuthLayout>
  );
}
