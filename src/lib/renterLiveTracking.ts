import type { SupabaseClient } from '@supabase/supabase-js';

const REQUEST_TTL_MS = 6 * 60 * 60 * 1000; // owner request valid 6h (re-click Track to refresh)
const MIN_PUSH_INTERVAL_MS = 22_000;

export function rentalIsApprovedActiveForTracking(rental: {
  status?: string;
  check_in_date?: string | null;
  check_out_date?: string | null;
}): boolean {
  if (rental.status !== 'approved') return false;
  const now = new Date();
  const start = rental.check_in_date ? new Date(rental.check_in_date) : null;
  const end = rental.check_out_date ? new Date(rental.check_out_date) : null;
  if (start && !Number.isNaN(start.getTime()) && now < start) return false;
  if (end && !Number.isNaN(end.getTime())) {
    const endDay = new Date(end);
    endDay.setHours(23, 59, 59, 999);
    if (now > endDay) return false;
  }
  return true;
}

export function renterTrackingRequestIsFresh(requestedAt: string | null | undefined): boolean {
  if (!requestedAt) return false;
  const t = new Date(requestedAt).getTime();
  if (Number.isNaN(t)) return false;
  return Date.now() - t < REQUEST_TTL_MS;
}

export async function pushRenterVehicleLocation(
  supabase: SupabaseClient,
  vehicleId: string,
  lat: number,
  lng: number
): Promise<{ error: { message?: string } | null }> {
  const { error } = await supabase.rpc('push_renter_vehicle_location', {
    p_vehicle_id: vehicleId,
    p_lat: lat,
    p_lng: lng,
  });
  return { error: error ? { message: error.message } : null };
}

export { MIN_PUSH_INTERVAL_MS, REQUEST_TTL_MS };
