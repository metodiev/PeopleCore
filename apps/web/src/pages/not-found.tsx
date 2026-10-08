import { Home, SearchX } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Card, CardContent } from '../components/ui/card.js';

export function NotFoundPage() {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <Card className="w-full max-w-md">
        <CardContent className="flex flex-col items-center gap-4 py-10 text-center">
          <div className="rounded-full bg-slate-100 p-3 text-slate-500 dark:bg-slate-800 dark:text-slate-400">
            <SearchX className="size-6" aria-hidden />
          </div>
          <div>
            <p className="text-3xl font-semibold text-slate-900 dark:text-slate-50">404</p>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t('notFound.message')}</p>
          </div>
          <Link
            to="/"
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-brand-600 px-4 text-sm font-medium text-white hover:bg-brand-700"
          >
            <Home className="size-4" aria-hidden />
            {t('notFound.backHome')}
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
