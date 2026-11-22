// Coordinate-order helpers.
//
// GeoJSON (and the backend) always store [longitude, latitude] (WGS84).
// Leaflet constructors always take [latitude, longitude].
// Keep the two as distinct types and only convert through these helpers.
import type {LatLngBoundsLiteral, LatLngTuple} from 'leaflet';

/** GeoJSON position: [lng, lat]. */
export type LngLat = readonly [lng: number, lat: number];

export type PointGeometry = {type: 'Point'; coordinates: LngLat};
export type LineStringGeometry = {type: 'LineString'; coordinates: LngLat[]};
export type PolygonGeometry = {type: 'Polygon'; coordinates: LngLat[][]};
export type Geometry = PointGeometry | LineStringGeometry | PolygonGeometry;

export type GeoFeature<P = Record<string, unknown>> = {type: 'Feature'; id?: string; properties: P; geometry: Geometry};
export type FeatureCollection<P = Record<string, unknown>> = {type: 'FeatureCollection'; features: GeoFeature<P>[]};

/** [lng, lat] -> Leaflet [lat, lng]. */
export const toLatLng = ([lng, lat]: LngLat): LatLngTuple => [lat, lng];
export const lineToLatLngs = (coords: readonly LngLat[]): LatLngTuple[] => coords.map(toLatLng);
/** Outer ring only; the example site has no holes. */
export const polygonToLatLngs = (rings: readonly (readonly LngLat[])[]): LatLngTuple[] => lineToLatLngs(rings[0] ?? []);

export function positionsOf(geometry: Geometry): LngLat[] {
  if (geometry.type === 'Point') return [geometry.coordinates];
  if (geometry.type === 'LineString') return [...geometry.coordinates];
  return geometry.coordinates.flat();
}

/** Leaflet bounds literal covering every position, or null when empty. */
export function boundsOf(positions: readonly LngLat[]): LatLngBoundsLiteral | null {
  if (!positions.length) return null;
  let south = Infinity, west = Infinity, north = -Infinity, east = -Infinity;
  for (const [lng, lat] of positions) {
    south = Math.min(south, lat); north = Math.max(north, lat);
    west = Math.min(west, lng); east = Math.max(east, lng);
  }
  return [[south, west], [north, east]];
}
