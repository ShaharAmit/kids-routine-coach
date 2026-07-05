/**
 * Date helpers shared across screens. `getTodayISO` was duplicated in
 * app/index.tsx and app/rewards.tsx — keep one implementation here.
 */

/** Local-time `YYYY-MM-DD` for the current day (used as daily completion key). */
export function getTodayISO(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Whole-years age as of `today`, given a `YYYY-MM-DD` birth date string. */
export function calculateAgeFromISO(birthDateISO: string, today: Date = new Date()): number {
  const birthDate = new Date(`${birthDateISO}T00:00:00`);
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
    age -= 1;
  }
  return age;
}

/** Formats a `YYYY-MM-DD` birth date string for display, e.g. "May 14, 2019". */
export function formatBirthDate(birthDateISO: string): string {
  const date = new Date(`${birthDateISO}T00:00:00`);
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

/** ISO `YYYY-MM-DD` for a date exactly `years` before `today`. Used for default/min/max dates. */
export function isoDateYearsAgo(years: number, today: Date = new Date()): string {
  const date = new Date(today.getFullYear() - years, today.getMonth(), today.getDate());
  return getTodayISO(date);
}

