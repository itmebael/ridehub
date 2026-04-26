import type { SupabaseClient } from '@supabase/supabase-js';

/** PostgREST / schema cache: unknown column on vehicles.update */
const MISSING_COLUMN_RE = /Could not find the '([^']+)' column/i;

export function extractMissingVehicleColumnName(message?: string | null): string | null {
  if (!message) return null;
  const m = MISSING_COLUMN_RE.exec(message);
  return m ? m[1] : null;
}

function missingColumnFromError(err: { message?: string; details?: string }): string | null {
  return extractMissingVehicleColumnName(err.message) || extractMissingVehicleColumnName(err.details);
}

/**
 * Runs vehicles.update and, on "column not in schema" errors, drops that key and retries.
 * Avoids 400s when the remote DB is missing optional columns (tracking, penalty, rate columns, etc.).
 */
export async function updateVehicleWithColumnFallback(
  supabase: SupabaseClient,
  vehicleId: string,
  payload: Record<string, unknown>
): Promise<{ data: unknown; error: { message?: string; code?: string } | null }> {
  let current: Record<string, unknown> = { ...payload };
  const maxAttempts = 28;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const result = await supabase
      .from('vehicles')
      .update(current)
      .eq('id', vehicleId)
      .select('*')
      .single();

    if (!result.error) {
      return { data: result.data, error: null };
    }

    const err = result.error as { message?: string; code?: string; details?: string };
    const col = missingColumnFromError(err);
    if (!col || !(col in current)) {
      return { data: null, error: err };
    }

    const next = { ...current };
    delete next[col];
    current = next;
  }

  return { data: null, error: { message: 'Could not update vehicle: too many missing columns.' } };
}
