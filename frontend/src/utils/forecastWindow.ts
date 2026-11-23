/** Forecast window maths for the time selector (SCRUM-127). Pure, so it is tested directly. */

export const STEP_HOURS = 1;
export const PLAY_STEP_HOURS = 3;
const MS_PER_HOUR = 3_600_000;

/** The hour containing `date`, in UTC (the API works in UTC hours). */
export function floorToHour(date: Date): Date {
  const d = new Date(date);
  d.setUTCMinutes(0, 0, 0);
  return d;
}

export function addHours(iso: string, hours: number): string {
  return new Date(new Date(iso).getTime() + hours * MS_PER_HOUR).toISOString();
}

/** Every step from `startIso` to `startIso + horizonHours`, inclusive. */
export function buildSteps(startIso: string, horizonHours: number, stepHours = STEP_HOURS): string[] {
  const steps: string[] = [];
  for (let h = 0; h <= horizonHours; h += stepHours) steps.push(addHours(startIso, h));
  return steps;
}

/** Index of the step nearest `selected`; null (now) is the first step. */
export function stepIndex(steps: string[], selected: string | null): number {
  if (!selected || steps.length === 0) return 0;
  const wanted = new Date(selected).getTime();
  let best = 0;
  let bestDistance = Infinity;
  steps.forEach((step, index) => {
    const distance = Math.abs(new Date(step).getTime() - wanted);
    if (distance < bestDistance) {
      best = index;
      bestDistance = distance;
    }
  });
  return best;
}

/** Snap a 0..1 track position to a step index. */
export function indexFromFraction(fraction: number, count: number): number {
  if (count <= 1) return 0;
  const clamped = Math.min(1, Math.max(0, fraction));
  return Math.round(clamped * (count - 1));
}

const LABEL_FORMAT = (timezone: string) =>
  new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: timezone,
    timeZoneName: 'short',
  });

/** "Mon 23 Nov 12:00 PST" in the user's timezone. */
export function formatStepLabel(iso: string, timezone: string): string {
  const parts = LABEL_FORMAT(timezone).formatToParts(new Date(iso));
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('weekday')} ${get('day')} ${get('month')} ${get('hour')}:${get('minute')} ${get('timeZoneName')}`;
}

/** "12:00 UTC" (or the user's timezone) for a model run time. */
export function formatRunTime(iso: string, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: timezone,
    timeZoneName: 'short',
  }).formatToParts(new Date(iso));
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('hour')}:${get('minute')} ${get('timeZoneName')}`;
}

/** "16 days" / "7.5 days" from an hour count. */
export function formatHorizon(hours: number): string {
  const days = hours / 24;
  return `${Number.isInteger(days) ? days : Number(days.toFixed(1))} days`;
}

export interface DayMark {
  /** Local calendar day, e.g. "2026-11-23". */
  key: string;
  /** Single letter for the track, e.g. "M". */
  label: string;
  /** Position on the track, 0..1. */
  fraction: number;
}

const DAY_KEY = (timezone: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' });
const WEEKDAY = (timezone: string) => new Intl.DateTimeFormat('en-GB', { timeZone: timezone, weekday: 'short' });

/** One mark per local midnight in the window, labelled with the weekday initial. */
export function dayMarks(startIso: string, horizonHours: number, timezone: string): DayMark[] {
  const start = new Date(startIso).getTime();
  const end = start + horizonHours * MS_PER_HOUR;
  const span = Math.max(1, end - start);
  const dayKey = DAY_KEY(timezone);
  const weekday = WEEKDAY(timezone);
  const marks: DayMark[] = [];
  let lastKey = '';
  for (let t = start; t <= end; t += MS_PER_HOUR) {
    const key = dayKey.format(new Date(t));
    if (key === lastKey) continue;
    lastKey = key;
    marks.push({
      key,
      label: weekday.format(new Date(t)).slice(0, 1).toUpperCase(),
      fraction: (t - start) / span,
    });
  }
  return marks;
}
