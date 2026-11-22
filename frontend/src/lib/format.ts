import type {Reading} from './sensors';

export function formatValue(reading: Pick<Reading, 'value' | 'unit'> | undefined): string {
  if (!reading || reading.value === null || Number.isNaN(reading.value)) return '—';
  const digits = Math.abs(reading.value) >= 100 ? 0 : 1;
  return `${reading.value.toFixed(digits)}${reading.unit === '%' || reading.unit.startsWith('°') ? '' : ' '}${reading.unit}`;
}

export function formatTime(iso: string | null | undefined, timeZone: string, withDate = true): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-US', {
    timeZone, hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
    ...(withDate ? {month: 'short', day: 'numeric', year: 'numeric'} : {}),
  }).format(date);
}

export function formatRange(startIso: string, endIso: string, timeZone: string): string {
  const fmt = new Intl.DateTimeFormat('en-US', {timeZone, month: 'short', day: 'numeric'});
  const year = new Intl.DateTimeFormat('en-US', {timeZone, year: 'numeric'}).format(new Date(endIso));
  return `${fmt.format(new Date(startIso))}–${fmt.format(new Date(endIso))}, ${year}`;
}
