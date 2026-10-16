import type { Day } from '../domain/types';

export type PresetId = 'today' | 'yesterday' | '7d' | 'mtd' | '30d' | '3m' | 'custom';

export interface DateRange {
  preset: PresetId;
  start: Day;
  /** Inclusive. */
  end: Day;
}

const DAY_MS = 86400000;

export interface Calendar {
  /** UTC ms of the calendar date for day 0. */
  day0Utc: number;
  today: Day;
}

export function dateOf(cal: Calendar, d: Day) {
  return new Date(cal.day0Utc + d * DAY_MS);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function dayLabel(cal: Calendar, d: Day, withYear = false) {
  const dt = dateOf(cal, d);
  return `${dt.getUTCDate()} ${MONTHS[dt.getUTCMonth()]}${withYear ? ` ${dt.getUTCFullYear()}` : ''}`;
}

export function monthLabel(cal: Calendar, d: Day) {
  const dt = dateOf(cal, d);
  return `${MONTHS[dt.getUTCMonth()]} ${dt.getUTCFullYear()}`;
}

export function monthName(cal: Calendar, d: Day) {
  return MONTHS[dateOf(cal, d).getUTCMonth()];
}

export function startOfMonth(cal: Calendar, d: Day): Day {
  return d - (dateOf(cal, d).getUTCDate() - 1);
}

export function daysInMonth(cal: Calendar, d: Day) {
  const dt = dateOf(cal, d);
  return new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0)).getUTCDate();
}

export function presetRange(cal: Calendar, preset: PresetId, custom?: { start: Day; end: Day }): DateRange {
  const t = cal.today;
  switch (preset) {
    case 'today': return { preset, start: t, end: t };
    case 'yesterday': return { preset, start: t - 1, end: t - 1 };
    case '7d': return { preset, start: t - 6, end: t };
    case 'mtd': return { preset, start: startOfMonth(cal, t), end: t };
    case '30d': return { preset, start: t - 29, end: t };
    case '3m': return { preset, start: t - 89, end: t };
    case 'custom': return { preset, start: Math.max(0, custom?.start ?? t - 29), end: Math.min(t, custom?.end ?? t) };
  }
}

/** The immediately preceding window of equal length. */
export function previousRange(r: DateRange): DateRange {
  const len = r.end - r.start + 1;
  return { preset: 'custom', start: r.start - len, end: r.start - 1 };
}

export function rangeDays(r: DateRange) {
  return r.end - r.start + 1;
}

export function rangeKey(r: DateRange) {
  return `${r.start}:${r.end}`;
}

export function inRange(r: DateRange, d: Day) {
  return d >= r.start && d <= r.end;
}

export const PRESETS: { id: PresetId; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: '7d', label: '7D' },
  { id: 'mtd', label: 'MTD' },
  { id: '30d', label: '30D' },
  { id: '3m', label: '3M' },
  { id: 'custom', label: 'Custom' },
];

export function describeRange(cal: Calendar, r: DateRange) {
  const p = PRESETS.find((x) => x.id === r.preset);
  const span = r.start === r.end ? dayLabel(cal, r.start) : `${dayLabel(cal, r.start)} – ${dayLabel(cal, r.end)}`;
  return r.preset === 'custom' ? span : `${p?.label} · ${span}`;
}
