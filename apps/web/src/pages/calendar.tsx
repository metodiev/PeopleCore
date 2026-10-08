import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { z } from 'zod';
import { api, type Paginated } from '../lib/api.js';
import { formatDate, formatDateTime, toDateInputValue } from '../lib/utils.js';
import { useAuth } from '../store/auth.js';
import type { CalendarEntry, CalendarListItem, EmployeeListItem, HolidayItem } from '../components/feature/api-types.js';
import { FormDialog, FormField } from '../components/feature/form-dialog.js';
import { QueryBoundary, useApiErrorText } from '../components/feature/query.js';
import { DefinitionList, SectionCard } from '../components/feature/widgets.js';
import { Badge } from '../components/ui/badge.js';
import { Button } from '../components/ui/button.js';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card.js';
import { ConfirmDialog, Dialog, DialogContent } from '../components/ui/dialog.js';
import { EmptyState, TableSkeleton } from '../components/ui/feedback.js';
import { Input, Select, Textarea } from '../components/ui/input.js';
import { PageHeader, Switch } from '../components/ui/misc.js';

const EVENT_TYPES = ['MEETING', 'EVENT', 'HOLIDAY', 'LEAVE', 'BUSINESS_TRIP', 'REMOTE_WORK', 'TRAINING', 'OTHER'] as const;
const VISIBILITIES = ['PUBLIC', 'TENANT', 'PRIVATE'] as const;
const CALENDAR_TYPES = ['COMPANY', 'DEPARTMENT', 'TEAM', 'PERSONAL', 'HOLIDAY'] as const;
const ATTENDEE_STATUSES = ['ACCEPTED', 'TENTATIVE', 'DECLINED'] as const;

const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

function startOfMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function monthMatrix(cursor: Date): Date[] {
  const first = startOfMonth(cursor);
  const offset = (first.getUTCDay() + 6) % 7;
  const start = new Date(first.getTime() - offset * 86_400_000);
  return Array.from({ length: 42 }, (_, index) => new Date(start.getTime() + index * 86_400_000));
}

function dayKey(value: string | Date): string {
  return toDateInputValue(value);
}

function toDateTimeInputValue(value: string | Date | null | undefined): string {
  if (!value) return '';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 16);
}

