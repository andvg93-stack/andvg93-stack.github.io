import type { FrontierFeature } from './types';

export const MAX_CONNECTION_GAP_KM = 2;

export interface VisualPoint {
  lng: number;
  lat: number;
  x: number;
  y: number;
}

export interface FrontierVisualDescriptor {
  feature: FrontierFeature;
  centroid: VisualPoint;
  radiusKm: number;
  radiusDegrees: number;
  parentId: string | null;
  parentCentroid: VisualPoint | null;
  edgeGapKm: number | null;
  connectsToParent: boolean;
}

export interface FrontierVisualWeights {
  entry: number;
  active: number;
  expansion: number;
  retired: number;
}

const EARTH_RADIUS_KM = 6371.0088;

export function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}

export function smoothstep(value: number) {
  const amount = clamp01(value);
  return amount * amount * (3 - 2 * amount);
}

export function eventProgress(playhead: number, eventMonth: number) {
  return smoothstep(playhead - (eventMonth - 1));
}

export function polygonCentroid(feature: FrontierFeature): VisualPoint {
  const ring = feature.geometry.coordinates[0] ?? [];
  const [originLng = 0, originLat = 0] = ring[0] ?? [];
  let crossSum = 0;
  let longitudeSum = 0;
  let latitudeSum = 0;

  for (let index = 0; index < ring.length - 1; index += 1) {
    const startLng = ring[index][0] - originLng;
    const startLat = ring[index][1] - originLat;
    const endLng = ring[index + 1][0] - originLng;
    const endLat = ring[index + 1][1] - originLat;
    const cross = startLng * endLat - endLng * startLat;
    crossSum += cross;
    longitudeSum += (startLng + endLng) * cross;
    latitudeSum += (startLat + endLat) * cross;
  }

  let lng: number;
  let lat: number;
  if (Math.abs(crossSum) > 1e-12) {
    lng = originLng + longitudeSum / (3 * crossSum);
    lat = originLat + latitudeSum / (3 * crossSum);
  } else {
    const points = ring.length > 1 ? ring.slice(0, -1) : ring;
    lng = points.reduce((sum, point) => sum + point[0], 0) / Math.max(points.length, 1);
    lat = points.reduce((sum, point) => sum + point[1], 0) / Math.max(points.length, 1);
  }

  return { lng, lat, x: lng, y: -lat };
}

export function polygonRadiusDegrees(feature: FrontierFeature, centroid = polygonCentroid(feature)) {
  const ring = feature.geometry.coordinates[0] ?? [];
  return ring.reduce(
    (maximum, [lng, lat]) => Math.max(maximum, Math.hypot(lng - centroid.lng, lat - centroid.lat)),
    0,
  );
}

export function radiusFromHectares(hectares: number) {
  return Math.sqrt(Math.max(0, hectares) * 0.01 / Math.PI);
}

export function haversineDistanceKm(start: VisualPoint, end: VisualPoint) {
  const toRadians = Math.PI / 180;
  const deltaLat = (end.lat - start.lat) * toRadians;
  const deltaLng = (end.lng - start.lng) * toRadians;
  const startLat = start.lat * toRadians;
  const endLat = end.lat * toRadians;
  const haversine =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(startLat) * Math.cos(endLat) * Math.sin(deltaLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(haversine)));
}

export function buildFrontierVisuals(features: FrontierFeature[]): FrontierVisualDescriptor[] {
  const base = features.map((feature) => {
    const centroid = polygonCentroid(feature);
    return {
      feature,
      centroid,
      radiusKm: radiusFromHectares(feature.properties.hectares),
      radiusDegrees: polygonRadiusDegrees(feature, centroid),
    };
  });

  const chronological = [...base].sort((first, second) => {
    const monthDifference = first.feature.properties.startMonth - second.feature.properties.startMonth;
    return monthDifference || first.feature.properties.id.localeCompare(second.feature.properties.id);
  });

  return base.map((current) => {
    const candidates = chronological
      .filter((candidate) =>
        candidate.feature.properties.municipality === current.feature.properties.municipality &&
        candidate.feature.properties.id !== current.feature.properties.id &&
        (current.feature.properties.origin === 'expansion'
          ? candidate.feature.properties.startMonth < current.feature.properties.startMonth
          : candidate.feature.properties.origin === 'initial' &&
            candidate.feature.properties.id.localeCompare(current.feature.properties.id) < 0),
      )
      .map((candidate) => ({
        candidate,
        edgeGapKm:
          haversineDistanceKm(current.centroid, candidate.centroid) -
          current.radiusKm -
          candidate.radiusKm,
      }))
      .sort((first, second) =>
        first.edgeGapKm - second.edgeGapKm ||
        first.candidate.feature.properties.id.localeCompare(second.candidate.feature.properties.id),
      );
    const nearest = candidates[0];

    return {
      ...current,
      parentId: nearest?.candidate.feature.properties.id ?? null,
      parentCentroid: nearest?.candidate.centroid ?? null,
      edgeGapKm: nearest?.edgeGapKm ?? null,
      connectsToParent: Boolean(nearest && nearest.edgeGapKm <= MAX_CONNECTION_GAP_KM),
    };
  });
}

export function visualWeights(
  descriptor: FrontierVisualDescriptor,
  playhead: number,
): FrontierVisualWeights {
  const { properties } = descriptor.feature;
  const entry = properties.origin === 'initial' ? 1 : eventProgress(playhead, properties.startMonth);
  const retirement =
    properties.retireMonth == null ? 0 : eventProgress(playhead, properties.retireMonth);
  const active = entry * (1 - retirement);

  return {
    entry,
    active,
    expansion: properties.origin === 'expansion' ? active : 0,
    retired: entry * retirement,
  };
}

export function visualScale(weight: number) {
  return Math.sqrt(clamp01(weight));
}

export function interpolatePoint(start: VisualPoint, end: VisualPoint, amount: number): VisualPoint {
  const progress = clamp01(amount);
  const lng = start.lng + (end.lng - start.lng) * progress;
  const lat = start.lat + (end.lat - start.lat) * progress;
  return { lng, lat, x: lng, y: -lat };
}

export function descriptorTransform(
  descriptor: FrontierVisualDescriptor,
  weight: number,
  travelProgress = 1,
  sizeMultiplier = 1,
) {
  const scale = visualScale(weight) * sizeMultiplier;
  const destination =
    descriptor.connectsToParent && descriptor.parentCentroid
      ? interpolatePoint(descriptor.parentCentroid, descriptor.centroid, travelProgress)
      : descriptor.centroid;
  return `translate(${destination.x} ${destination.y}) scale(${scale}) translate(${-descriptor.centroid.x} ${-descriptor.centroid.y})`;
}

export function roughnessForMonth(playhead: number) {
  return {
    frequencyX: 34 + Math.sin(playhead * 0.31) * 1.15,
    frequencyY: 29 + Math.cos(playhead * 0.23) * 1.05,
    displacement: 0.0062 + Math.sin(playhead * 0.19) * 0.00055,
  };
}
