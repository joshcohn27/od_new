export const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const MONTH_NAMES = [
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
];

export function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function parseISODate(iso: string | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function addDaysISO(iso: string, days: number): string {
  const d = parseISODate(iso);
  if (!d) return '';
  d.setDate(d.getDate() + days);
  return toISODate(d);
}

/** "Sun 6/28" */
export function formatShortDate(iso: string | undefined): string {
  const d = parseISODate(iso);
  if (!d) return '';
  return `${DOW_LABELS[d.getDay()]} ${d.getMonth() + 1}/${d.getDate()}`;
}
