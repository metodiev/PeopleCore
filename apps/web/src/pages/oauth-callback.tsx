import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../store/auth.js';
import { AuthLayout } from '../components/feature/auth-layout.js';
import { apiErrorMessage } from '../components/feature/query.js';
import { Button } from '../components/ui/button.js';
import { Spinner } from '../components/ui/feedback.js';

export function OAuthCallbackPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const acceptOAuthToken = useAuth((state) => state.acceptOAuthToken);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  const token = params.get('token') ?? '';
  const redirectTo = params.get('redirectTo') ?? '/';
  const providerError = params.get('error');

  useEffect(() => {
    if (providerError) {
      setError(providerError);
      return;
    }
    if (!token) {
      setError('missing_token');
      return;
    }
    if (started.current) return;
    started.current = true;
    void (async () => {
      try {
        await acceptOAuthToken(token);
        navigate(redirectTo.startsWith('/') ? redirectTo : '/', { replace: true });
      } catch (caught) {
        setError(apiErrorMessage(caught) ?? 'exchange_failed');
      }
    })();
  }, [token, redirectTo, providerError, acceptOAuthToken, navigate]);

  return (
    <AuthLayout title={t('auth.callbackTitle')} subtitle={t('auth.callbackSubtitle')}>
      {error ? (
        <div className="space-y-4">
          <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">
            {error === 'missing_token' ? t('auth.callbackMissingToken') : t('auth.callbackFailed', { reason: error })}
          </p>
          <Button className="w-full" onClick={() => navigate('/login', { replace: true })}>
            {t('auth.backToSignIn')}
          </Button>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3 py-6">
          <Spinner />
          <p className="text-sm text-slate-500 dark:text-slate-400">{t('auth.callbackWorking')}</p>
          <Link to="/login" className="text-xs text-slate-400 hover:underline">
            {t('auth.backToSignIn')}
          </Link>
        </div>
      )}
    </AuthLayout>
  );
}
