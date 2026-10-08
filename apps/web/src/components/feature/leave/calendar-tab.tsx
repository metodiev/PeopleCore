import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../../lib/api.js';
import { cn, formatDate } from '../../../lib/utils.js';
import type { TeamCalendarEntry } from '../api-types.js';
import { QueryBoundary } from '../query.js';
import { Button } from '../../ui/button.js';
import { Card, CardContent } from '../../ui/card.js';
import { EmptyState } from '../../ui/feedback.js';
import { Tooltip } from '../../ui/misc.js';

function monthRange(cursor: Date): { from: string; to: string } {
  const first = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), 1));
  const last = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 0));
  return { from: first.toISOString().slice(0, 10), to: last.toISOString().slice(0, 10) };
}

function buildMonthGrid(cursor: Date): Array<{ key: string; day: number; inMonth: boolean; isWeekend: boolean }> {
  const year = cursor.getUTCFullYear();
  const month = cursor.getUTCMonth();
  const first = new Date(Date.UTC(year, month, 1));
  const startOffset = (first.getUTCDay() + 6) % 7; // Monday-first grid
  const cells: Array<{ key: string; day: number; inMonth: boolean; isWeekend: boolean }> = [];
  for (let index = 0; index < 42; index += 1) {
    const date = new Date(Date.UTC(year, month, 1 - startOffset + index));
    const inMonth = date.getUTCMonth() === month;
    const weekday = date.getUTCDay();
    cells.push({
      key: date.toISOString().slice(0, 10),
      day: date.getUTCDate(),
      inMonth,
      isWeekend: weekday === 0 || weekday === 6,
    });
  }
  return cells;
}

export function LeaveCalendarTab() {
  const { t } = useTranslation();
  const [cursor, setCursor] = useState(() => new Date());
  const range = useMemo(() => monthRange(cursor), [cursor]);
  const grid = useMemo(() => buildMonthGrid(cursor), [cursor]);

  const calendar = useQuery({
    queryKey: ['leave', 'calendar', range.from, range.to],
    queryFn: () => api.get<TeamCalendarEntry[]>('/leave/calendar', { query: { from: range.from, to: range.to } }),
  });

  const byDay = useMemo(() => {
    const map = new Map<string, TeamCalendarEntry[]>();
    for (const entry of calendar.data ?? []) {
      const start = new Date(`${entry.startDate}T00:00:00Z`);
      const end = new Date(`${entry.endDate}T00:00:00Z`);
      const cursorDate = new Date(start);
      while (cursorDate <= end) {
        const key = cursorDate.toISOString().slice(0, 10);
        map.set(key, [...(map.get(key) ?? []), entry]);
        cursorDate.setUTCDate(cursorDate.getUTCDate() + 1);
      }
    }
    return map;
  }, [calendar.data]);

  const label = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(cursor);
  const weekdays = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

  const shift = (delta: number) => {
    setCursor((current) => new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + delta, 1)));
  };

  return (
    <Card>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between gap-2">
          <Button variant="outline" size="icon" aria-label={t('calendar.previousMonth')} onClick={() => shift(-1)}>
            <ChevronLeft className="size-4" aria-hidden />
          </Button>
          <p className="text-sm font-semibold capitalize text-slate-900 dark:text-slate-100">{label}</p>
          <Button variant="outline" size="icon" aria-label={t('calendar.nextMonth')} onClick={() => shift(1)}>
            <ChevronRight className="size-4" aria-hidden />
          </Button>
        </div>

        <QueryBoundary
          query={calendar}
          isEmpty={() => false}
          skeleton={<div className="h-72 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" />}
        >
          {() => (
            <div className="overflow-x-auto">
              <div className="min-w-[42rem]">
                <div className="grid grid-cols-7 gap-1 text-center text-xs font-semibold uppercase text-slate-500">
                  {weekdays.map((day) => (
                    <span key={day}>{t(`calendar.weekday.${day}`)}</span>
                  ))}
                </div>
                <div className="mt-1 grid grid-cols-7 gap-1">
                  {grid.map((cell) => {
                    const entries = byDay.get(cell.key) ?? [];
                    return (
                      <div
                        key={cell.key}
                        className={cn(
                          'min-h-20 rounded-lg border border-slate-100 p-1.5 text-left dark:border-slate-800',
                          !cell.inMonth && 'opacity-40',
                          cell.isWeekend && 'bg-slate-50 dark:bg-slate-900',
                        )}
                      >
                        <p className="text-xs font-medium text-slate-500">{cell.day}</p>
                        <ul className="mt-1 space-y-0.5">
                          {entries.slice(0, 3).map((entry) => (
                            <li key={`${cell.key}-${entry.id}`}>
                              <Tooltip label={`${entry.employee.firstName} ${entry.employee.lastName} · ${entry.leaveType.name}`}>
                                <span
                                  className="block truncate rounded px-1 py-0.5 text-[11px] text-white"
                                  style={{ backgroundColor: entry.leaveType.color ?? '#64748b' }}
                                >
                                  {entry.employee.firstName} {entry.employee.lastName.slice(0, 1)}.
                                </span>
                              </Tooltip>
                            </li>
                          ))}
                          {entries.length > 3 ? <li className="px-1 text-[11px] text-slate-500">{t('calendar.more', { count: entries.length - 3 })}</li> : null}
                        </ul>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </QueryBoundary>

        {(calendar.data ?? []).length === 0 && !calendar.isPending ? (
          <EmptyState title={t('leave.noTeamLeave')} description={t('leave.noTeamLeaveHint', { period: formatDate(range.from) })} />
        ) : null}
      </CardContent>
    </Card>
  );
}
