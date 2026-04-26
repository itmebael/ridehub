/** Local calendar date YYYY-MM-DD. */
export function getLocalDateYmd(): string {
  const t = new Date();
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
}

/** Inclusive overlap for ISO date strings YYYY-MM-DD. */
export function reservationRangesOverlap(
  startA: string | null | undefined,
  endA: string | null | undefined,
  startB: string | null | undefined,
  endB: string | null | undefined
): boolean {
  if (!startA || !endA || !startB || !endB) return false;
  const re = /^\d{4}-\d{2}-\d{2}$/;
  if (!re.test(startA) || !re.test(endA) || !re.test(startB) || !re.test(endB)) return false;
  return startA <= endB && startB <= endA;
}

export function formatYmdMedium(ymd: string): string {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return ymd || '—';
  const [y, m, d] = ymd.split('-').map((x) => parseInt(x, 10));
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { dateStyle: 'medium' });
}
