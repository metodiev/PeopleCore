import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { api, errorMessage } from '@/api/client';
import { calendarApi, leaveApi } from '@/api/endpoints';
import type { CalendarEventItem, HolidayItem } from '@/api/types';
import { Badge } from '@/components/badge';
import { Button } from '@/components/button';
import { Card, Section } from '@/components/card';
import { InlineMessage } from '@/components/inline-message';
import { Screen, ScreenHeader } from '@/components/screen';
import { EmptyState, ErrorState, LoadingState } from '@/components/states';
import { DateField, TextField } from '@/components/text-field';
import { useAction, useApiQuery } from '@/hooks/use-api';
import { useI18n } from '@/i18n';
import {
  WEEKDAYS,
  addDaysKey,
  addMonths,
  buildMonthGrid,
  formatDate,
  formatMonthLabel,
  formatTime,
  monthKey,
  relativeDayLabel,
  toDateKey,
  todayKey,
} from '@/lib/format';
import { useTheme } from '@/lib/theme';
import { useAuth } from '@/store/auth';

type AttendeeStatus = 'ACCEPTED' | 'DECLINED' | 'TENTATIVE';

/** Combines a `YYYY-MM-DD` key and an `HH:MM` time into an ISO timestamp. */
function localIso(dateKey: string, time: string): string | null {
  const [hours, minutes] = time.split(':').map((part) => Number(part));
  if (hours === undefined || minutes === undefined) return null;
  if (Number.isNaN(hours) || Number.isNaN(minutes) || hours > 23 || minutes > 59) return null;
  const value = new Date(`${dateKey}T00:00:00`);
  if (Number.isNaN(value.getTime())) return null;
  value.setHours(hours, minutes, 0, 0);
  return value.toISOString();
}

function coversDay(entry: CalendarEventItem, day: string): boolean {
  const start = toDateKey(entry.startAt);
  const end = toDateKey(entry.endAt);
  return start <= day && end >= day;
}