function EventDialog(props: { open: boolean; onOpenChange: (open: boolean) => void; event: CalendarEntry | null; defaultDay: string | null }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const editing = props.event;

  const calendars = useQuery({
    queryKey: ['calendars', 'list'],
    queryFn: () => api.get<CalendarListItem[]>('/calendars'),
    enabled: props.open,
    staleTime: 60_000,
  });
  const employees = useQuery({
    queryKey: ['employees', 'options'],
    queryFn: () => api.get<Paginated<EmployeeListItem>>('/employees', { query: { pageSize: 100 } }),
    enabled: props.open,
    staleTime: 5 * 60_000,
  });

  const schema = useMemo(
    () =>
      z.object({
        calendarId: z.string().optional(),
        title: z.string().min(2, t('common.required')).max(200),
        description: z.string().max(2000).optional(),
        type: z.string().min(1, t('common.required')),
        startAt: z.string().min(1, t('common.required')),
        endAt: z.string().min(1, t('common.required')),
        allDay: z.boolean(),
        location: z.string().max(200).optional(),
        visibility: z.string().min(1, t('common.required')),
        attendeeIds: z.array(z.string()),
      }),
    [t],
  );
  type FormValues = z.infer<typeof schema>;

  const save = useMutation({
    mutationFn: (values: FormValues) => {
      const body = {
        calendarId: values.calendarId || undefined,
        title: values.title,
        description: values.description || undefined,
        type: values.type,
        startAt: new Date(values.startAt).toISOString(),
        endAt: new Date(values.endAt).toISOString(),
        allDay: values.allDay,
        location: values.location || undefined,
        visibility: values.visibility,
        attendeeEmployeeIds: values.attendeeIds.length > 0 ? values.attendeeIds : undefined,
      };
      return editing ? api.patch<CalendarEntry>(`/calendar/events/${editing.id}`, body) : api.post<CalendarEntry>('/calendar/events', body);
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['calendar'] }),
  });

  const defaultStart = editing?.startAt ? toDateTimeInputValue(editing.startAt) : props.defaultDay ? `${props.defaultDay}T09:00` : '';
  const defaultEnd = editing?.endAt ? toDateTimeInputValue(editing.endAt) : props.defaultDay ? `${props.defaultDay}T10:00` : '';

  return (
    <FormDialog<FormValues>
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={editing ? t('calendar.editEvent') : t('calendar.newEvent')}
      schema={schema}
      className="w-[min(96vw,46rem)]"
      defaultValues={{
        calendarId: editing?.calendarId ?? '',
        title: editing?.title ?? '',
        description: editing?.description ?? '',
        type: editing?.type ?? 'MEETING',
        startAt: defaultStart,
        endAt: defaultEnd,
        allDay: editing?.allDay ?? false,
        location: editing?.location ?? '',
        visibility: editing?.visibility ?? 'TENANT',
        attendeeIds: [],
      }}
      onSubmit={(values) => save.mutateAsync(values)}
    >
      {(form) => (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label={t('calendar.eventTitle')} htmlFor="evt-title" error={form.formState.errors.title?.message}>
              <Input id="evt-title" {...form.register('title')} />
            </FormField>
            <FormField label={t('calendar.eventType')} htmlFor="evt-type">
              <Select id="evt-type" {...form.register('type')}>
                {EVENT_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {t(`calendar.type.${type}`)}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label={t('calendar.startAt')} htmlFor="evt-start" error={form.formState.errors.startAt?.message}>
              <Input id="evt-start" type="datetime-local" {...form.register('startAt')} />
            </FormField>
            <FormField label={t('calendar.endAt')} htmlFor="evt-end" error={form.formState.errors.endAt?.message}>
              <Input id="evt-end" type="datetime-local" {...form.register('endAt')} />
            </FormField>
            <FormField label={t('calendar.calendar')} htmlFor="evt-calendar">
              <Select id="evt-calendar" {...form.register('calendarId')}>
                <option value="">{t('calendar.defaultCalendar')}</option>
                {(calendars.data ?? []).filter((calendar) => !calendar.isReadOnly).map((calendar) => (
                  <option key={calendar.id} value={calendar.id}>
                    {calendar.name}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label={t('calendar.visibility')} htmlFor="evt-visibility">
              <Select id="evt-visibility" {...form.register('visibility')}>
                {VISIBILITIES.map((value) => (
                  <option key={value} value={value}>
                    {t(`calendar.visibilityValue.${value}`)}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label={t('calendar.location')} htmlFor="evt-location">
              <Input id="evt-location" {...form.register('location')} />
            </FormField>
            <FormField label={t('calendar.attendees')} htmlFor="evt-attendees" hint={t('calendar.attendeesHint')}>
              <select id="evt-attendees" multiple size={4} className="input h-auto" {...form.register('attendeeIds')}>
                {(employees.data?.data ?? []).map((employee) => (
                  <option key={employee.id} value={employee.id}>
                    {employee.firstName} {employee.lastName}
                  </option>
                ))}
              </select>
            </FormField>
          </div>
          <label className="flex items-center justify-between gap-3 text-sm">
            {t('calendar.allDay')}
            <Switch checked={form.watch('allDay')} onCheckedChange={(checked) => form.setValue('allDay', checked)} />
          </label>
          <FormField label={t('calendar.description')} htmlFor="evt-description">
            <Textarea id="evt-description" rows={3} {...form.register('description')} />
          </FormField>
        </>
      )}
    </FormDialog>
  );
}

function CalendarDialog(props: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const schema = useMemo(
    () =>
      z.object({
        name: z.string().min(2, t('common.required')).max(120),
        type: z.string().min(1, t('common.required')),
        color: z.string().min(4).max(9),
        isDefault: z.boolean(),
      }),
    [t],
  );
  type FormValues = z.infer<typeof schema>;

  const create = useMutation({
    mutationFn: (values: FormValues) => api.post<CalendarListItem>('/calendars', values),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['calendars'] }),
  });

  return (
    <FormDialog<FormValues>
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={t('calendar.newCalendar')}
      schema={schema}
      defaultValues={{ name: '', type: 'COMPANY', color: '#6366f1', isDefault: false }}
      onSubmit={(values) => create.mutateAsync(values)}
      submitLabel={t('common.create')}
    >
      {(form) => (
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label={t('calendar.name')} htmlFor="cal-name" error={form.formState.errors.name?.message}>
            <Input id="cal-name" {...form.register('name')} />
          </FormField>
          <FormField label={t('calendar.calendarType')} htmlFor="cal-type">
            <Select id="cal-type" {...form.register('type')}>
              {CALENDAR_TYPES.map((type) => (
                <option key={type} value={type}>
                  {t(`calendar.calendarTypeValue.${type}`)}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label={t('leave.color')} htmlFor="cal-color">
            <Input id="cal-color" type="color" {...form.register('color')} />
          </FormField>
          <label className="flex items-center justify-between gap-3 text-sm">
            {t('calendar.isDefault')}
            <Switch checked={form.watch('isDefault')} onCheckedChange={(checked) => form.setValue('isDefault', checked)} />
          </label>
        </div>
      )}
    </FormDialog>
  );
}

function EventDetailDialog(props: { event: CalendarEntry | null; onOpenChange: (open: boolean) => void; onEdit: (event: CalendarEntry) => void }) {
  const { t } = useTranslation();
  const describeError = useApiErrorText();
  const can = useAuth((state) => state.can);
  const queryClient = useQueryClient();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const respond = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => api.post(`/calendar/events/${id}/respond`, { status }),
    onSuccess: () => {
      toast.success(t('common.saved'));
      void queryClient.invalidateQueries({ queryKey: ['calendar'] });
    },
    onError: (error) => toast.error(describeError(error)),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/calendar/events/${id}`),
    onSuccess: () => {
      toast.success(t('common.deleted'));
      setConfirmDelete(false);
      props.onOpenChange(false);
      void queryClient.invalidateQueries({ queryKey: ['calendar'] });
    },
    onError: (error) => toast.error(describeError(error)),
  });

  const event = props.event;

  return (
    <Dialog open={Boolean(event)} onOpenChange={props.onOpenChange}>
      <DialogContent title={event?.title ?? ''} description={t(`calendar.type.${event?.type ?? 'EVENT'}`, { defaultValue: event?.type })}>
        {event ? (
          <div className="space-y-4">
            <DefinitionList
              items={[
                { label: t('calendar.startAt'), value: formatDateTime(event.startAt) },
                { label: t('calendar.endAt'), value: formatDateTime(event.endAt) },
                { label: t('calendar.allDay'), value: event.allDay ? t('common.yes') : t('common.no') },
                { label: t('calendar.location'), value: event.location ?? '—' },
                { label: t('calendar.visibility'), value: t(`calendar.visibilityValue.${event.visibility}`, { defaultValue: event.visibility }) },
                {
                  label: t('calendar.attendees'),
                  value:
                    event.attendees.length === 0
                      ? '—'
                      : event.attendees
                          .map((attendee) => `${attendee.employeeId.slice(0, 8)} · ${t(`calendar.attendeeStatus.${attendee.status}`, { defaultValue: attendee.status })}`)
                          .join(', '),
                },
              ]}
            />
            {event.description ? <p className="whitespace-pre-wrap text-sm text-slate-600 dark:text-slate-300">{event.description}</p> : null}
            {event.readOnly ? (
              <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                {t('calendar.readOnlyHint')}
              </p>
            ) : null}

            {!event.readOnly ? (
              <SectionCard title={t('calendar.myResponse')}>
                <div className="flex flex-wrap gap-2">
                  {ATTENDEE_STATUSES.map((status) => (
                    <Button
                      key={status}
                      size="sm"
                      variant="outline"
                      loading={respond.isPending}
                      onClick={() => respond.mutate({ id: event.id, status })}
                    >
                      {t(`calendar.attendeeStatus.${status}`)}
                    </Button>
                  ))}
                </div>
              </SectionCard>
            ) : null}

            {can('calendar.manage') && !event.readOnly ? (
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => props.onEdit(event)}>
                  {t('common.edit')}
                </Button>
                <Button variant="danger" onClick={() => setConfirmDelete(true)}>
                  {t('common.delete')}
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}
      </DialogContent>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={t('calendar.deleteEvent')}
        destructive
        loading={remove.isPending}
        confirmLabel={t('common.delete')}
        onConfirm={() => {
          if (event) remove.mutate(event.id);
        }}
      />
    </Dialog>
  );
}

export function CalendarPage() {
  const { t } = useTranslation();
  const can = useAuth((state) => state.can);
  const [cursor, setCursor] = useState(() => startOfMonth(new Date()));
  const [hidden, setHidden] = useState<string[]>([]);
  const [eventDialogOpen, setEventDialogOpen] = useState(false);
  const [calendarDialogOpen, setCalendarDialogOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<CalendarEntry | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<CalendarEntry | null>(null);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  const days = useMemo(() => monthMatrix(cursor), [cursor]);
  const from = toDateInputValue(days[0]);
  const to = toDateInputValue(new Date(days[days.length - 1].getTime() + 86_400_000));
  const monthLabel = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(cursor);

  const calendars = useQuery({ queryKey: ['calendars', 'list'], queryFn: () => api.get<CalendarListItem[]>('/calendars') });
  const holidays = useQuery({
    queryKey: ['calendar', 'holidays', cursor.getUTCFullYear()],
    queryFn: () => api.get<Paginated<HolidayItem>>('/calendar/holidays', { query: { year: cursor.getUTCFullYear() } }),
  });
  const events = useQuery({
    queryKey: ['calendar', 'events', from, to],
    queryFn: () => api.get<CalendarEntry[]>('/calendar/events', { query: { from, to } }),
  });
  const upcoming = useQuery({
    queryKey: ['calendar', 'upcoming'],
    queryFn: () => api.get<CalendarEntry[]>('/calendar/events', { query: { from: toDateInputValue(new Date()), to: toDateInputValue(new Date(Date.now() + 30 * 86_400_000)) } }),
  });

  const visibleEvents = (events.data ?? []).filter((event) => !hidden.includes(event.calendarId));
  const eventsByDay = new Map<string, CalendarEntry[]>();
  for (const event of visibleEvents) {
    const key = dayKey(event.startAt);
    eventsByDay.set(key, [...(eventsByDay.get(key) ?? []), event]);
  }

  const todayKey = toDateInputValue(new Date());
  const dayDialogEvents = selectedDay ? eventsByDay.get(selectedDay) ?? [] : [];

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('calendar.title')}
        description={t('calendar.subtitle')}
        actions={
          <>
            <Button
              variant="outline"
              size="icon"
              aria-label={t('calendar.previousMonth')}
              onClick={() => setCursor((current) => new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() - 1, 1)))}
            >
              <ChevronLeft className="size-4" />
            </Button>
            <Button variant="outline" onClick={() => setCursor(startOfMonth(new Date()))}>
              {t('calendar.today')}
            </Button>
            <Button
              variant="outline"
              size="icon"
              aria-label={t('calendar.nextMonth')}
              onClick={() => setCursor((current) => new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + 1, 1)))}
            >
              <ChevronRight className="size-4" />
            </Button>
            {can('calendar.manage') ? (
              <>
                <Button variant="outline" onClick={() => setCalendarDialogOpen(true)}>
                  <Plus className="size-4" aria-hidden />
                  {t('calendar.newCalendar')}
                </Button>
                <Button
                  onClick={() => {
                    setEditingEvent(null);
                    setSelectedDay(null);
                    setEventDialogOpen(true);
                  }}
                >
                  <Plus className="size-4" aria-hidden />
                  {t('calendar.newEvent')}
                </Button>
              </>
            ) : null}
          </>
        }
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="capitalize">{monthLabel}</CardTitle>
            <Badge tone="brand">{t('calendar.eventCount', { count: visibleEvents.length })}</Badge>
          </CardHeader>
          <CardContent>
            <QueryBoundary
              query={events}
              isEmpty={() => false}
              skeleton={<TableSkeleton rows={6} columns={7} />}
            >
              {() => (
                <div className="space-y-2">
                  <div className="grid grid-cols-7 gap-1 text-center text-xs font-medium uppercase text-slate-500 dark:text-slate-400">
                    {WEEKDAYS.map((day) => (
                      <span key={day}>{t(`calendar.weekdays.${day}`)}</span>
                    ))}
                  </div>
                  <div className="grid grid-cols-7 gap-1">
                    {days.map((day) => {
                      const key = toDateInputValue(day);
                      const dayEvents = eventsByDay.get(key) ?? [];
                      const isCurrentMonth = day.getUTCMonth() === cursor.getUTCMonth();
                      const dayHolidays = (holidays.data?.data ?? []).filter((holiday) => dayKey(holiday.date) === key);
                      return (
                        <div
                          key={key}
                          className={`min-h-24 rounded-lg border p-1.5 text-left ${
                            key === todayKey
                              ? 'border-brand-400 bg-brand-50/60 dark:border-brand-500 dark:bg-brand-900/10'
                              : 'border-slate-100 dark:border-slate-800'
                          } ${isCurrentMonth ? '' : 'opacity-50'}`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold tabular-nums text-slate-600 dark:text-slate-300">{day.getUTCDate()}</span>
                            {dayHolidays.length > 0 ? <Badge tone="info">{dayHolidays[0]?.name.slice(0, 10)}</Badge> : null}
                          </div>
                          <div className="mt-1 space-y-1">
                            {dayEvents.slice(0, 3).map((event) => (
                              <button
                                key={event.id}
                                type="button"
                                onClick={() => setSelectedEvent(event)}
                                className="block w-full truncate rounded px-1.5 py-0.5 text-left text-xs text-white"
                                style={{ backgroundColor: calendars.data?.find((calendar) => calendar.id === event.calendarId)?.color ?? '#64748b' }}
                              >
                                {event.title}
                              </button>
                            ))}
                            {dayEvents.length > 3 ? (
                              <button
                                type="button"
                                className="w-full text-left text-xs font-medium text-brand-600 hover:underline dark:text-brand-400"
                                onClick={() => setSelectedDay(key)}
                              >
                                {t('calendar.more', { count: dayEvents.length - 3 })}
                              </button>
                            ) : null}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </QueryBoundary>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>{t('calendar.myCalendars')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <QueryBoundary query={calendars} isEmpty={(data) => data.length === 0} skeleton={<TableSkeleton rows={3} columns={1} />}>
                {(data) => (
                  <>
                    {data.map((calendar) => (
                      <label key={calendar.id} className="flex items-center justify-between gap-2 text-sm">
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: calendar.color ?? '#64748b' }} aria-hidden />
                          <span className="truncate text-slate-700 dark:text-slate-200">{calendar.name}</span>
                        </span>
                        <span className="flex items-center gap-2">
                          <span className="text-xs text-slate-400">{calendar.eventCount}</span>
                          <input
                            type="checkbox"
                            aria-label={calendar.name}
                            checked={!hidden.includes(calendar.id)}
                            onChange={(event) =>
                              setHidden((current) =>
                                event.target.checked ? current.filter((id) => id !== calendar.id) : [...current, calendar.id],
                              )
                            }
                          />
                        </span>
                      </label>
                    ))}
                  </>
                )}
              </QueryBoundary>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('calendar.upcoming')}</CardTitle>
            </CardHeader>
            <CardContent>
              <QueryBoundary
                query={upcoming}
                isEmpty={(data) => data.length === 0}
                empty={<EmptyState icon={CalendarDays} title={t('calendar.noUpcoming')} />}
                skeleton={<TableSkeleton rows={3} columns={1} />}
              >
                {(data) => (
                  <ul className="space-y-2">
                    {data.slice(0, 8).map((event) => (
                      <li key={event.id}>
                        <button type="button" className="w-full rounded-lg px-2 py-1 text-left hover:bg-slate-50 dark:hover:bg-slate-800" onClick={() => setSelectedEvent(event)}>
                          <span className="block truncate text-sm font-medium text-slate-800 dark:text-slate-100">{event.title}</span>
                          <span className="block text-xs text-slate-500 dark:text-slate-400">
                            {formatDate(event.startAt)} · {t(`calendar.type.${event.type}`, { defaultValue: event.type })}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </QueryBoundary>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('leave.holidays', { year: cursor.getUTCFullYear() })}</CardTitle>
            </CardHeader>
            <CardContent>
              <QueryBoundary
                query={holidays}
                isEmpty={(data) => data.data.length === 0}
                empty={<EmptyState title={t('leave.noHolidays')} />}
                skeleton={<TableSkeleton rows={3} columns={1} />}
              >
                {(data) => (
                  <ul className="space-y-1 text-sm text-slate-600 dark:text-slate-300">
                    {data.data.slice(0, 8).map((holiday) => (
                      <li key={holiday.id} className="flex items-center justify-between gap-2">
                        <span className="truncate">{holiday.name}</span>
                        <span className="tabular-nums text-xs text-slate-500">{formatDate(holiday.date)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </QueryBoundary>
            </CardContent>
          </Card>
        </div>
      </div>

      <EventDialog
        open={eventDialogOpen || Boolean(editingEvent)}
        onOpenChange={(open) => {
          if (!open) {
            setEventDialogOpen(false);
            setEditingEvent(null);
          }
        }}
        event={editingEvent}
        defaultDay={selectedDay}
      />
      <CalendarDialog open={calendarDialogOpen} onOpenChange={setCalendarDialogOpen} />
      <EventDetailDialog
        event={selectedEvent}
        onOpenChange={(open) => (!open ? setSelectedEvent(null) : undefined)}
        onEdit={(event) => {
          setSelectedEvent(null);
          setEditingEvent(event);
        }}
      />

      <Dialog open={Boolean(selectedDay)} onOpenChange={(open) => (!open ? setSelectedDay(null) : undefined)}>
        <DialogContent title={t('calendar.dayEvents', { date: selectedDay ? formatDate(selectedDay) : '' })}>
          <ul className="space-y-2">
            {dayDialogEvents.map((event) => (
              <li key={event.id}>
                <button
                  type="button"
                  className="w-full rounded-lg border border-slate-100 px-3 py-2 text-left hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800"
                  onClick={() => {
                    setSelectedDay(null);
                    setSelectedEvent(event);
                  }}
                >
                  <span className="block text-sm font-medium text-slate-800 dark:text-slate-100">{event.title}</span>
                  <span className="block text-xs text-slate-500 dark:text-slate-400">
                    {new Date(event.startAt).toLocaleTimeString()} – {new Date(event.endAt).toLocaleTimeString()}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>
    </div>
  );
}
