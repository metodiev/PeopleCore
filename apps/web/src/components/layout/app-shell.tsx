import {
  BadgeDollarSign,
  BarChart3,
  Bell,
  Boxes,
  CalendarDays,
  ClipboardList,
  FileText,
  GraduationCap,
  LayoutDashboard,
  LogOut,
  Menu,
  Plug,
  Search,
  Settings,
  Sparkles,
  Target,
  Timer,
  Users,
  X,
} from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { Paginated } from '@peoplecore/shared';
import { api } from '../../lib/api.js';
import { cn } from '../../lib/utils.js';
import { useAuth } from '../../store/auth.js';
import { Avatar, Tooltip } from '../ui/misc.js';
import { Button } from '../ui/button.js';
import { LanguageSwitcher } from '../language-switcher.js';
import { ThemeToggle } from '../theme-toggle.js';
import { GlobalSearch } from '../global-search.js';
import { NotificationBell } from '../notification-bell.js';

interface NavItem {
  to: string;
  labelKey: string;
  icon: typeof LayoutDashboard;
  permission?: string;
}

const NAV_ITEMS: NavItem[] = [
  { to: '/', labelKey: 'nav.dashboard', icon: LayoutDashboard, permission: 'dashboard.view' },
  { to: '/people', labelKey: 'nav.people', icon: Users, permission: 'employees.view' },
  { to: '/calendar', labelKey: 'nav.calendar', icon: CalendarDays, permission: 'calendar.view' },
  { to: '/leave', labelKey: 'nav.leave', icon: Sparkles, permission: 'leave.self.view' },
  { to: '/attendance', labelKey: 'nav.attendance', icon: Timer, permission: 'attendance.self.view' },
  { to: '/requests', labelKey: 'nav.requests', icon: ClipboardList, permission: 'requests.self.view' },
  { to: '/documents', labelKey: 'nav.documents', icon: FileText, permission: 'documents.view' },
  { to: '/performance', labelKey: 'nav.performance', icon: Target, permission: 'performance.self.view' },
  { to: '/training', labelKey: 'nav.training', icon: GraduationCap, permission: 'training.view' },
  { to: '/expenses', labelKey: 'nav.expenses', icon: BadgeDollarSign, permission: 'expenses.self.view' },
  { to: '/assets', labelKey: 'nav.assets', icon: Boxes, permission: 'assets.self.view' },
  { to: '/reports', labelKey: 'nav.reports', icon: BarChart3, permission: 'reports.view' },
  { to: '/integrations', labelKey: 'nav.integrations', icon: Plug, permission: 'integrations.view' },
  { to: '/settings', labelKey: 'nav.settings', icon: Settings, permission: 'settings.view' },
];

export function AppShell() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const user = useAuth((state) => state.user);
  const tenant = useAuth((state) => state.tenant);
  const can = useAuth((state) => state.can);
  const logout = useAuth((state) => state.logout);
  const unread = useQuery({
    queryKey: ['notifications', 'unread-count'],
    queryFn: () => api.get<Paginated<unknown>>('/notifications', { query: { unreadOnly: true, pageSize: 1 } }),
    refetchInterval: 60_000,
  });

  const visibleItems = NAV_ITEMS.filter((item) => !item.permission || can(item.permission));

  return (
    <div className="flex h-full min-h-screen bg-slate-50 dark:bg-slate-950">
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-slate-200 bg-white transition-transform dark:border-slate-800 dark:bg-slate-900 lg:static lg:translate-x-0',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex h-16 items-center justify-between gap-2 border-b border-slate-200 px-4 dark:border-slate-800">
          <button type="button" onClick={() => navigate('/')} className="flex items-center gap-2 text-left">
            <span className="grid size-8 place-items-center rounded-lg bg-brand-600 text-sm font-bold text-white">PC</span>
            <span>
              <span className="block text-sm font-semibold text-slate-900 dark:text-slate-100">{t('app.name')}</span>
              <span className="block text-xs text-slate-500 dark:text-slate-400">{tenant?.name ?? ''}</span>
            </span>
          </button>
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setMobileOpen(false)} aria-label="Close navigation">
            <X className="size-4" />
          </Button>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto p-3" aria-label="Main navigation">
          {visibleItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              onClick={() => setMobileOpen(false)}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800',
                  isActive && 'bg-brand-50 text-brand-700 dark:bg-slate-800 dark:text-brand-300',
                )
              }
            >
              <item.icon className="size-4 shrink-0" />
              {t(item.labelKey)}
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-slate-200 p-3 dark:border-slate-800">
          <NavLink
            to="/profile"
            className="flex items-center gap-3 rounded-lg p-2 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <Avatar firstName={user?.firstName} lastName={user?.lastName} src={user?.avatarUrl} />
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium text-slate-900 dark:text-slate-100">
                {user?.firstName} {user?.lastName}
              </span>
              <span className="block truncate text-xs text-slate-500 dark:text-slate-400">{user?.email}</span>
            </span>
          </NavLink>
        </div>
      </aside>

      {mobileOpen ? (
        <button
          type="button"
          aria-label="Close navigation"
          className="fixed inset-0 z-30 bg-slate-900/40 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-2 border-b border-slate-200 bg-white/90 px-4 backdrop-blur dark:border-slate-800 dark:bg-slate-900/90">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open navigation">
            <Menu className="size-4" />
          </Button>
          <GlobalSearch />
          <div className="ml-auto flex items-center gap-1">
            <Tooltip label={t('common.search')}>
              <Button variant="ghost" size="icon" onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }))} aria-label={t('common.search')}>
                <Search className="size-4" />
              </Button>
            </Tooltip>
            <NotificationBell unreadCount={unread.data?.meta.total ?? 0} />
            <LanguageSwitcher />
            <ThemeToggle />
            <Tooltip label={t('auth.signOut')}>
              <Button
                variant="ghost"
                size="icon"
                onClick={async () => {
                  await logout();
                  navigate('/login');
                }}
                aria-label={t('auth.signOut')}
              >
                <LogOut className="size-4" />
              </Button>
            </Tooltip>
            <Bell className="hidden" aria-hidden />
          </div>
        </header>

        <main className="min-w-0 flex-1 p-4 sm:p-6 lg:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
