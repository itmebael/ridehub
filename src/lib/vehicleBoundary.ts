export interface LatLng {
  lat: number;
  lng: number;
}

export interface SquareBoundary {
  northLat: number;
  southLat: number;
  eastLng: number;
  westLng: number;
  sizeMeters: number;
}

export const DEFAULT_MAP_CENTER: LatLng = {
  lat: 11.7778,
  lng: 124.8847,
};

const METERS_PER_DEGREE_LAT = 111320;
const DEFAULT_BOUNDARY_SIZE_METERS = 200;
const MIN_BOUNDARY_SIZE_METERS = 50;

export const normalizeBoundarySize = (sizeMeters?: number | null): number => {
  const parsed = Number(sizeMeters);
  if (!Number.isFinite(parsed)) return DEFAULT_BOUNDARY_SIZE_METERS;
  return Math.max(MIN_BOUNDARY_SIZE_METERS, Math.round(parsed));
};

export const isValidLatLng = (value?: LatLng | null): value is LatLng =>
  Boolean(
    value &&
      Number.isFinite(value.lat) &&
      Number.isFinite(value.lng) &&
      Math.abs(value.lat) <= 90 &&
      Math.abs(value.lng) <= 180
  );

/** Axis-aligned rectangle from two opposite corners (any order). Good for touch: tap corner A, then corner B. */
export const buildRectangleBoundaryFromTwoCorners = (cornerA: LatLng, cornerB: LatLng): SquareBoundary => {
  const northLat = Math.max(cornerA.lat, cornerB.lat);
  const southLat = Math.min(cornerA.lat, cornerB.lat);
  const eastLng = Math.max(cornerA.lng, cornerB.lng);
  const westLng = Math.min(cornerA.lng, cornerB.lng);

  const latSpan = northLat - southLat;
  const lngSpan = eastLng - westLng;
  const midLat = (northLat + southLat) / 2;

  if (latSpan < 1e-8 || lngSpan < 1e-8) {
    const mid = { lat: midLat, lng: (eastLng + westLng) / 2 };
    return buildSquareBoundary(mid, MIN_BOUNDARY_SIZE_METERS);
  }

  const latMeters = latSpan * METERS_PER_DEGREE_LAT;
  const lngMetersPerDegree = Math.max(
    METERS_PER_DEGREE_LAT * Math.abs(Math.cos((midLat * Math.PI) / 180)),
    0.00001
  );
  const lngMeters = lngSpan * lngMetersPerDegree;
  const sizeMeters = normalizeBoundarySize(Math.max(latMeters, lngMeters));

  return {
    northLat,
    southLat,
    eastLng,
    westLng,
    sizeMeters,
  };
};

/**
 * Axis-aligned rental box from any corner taps (e.g. four taps TR, TL, BR, BL).
 * Needs at least two distinct points; uses min/max lat/lng over all points.
 */
export const buildAxisAlignedBoundaryFromPoints = (points: LatLng[]): SquareBoundary | null => {
  const valid = points.filter(isValidLatLng);
  if (valid.length < 2) return null;
  const northLat = Math.max(...valid.map((p) => p.lat));
  const southLat = Math.min(...valid.map((p) => p.lat));
  const eastLng = Math.max(...valid.map((p) => p.lng));
  const westLng = Math.min(...valid.map((p) => p.lng));
  return buildRectangleBoundaryFromTwoCorners(
    { lat: southLat, lng: westLng },
    { lat: northLat, lng: eastLng }
  );
};

export const getBoundaryCenter = (boundary: SquareBoundary): LatLng => ({
  lat: (boundary.northLat + boundary.southLat) / 2,
  lng: (boundary.eastLng + boundary.westLng) / 2,
});

export const buildSquareBoundary = (
  center: LatLng,
  sizeMeters?: number | null
): SquareBoundary => {
  const normalizedSize = normalizeBoundarySize(sizeMeters);
  const safeCenter = isValidLatLng(center) ? center : DEFAULT_MAP_CENTER;
  const halfSideMeters = normalizedSize / 2;
  const latDelta = halfSideMeters / METERS_PER_DEGREE_LAT;
  const lngMetersPerDegree = Math.max(
    METERS_PER_DEGREE_LAT * Math.abs(Math.cos((safeCenter.lat * Math.PI) / 180)),
    0.00001
  );
  const lngDelta = halfSideMeters / lngMetersPerDegree;

  return {
    northLat: safeCenter.lat + latDelta,
    southLat: safeCenter.lat - latDelta,
    eastLng: safeCenter.lng + lngDelta,
    westLng: safeCenter.lng - lngDelta,
    sizeMeters: normalizedSize,
  };
};

export const getSquareBoundaryPath = (
  boundary?: SquareBoundary | null
): LatLng[] => {
  if (!boundary) return [];

  return [
    { lat: boundary.northLat, lng: boundary.westLng },
    { lat: boundary.northLat, lng: boundary.eastLng },
    { lat: boundary.southLat, lng: boundary.eastLng },
    { lat: boundary.southLat, lng: boundary.westLng },
  ];
};

export const getSquareArea = (sizeMeters?: number | null): number => {
  const normalizedSize = normalizeBoundarySize(sizeMeters);
  return normalizedSize * normalizedSize;
};

export const isPointWithinBoundary = (
  point: LatLng,
  boundary?: SquareBoundary | null
): boolean => {
  if (!boundary || !isValidLatLng(point)) return false;

  const north = Math.max(boundary.northLat, boundary.southLat);
  const south = Math.min(boundary.northLat, boundary.southLat);
  const east = Math.max(boundary.eastLng, boundary.westLng);
  const west = Math.min(boundary.eastLng, boundary.westLng);

  return point.lat <= north && point.lat >= south && point.lng <= east && point.lng >= west;
};
