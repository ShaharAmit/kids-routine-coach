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
