/** Match notifications where DB stored a different email casing than the signed-in user. */
export function recipientEmailVariants(email: string): string[] {
  const t = email.trim();
  if (!t) return [];
  return Array.from(new Set([t, t.toLowerCase(), t.toUpperCase()]));
}

export function emailsMatchCaseInsensitive(a: string | null | undefined, b: string | null | undefined): boolean {
  return (a || '').trim().toLowerCase() === (b || '').trim().toLowerCase();
}
