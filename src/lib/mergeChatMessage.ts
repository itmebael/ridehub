/** Avoid duplicate rows when both insert-return and realtime fire for the same message. */
export function mergeMessageById<T extends { id: string }>(
  prev: T[],
  row: T | null | undefined
): T[] {
  if (!row?.id) return prev;
  if (prev.some((m) => m.id === row.id)) return prev;
  return [...prev, row];
}
