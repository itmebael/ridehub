export type RentalUnit = 'hour' | 'day' | 'week' | 'month';
export type RentalRates = Record<RentalUnit, number>;

export const RENTAL_UNITS: RentalUnit[] = ['hour', 'day', 'week', 'month'];

export const RENTAL_UNIT_LABELS: Record<RentalUnit, string> = {
  hour: 'Per Hour',
  day: 'Per Day',
  week: 'Per Week',
  month: 'Per Month'
};

export const RENTAL_UNIT_SUFFIXES: Record<RentalUnit, string> = {
  hour: '/hour',
  day: '/day',
  week: '/week',
  month: '/month'
};

const normalizeRateValue = (value: unknown): number | null => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.round(parsed));
};

export const getRentalRates = (
  source: number | Partial<RentalRates> | null | undefined
): RentalRates => {
  if (typeof source === 'number') {
    const safeBaseRate = Number.isFinite(source) ? Math.max(0, Math.round(source)) : 0;

    return {
      hour: safeBaseRate > 0 ? Math.max(1, Math.round(safeBaseRate / 24)) : 0,
      day: safeBaseRate,
      week: safeBaseRate * 7,
      month: safeBaseRate * 30
    };
  }

  const fallbackDayRate = normalizeRateValue(source?.day) ?? 0;
  const hourlyRate = normalizeRateValue(source?.hour);
  const weeklyRate = normalizeRateValue(source?.week);
  const monthlyRate = normalizeRateValue(source?.month);

  return {
    hour: hourlyRate ?? (fallbackDayRate > 0 ? Math.max(1, Math.round(fallbackDayRate / 24)) : 0),
    day: fallbackDayRate,
    week: weeklyRate ?? fallbackDayRate * 7,
    month: monthlyRate ?? fallbackDayRate * 30
  };
};

export const getRentalRate = (
  source: number | Partial<RentalRates> | null | undefined,
  unit: RentalUnit
): number => getRentalRates(source)[unit];

/** Normalize HTML time value to `HH:mm` for Date parsing. */
const normalizeTimeHm = (time: string): string => {
  const parts = time.trim().split(':');
  const h = Math.min(23, Math.max(0, parseInt(parts[0] || '0', 10)));
  const m = Math.min(59, Math.max(0, parseInt(parts[1] || '0', 10)));
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

/**
 * Fractional hours from pick-up (check-in date + time) to return (check-out date + time).
 * Returns 0 if the range is invalid or end is not after start.
 */
export const computeFractionalHoursBetween = (
  checkInYmd: string,
  checkOutYmd: string,
  pickUpTime: string,
  returnTime: string
): number => {
  if (!checkInYmd || !checkOutYmd) return 0;
  const t1 = normalizeTimeHm(pickUpTime);
  const t2 = normalizeTimeHm(returnTime);
  const start = new Date(`${checkInYmd}T${t1}:00`);
  const end = new Date(`${checkOutYmd}T${t2}:00`);
  const ms = end.getTime() - start.getTime();
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  return ms / (1000 * 60 * 60);
};

/** Whole hours billed (ceil), minimum 1 when duration is positive; 0 when duration is invalid. */
export const computeHourlyBillableHours = (
  checkInYmd: string,
  checkOutYmd: string,
  pickUpTime: string,
  returnTime: string
): number => {
  const frac = computeFractionalHoursBetween(checkInYmd, checkOutYmd, pickUpTime, returnTime);
  if (frac <= 0) return 0;
  return Math.max(1, Math.ceil(frac));
};

export const computeHourlyTotalAmount = (
  hourlyRate: number,
  checkInYmd: string,
  checkOutYmd: string,
  pickUpTime: string,
  returnTime: string
): number => {
  const hours = computeHourlyBillableHours(checkInYmd, checkOutYmd, pickUpTime, returnTime);
  return Math.max(0, Math.round(Number(hourlyRate) * hours));
};

export const buildRentalPlanNote = (unit: RentalUnit): string =>
  `Rental Plan: ${RENTAL_UNIT_LABELS[unit]}`;

export const extractRentalUnitFromText = (
  ...sources: Array<string | null | undefined>
): RentalUnit | null => {
  const combinedText = sources
    .filter((value): value is string => Boolean(value))
    .join('\n')
    .toLowerCase();

  if (!combinedText) return null;

  if (combinedText.includes('rental plan: per hour') || /\bper hour\b|\bhourly\b/.test(combinedText)) {
    return 'hour';
  }

  if (combinedText.includes('rental plan: per day') || /\bper day\b|\bdaily\b/.test(combinedText)) {
    return 'day';
  }

  if (combinedText.includes('rental plan: per week') || /\bper week\b|\bweekly\b/.test(combinedText)) {
    return 'week';
  }

  if (combinedText.includes('rental plan: per month') || /\bper month\b|\bmonthly\b/.test(combinedText)) {
    return 'month';
  }

  return null;
};
