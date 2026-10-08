import * as PopoverPrimitive from '@radix-ui/react-popover';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, CheckCheck, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { api, ApiError, type Paginated } from '../lib/api.js';
import { cn, formatDateTime } from '../lib/utils.js';
import { Button } from './ui/button.js';
import { EmptyState, ErrorState } from './ui/feedback.js';

export interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string;
  channel: string;
  data: unknown;
  readAt: string | null;
  createdAt: string;
}

const NOTIFICATIONS_KEY = ['notifications'] as const;

function routeFor(item: NotificationItem): string | null {
  if (item.data && typeof item.data === 'object') {
    const route = (item.data as Record<string, unknown>)['route'];
    if (typeof route === 'string') return route;
  }
  if (item.type.startsWith('leave')) return '/leave';
  if (item.type.startsWith('attendance')) return '/attendance';
  if (item.type.startsWith('expense')) return '/expenses';
  if (item.type.startsWith('document')) return '/documents';
  if (item.type.startsWith('training')) return '/training';
  if (item.type.startsWith('request')) return '/requests';
  if (item.type.startsWith('performance') || item.type.startsWith('goal')) return '/performance';
  return null;
}

export function NotificationBell({ unreadCount }: { unreadCount: number }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const list = useQuery({
    queryKey: [...NOTIFICATIONS_KEY, 'panel'],
    queryFn: () => api.get<Paginated<NotificationItem>>('/notifications', { query: { pageSize: 20 } }),
    staleTime: 15_000,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_KEY });
  };

  const markRead = useMutation({
    mutationFn: (id: string) => api.post(`/notifications/${id}/read`),
    onSuccess: invalidate,
    onError: (error) => toast.error(error instanceof ApiError ? error.message : t('common.error')),
  });

  const markAll = useMutation({
    mutationFn: () => api.post('/notifications/read-all'),
    onSuccess: () => {
      invalidate();
      toast.success(t('notifications.allRead'));
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : t('common.error')),
  });

  const open = (item: NotificationItem) => {
    if (!item.readAt) markRead.mutate(item.id);
    const route = routeFor(item);
    if (route) navigate(route);
  };

  return (
    <PopoverPrimitive.Root>
      <PopoverPrimitive.Trigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label={t('notifications.title')}>
          <Bell className="size-4" />
          {unreadCount > 0 ? (
            <span
              className="absolute -right-0.5 -top-0.5 grid min-w-4 place-items-center rounded-full bg-rose-600 px-1 text-[10px] font-semibold leading-4 text-white"
              aria-label={t('notifications.unreadCount', { count: unreadCount })}
            >
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          ) : null}
        </Button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="end"
          sideOffset={8}
          className="z-50 w-[min(92vw,24rem)] rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-800 dark:bg-slate-900"
        >
          <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-3 dark:border-slate-800">
            <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{t('notifications.title')}</p>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => markAll.mutate()}
              loading={markAll.isPending}
              disabled={(list.data?.data ?? []).every((item) => item.readAt !== null) && (list.data?.data ?? []).length > 0}
            >
              <CheckCheck className="size-3.5" aria-hidden />
              {t('notifications.markAllRead')}
            </Button>
          </div>
          <div className="max-h-96 overflow-y-auto">
            {list.isPending ? (
              <div className="flex justify-center py-8">
                <Loader2 className="size-5 animate-spin text-brand-600" aria-label={t('common.loading')} />
              </div>
            ) : list.isError ? (
              <ErrorState message={t('common.error')} onRetry={() => void list.refetch()} />
            ) : (list.data?.data ?? []).length === 0 ? (
              <EmptyState title={t('notifications.empty')} description={t('notifications.emptyHint')} />
            ) : (
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {(list.data?.data ?? []).map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => open(item)}
                      className={cn(
                        'flex w-full flex-col gap-1 px-4 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800/60',
                        !item.readAt && 'bg-brand-50/50 dark:bg-brand-900/10',
                      )}
                    >
                      <span className="flex items-center gap-2">
                        {!item.readAt ? <span className="size-2 shrink-0 rounded-full bg-brand-600" aria-hidden /> : null}
                        <span className="text-sm font-medium text-slate-900 dark:text-slate-100">{item.title}</span>
                      </span>
                      <span className="line-clamp-2 text-xs text-slate-600 dark:text-slate-300">{item.body}</span>
                      <span className="text-[11px] text-slate-400">{formatDateTime(item.createdAt)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="border-t border-slate-100 px-4 py-2 text-right dark:border-slate-800">
            <button
              type="button"
              className="text-xs font-medium text-brand-600 hover:underline dark:text-brand-400"
              onClick={() => navigate('/profile')}
            >
              {t('notifications.preferences')}
            </button>
          </div>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