export default function CalendarScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { t, language } = useI18n();
  const canManage = useAuth((state) => state.isSuperAdmin || state.permissions.includes('calendar.manage'));
  const canViewHolidays = useAuth((state) => state.isSuperAdmin || state.permissions.includes('leave.view'));
  const myEmployeeId = useAuth((state) => state.employeeId);
  const { pending, error: actionError, run } = useAction();

  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [selectedDay, setSelectedDay] = useState(todayKey());
  const [message, setMessage] = useState<string | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [date, setDate] = useState(todayKey());
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('10:00');
  const [location, setLocation] = useState('');
  const [formErrors, setFormErrors] = useState<{ title?: string; date?: string; time?: string }>({});

  const grid = useMemo(() => buildMonthGrid(year, month), [year, month]);
  const from = grid[0]?.[0] ?? todayKey();
  const lastWeek = grid[grid.length - 1];
  const to = addDaysKey(lastWeek?.[6] ?? from, 1);

  const eventsQuery = useApiQuery<CalendarEventItem[]>(() => calendarApi.events(from, to), [from, to]);
  const holidaysQuery = useApiQuery<HolidayItem[]>(
    () => (canViewHolidays ? leaveApi.holidays(year) : Promise.resolve([] as HolidayItem[])),
    [canViewHolidays, year],
  );

  const entries = eventsQuery.data ?? [];
  const holidays = holidaysQuery.data ?? [];
  const dayEntries = entries.filter((entry) => coversDay(entry, selectedDay));
  const upcomingHolidays = holidays.filter((holiday) => holiday.date.slice(0, 10) >= todayKey()).slice(0, 6);

  const dotsByDay = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const entry of entries) {
      const color =
        entry.source === 'holiday'
          ? theme.colors.danger
          : entry.type === 'LEAVE'
            ? theme.colors.warning
            : theme.colors.brand;
      const list = map[toDateKey(entry.startAt)] ?? [];
      list.push(color);
      map[toDateKey(entry.startAt)] = list;
    }
    return map;
  }, [entries, theme]);

  const openForm = () => {
    setDate(selectedDay);
    setFormOpen(true);
  };

  const createEvent = async () => {
    const nextErrors: typeof formErrors = {};
    if (!title.trim()) nextErrors.title = t('common.required');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) nextErrors.date = t('common.required');
    const startAt = localIso(date, startTime);
    const endAt = localIso(date, endTime);
    if (!startAt || !endAt) nextErrors.time = t('calendar.timeFormatHint');
    else if (endAt <= startAt) nextErrors.time = t('calendar.endAfterStart');
    setFormErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    const result = await run(() =>
      api.post<CalendarEventItem>('/calendar/events', {
        title: title.trim(),
        description: description.trim() || undefined,
        startAt,
        endAt,
        location: location.trim() || undefined,
      }),
    );
    if (result === undefined) return;
    setMessage(t('calendar.created'));
    setTitle('');
    setDescription('');
    setLocation('');
    setFormOpen(false);
    await eventsQuery.refetch();
  };

  const respond = (eventId: string, status: AttendeeStatus) => {
    void (async () => {
      setMessage(null);
      const result = await run(() => api.post<CalendarEventItem>(`/calendar/events/${eventId}/respond`, { status }));
      if (result === undefined) return;
      setMessage(t('calendar.responseSaved'));
      await eventsQuery.refetch();
    })();
  };

  const shiftMonth = (delta: number) => {
    const next = addMonths(year, month, delta);
    setYear(next.year);
    setMonth(next.month);
  };

  const goToday = () => {
    const today = new Date();
    setYear(today.getFullYear());
    setMonth(today.getMonth());
    setSelectedDay(todayKey());
  };

  return (
    <Screen padded={false}>
      <ScrollView
        contentContainerStyle={{ padding: theme.spacing(4), paddingBottom: 48 }}
        refreshControl={
          <RefreshControl
            refreshing={eventsQuery.refreshing || holidaysQuery.refreshing}
            onRefresh={() => {
              void eventsQuery.refetch();
              if (canViewHolidays) void holidaysQuery.refetch();
            }}
            tintColor={theme.colors.brand}
          />
        }
      >
        <ScreenHeader
          title={t('calendar.title')}
          action={
            <Button title={t('common.back')} variant="ghost" size="sm" fullWidth={false} onPress={() => router.back()} />
          }
        />

        {message ? <InlineMessage text={message} tone="success" /> : null}
        {actionError ? <InlineMessage text={errorMessage(actionError)} /> : null}

        <Section title={t('calendar.day')}>
          <Card style={styles.card}>
            <View style={styles.monthRow}>
              <Button
                title={t('calendar.previousMonth')}
                variant="secondary"
                size="sm"
                fullWidth={false}
                onPress={() => shiftMonth(-1)}
              />
              <Text style={[styles.monthLabel, { color: theme.colors.text }]}>
                {formatMonthLabel(year, month, language)}
              </Text>
              <Button
                title={t('calendar.nextMonth')}
                variant="secondary"
                size="sm"
                fullWidth={false}
                onPress={() => shiftMonth(1)}
              />
            </View>

            <Button title={t('calendar.showToday')} variant="ghost" size="sm" onPress={goToday} />

            <View style={styles.weekdays}>
              {WEEKDAYS[language].map((label) => (
                <Text key={label} style={[styles.weekday, { color: theme.colors.textMuted }]}>
                  {label}
                </Text>
              ))}
            </View>

            {grid.map((week, weekIndex) => (
              <View key={weekIndex} style={styles.week}>
                {week.map((day) => {
                  const inMonth = day.slice(0, 7) === monthKey(year, month);
                  const isSelected = day === selectedDay;
                  const isToday = day === todayKey();
                  const dots = dotsByDay[day] ?? [];
                  return (
                    <Pressable key={day} onPress={() => setSelectedDay(day)} style={styles.cell}>
                      <View
                        style={[
                          styles.cellInner,
                          { borderRadius: theme.radius.md },
                          isSelected && { backgroundColor: theme.colors.brand },
                          !isSelected && isToday && { borderColor: theme.colors.brand, borderWidth: 1 },
                        ]}
                      >
                        <Text
                          style={{
                            color: isSelected
                              ? theme.colors.textInverse
                              : inMonth
                                ? theme.colors.text
                                : theme.colors.textMuted,
                            fontSize: 13,
                            fontWeight: isToday || isSelected ? '700' : '500',
                          }}
                        >
                          {Number(day.slice(8, 10))}
                        </Text>
                      </View>
                      <View style={styles.dots}>
                        {dots.slice(0, 3).map((color, index) => (
                          <View key={index} style={[styles.dot, { backgroundColor: color }]} />
                        ))}
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            ))}
          </Card>
        </Section>

        <Section title={`${t('calendar.agenda')} · ${relativeDayLabel(selectedDay, language) ?? formatDate(selectedDay, language)}`}>
          {eventsQuery.loading && !eventsQuery.data ? (
            <LoadingState />
          ) : eventsQuery.error && !eventsQuery.data ? (
            <ErrorState error={eventsQuery.error} onRetry={() => void eventsQuery.refetch()} />
          ) : dayEntries.length === 0 ? (
            <EmptyState title={t('calendar.noEvents')} hint={t('common.emptyHint')} />
          ) : (
            dayEntries.map((entry) => {
              const invite = (entry.attendees ?? []).find((attendee) => attendee.employeeId === myEmployeeId) ?? null;
              return (
                <View
                  key={entry.id}
                  style={[
                    styles.entry,
                    {
                      backgroundColor: theme.colors.surface,
                      borderColor: theme.colors.border,
                      borderRadius: theme.radius.lg,
                      padding: theme.spacing(3),
                    },
                  ]}
                >
                  <View style={styles.entryHeader}>
                    <View style={styles.entryText}>
                      <Text style={[styles.entryTitle, { color: theme.colors.text }]} numberOfLines={2}>
                        {entry.title}
                      </Text>
                      <Text style={[styles.entryMeta, { color: theme.colors.textMuted }]} numberOfLines={1}>
                        {entry.allDay
                          ? t('calendar.day')
                          : `${formatTime(entry.startAt)} – ${formatTime(entry.endAt)}`}
                        {entry.location ? ` · ${entry.location}` : ''}
                      </Text>
                    </View>
                    {entry.source === 'holiday' ? <Badge label={t('calendar.holidays')} tone="danger" /> : null}
                    {entry.type === 'LEAVE' ? <Badge label={t('calendar.leave')} tone="warning" /> : null}
                  </View>

                  {entry.description ? (
                    <Text style={[styles.entryDescription, { color: theme.colors.textMuted }]}>{entry.description}</Text>
                  ) : null}

                  {invite && !entry.readOnly ? (
                    invite.status === 'INVITED' ? (
                      <View style={styles.rsvp}>
                        <Button
                          style={styles.flex}
                          size="sm"
                          title={t('calendar.accept')}
                          disabled={pending}
                          onPress={() => respond(entry.id, 'ACCEPTED')}
                        />
                        <Button
                          style={styles.flex}
                          size="sm"
                          variant="secondary"
                          title={t('calendar.tentative')}
                          disabled={pending}
                          onPress={() => respond(entry.id, 'TENTATIVE')}
                        />
                        <Button
                          style={styles.flex}
                          size="sm"
                          variant="danger"
                          title={t('calendar.decline')}
                          disabled={pending}
                          onPress={() => respond(entry.id, 'DECLINED')}
                        />
                      </View>
                    ) : (
                      <View style={styles.rsvpResult}>
                        <Badge
                          label={
                            invite.status === 'ACCEPTED'
                              ? t('calendar.accept')
                              : invite.status === 'DECLINED'
                                ? t('calendar.decline')
                                : t('calendar.tentative')
                          }
                          tone={invite.status === 'ACCEPTED' ? 'success' : invite.status === 'DECLINED' ? 'danger' : 'warning'}
                        />
                      </View>
                    )
                  ) : null}
                </View>
              );
            })
          )}
        </Section>

        {canViewHolidays && upcomingHolidays.length > 0 ? (
          <Section title={t('calendar.holidays')}>
            <Card>
              {upcomingHolidays.map((holiday) => (
                <View key={holiday.id} style={styles.holidayRow}>
                  <Text style={[styles.holidayName, { color: theme.colors.text }]} numberOfLines={1}>
                    {holiday.name}
                  </Text>
                  <Text style={[styles.holidayDate, { color: theme.colors.textMuted }]}>
                    {formatDate(holiday.date, language)}
                  </Text>
                </View>
              ))}
            </Card>
          </Section>
        ) : null}

        {canManage ? (
          <Section
            title={t('calendar.events')}
            action={
              formOpen ? undefined : (
                <Button title={t('calendar.newEvent')} size="sm" fullWidth={false} onPress={openForm} />
              )
            }
          >
            {formOpen ? (
              <Card>
                <TextField
                  label={t('calendar.eventTitle')}
                  value={title}
                  onChangeText={setTitle}
                  error={formErrors.title ?? null}
                />
                <TextField
                  label={`${t('requests.description')} (${t('common.optional')})`}
                  value={description}
                  onChangeText={setDescription}
                  multiline
                  numberOfLines={3}
                />
                <DateField label={t('common.date')} value={date} onChange={setDate} error={formErrors.date ?? null} />
                <View style={styles.timeRow}>
                  <View style={styles.flex}>
                    <TextField
                      label={t('calendar.startTime')}
                      value={startTime}
                      onChangeText={setStartTime}
                      autoCapitalize="none"
                      keyboardType="numbers-and-punctuation"
                      error={formErrors.time ?? null}
                    />
                  </View>
                  <View style={styles.flex}>
                    <TextField
                      label={t('calendar.endTime')}
                      value={endTime}
                      onChangeText={setEndTime}
                      autoCapitalize="none"
                      keyboardType="numbers-and-punctuation"
                    />
                  </View>
                </View>
                <TextField
                  label={`${t('calendar.location')} (${t('common.optional')})`}
                  value={location}
                  onChangeText={setLocation}
                />
                <Button title={t('calendar.newEvent')} onPress={createEvent} loading={pending} disabled={pending} />
                <Button
                  title={t('common.cancel')}
                  variant="ghost"
                  onPress={() => setFormOpen(false)}
                  disabled={pending}
                />
              </Card>
            ) : null}
          </Section>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { gap: 10 },
  monthRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  monthLabel: { fontSize: 16, fontWeight: '700', flexShrink: 1, textAlign: 'center' },
  weekdays: { flexDirection: 'row' },
  weekday: { flex: 1, textAlign: 'center', fontSize: 11, fontWeight: '600' },
  week: { flexDirection: 'row' },
  cell: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 2, minHeight: 46 },
  cellInner: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  dots: { flexDirection: 'row', gap: 2, height: 6, marginTop: 2 },
  dot: { width: 5, height: 5, borderRadius: 3 },
  entry: { borderWidth: 1, gap: 8, marginBottom: 10 },
  entryHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  entryText: { flex: 1, gap: 2 },
  entryTitle: { fontSize: 15, fontWeight: '600' },
  entryMeta: { fontSize: 12 },
  entryDescription: { fontSize: 13 },
  rsvp: { flexDirection: 'row', gap: 8 },
  rsvpResult: { flexDirection: 'row' },
  flex: { flex: 1 },
  timeRow: { flexDirection: 'row', gap: 8 },
  holidayRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 6 },
  holidayName: { fontSize: 14, flexShrink: 1 },
  holidayDate: { fontSize: 13 },
});
