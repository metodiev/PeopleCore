import type { Language } from '@/i18n';

const MONTHS_SHORT: Record<Language, readonly string[]> = {
  bg: ['ян', 'фев', 'мар', 'апр', 'май', 'юни', 'юли', 'авг', 'сеп', 'окт', 'ное', 'дек'],
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
};

const MONTHS_LONG: Record<Language, readonly string[]> = {
  bg: [
    'януари',
    'февруари',
    'март',
    'април',
    'май',
    'юни',
    'юли',
    'август',
    'септември',
    'октомври',
    'ноември',
    'декември',
  ],
  en: [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ],
};

/** Monday-first weekday labels. */
export const WEEKDAYS: Record<Language, readonly string[]> = {
  bg: ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'нд'],
  en: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
};

export function parseDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** `YYYY-MM-DD` key in local time (matches the API's date-only fields). */
export function toDateKey(value: string | Date): string {
  const date = parseDate(value) ?? new Date();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

export function monthKey(year: number, month: number): string {
  return `${year}-${`${month + 1}`.padStart(2, '0')}`;
}

export function addMonths(year: number, month: number, delta: number): { year: number; month: number } {
  const date = new Date(year, month + delta, 1);
  return { year: date.getFullYear(), month: date.getMonth() };
}

export function addDaysKey(key: string, delta: number): string {
  const date = parseDate(`${key}T00:00:00`) ?? new Date();
  date.setDate(date.getDate() + delta);
  return toDateKey(date);
}

/** Six-week month grid, weeks starting on Monday. */
export function buildMonthGrid(year: number, month: number): string[][] {
  const first = new Date(year, month, 1);
  const offset = (first.getDay() + 6) % 7;
  const start = new Date(year, month, 1 - offset);
  const weeks: string[][] = [];
  for (let week = 0; week < 6; week += 1) {
    const days: string[] = [];
    for (let day = 0; day < 7; day += 1) {
      const current = new Date(start);
      current.setDate(start.getDate() + week * 7 + day);
      days.push(toDateKey(current));
    }
    weeks.push(days);
  }
  return weeks;
}

export function formatDate(value: string | Date | null | undefined, language: Language): string {
  const date = parseDate(value);
  if (!date) return '—';
  return `${date.getDate()} ${MONTHS_SHORT[language][date.getMonth()]} ${date.getFullYear()}`;
}

export function formatDateTime(value: string | Date | null | undefined, language: Language): string {
  const date = parseDate(value);
  if (!date) return '—';
  return `${formatDate(date, language)}, ${formatTime(date)}`;
}

export function formatTime(value: string | Date | null | undefined): string {
  const date = parseDate(value);
  if (!date) return '—';
  const hours = `${date.getHours()}`.padStart(2, '0');
  const minutes = `${date.getMinutes()}`.padStart(2, '0');
  return `${hours}:${minutes}`;
}

export function formatMonthLabel(year: number, month: number, language: Language): string {
  const name = MONTHS_LONG[language][month] ?? '';
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} ${year}`;
}

export function formatDateRange(
  from: string | Date | null | undefined,
  to: string | Date | null | undefined,
  language: Language,
): string {
  const start = parseDate(from);
  const end = parseDate(to);
  if (!start && !end) return '—';
  if (!start) return formatDate(end, language);
  if (!end || toDateKey(start) === toDateKey(end)) return formatDate(start, language);
  if (start.getFullYear() === end.getFullYear() && start.getMonth() === end.getMonth()) {
    return `${start.getDate()} – ${end.getDate()} ${MONTHS_SHORT[language][end.getMonth()]} ${end.getFullYear()}`;
  }
  return `${formatDate(start, language)} – ${formatDate(end, language)}`;
}

/** 450 → "7ч 30м" (bg) / "7h 30m" (en). */
export function formatMinutes(minutes: number | null | undefined, language: Language): string {
  if (minutes === null || minutes === undefined || Number.isNaN(minutes)) return '—';
  const rounded = Math.max(0, Math.round(minutes));
  const hours = Math.floor(rounded / 60);
  const rest = rounded % 60;
  const h = language === 'bg' ? 'ч' : 'h';
  const m = language === 'bg' ? 'м' : 'm';
  if (hours === 0) return `${rest}${m}`;
  if (rest === 0) return `${hours}${h}`;
  return `${hours}${h} ${rest}${m}`;
}

export function formatDays(days: number, language: Language): string {
  const rounded = Number.isInteger(days) ? days : Number(days.toFixed(1));
  if (language === 'bg') return `${rounded} ${rounded === 1 ? 'ден' : 'дни'}`;
  return `${rounded} ${rounded === 1 ? 'day' : 'days'}`;
}

export function formatRelative(value: string | Date | null | undefined, language: Language): string {
  const date = parseDate(value);
  if (!date) return '—';
  const minutes = Math.round((date.getTime() - Date.now()) / 60_000);
  const abs = Math.abs(minutes);
  if (abs < 1) return language === 'bg' ? 'сега' : 'now';
  if (abs < 60) {
    if (language === 'bg') return minutes > 0 ? `след ${abs} мин` : `преди ${abs} мин`;
    return minutes > 0 ? `in ${abs} min` : `${abs} min ago`;
  }
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) {
    if (language === 'bg') return hours > 0 ? `след ${hours} ч` : `преди ${Math.abs(hours)} ч`;
    return hours > 0 ? `in ${hours}h` : `${Math.abs(hours)}h ago`;
  }
  const days = Math.round(hours / 24);
  if (language === 'bg') return days > 0 ? `след ${days} дни` : `преди ${Math.abs(days)} дни`;
  return days > 0 ? `in ${days}d` : `${Math.abs(days)}d ago`;
}

export function todayKey(): string {
  return toDateKey(new Date());
}

export function relativeDayLabel(key: string, language: Language): string | null {
  const today = todayKey();
  if (key === today) return language === 'bg' ? 'Днес' : 'Today';
  if (key === addDaysKey(today, 1)) return language === 'bg' ? 'Утре' : 'Tomorrow';
  if (key === addDaysKey(today, -1)) return language === 'bg' ? 'Вчера' : 'Yesterday';
  return null;
}

export function initials(firstName?: string | null, lastName?: string | null): string {
  const first = (firstName ?? '').trim().charAt(0);
  const last = (lastName ?? '').trim().charAt(0);
  const value = `${first}${last}`.toUpperCase();
  return value || '?';
}

export function fullName(person: { firstName?: string | null; lastName?: string | null } | null | undefined): string {
  if (!person) return '—';
  const name = `${person.firstName ?? ''} ${person.lastName ?? ''}`.trim();
  return name || '—';
}
