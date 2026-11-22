// Editable site layout: blocks -> rows -> row segments, plus plot-scale geometry helpers.
// Coordinates are GeoJSON [lng, lat] (WGS84). Segments are fractions [start, end] of their row's length,
// so moving a row's points keeps its segments attached.
import type {LngLat} from './geo';

export interface SegmentSourceRef {provider: string; device_id?: string | null; external_id?: string | null}
export interface Segment {id: string; name: string; description?: string | null; start: number; end: number; parent_ids: string[]; sources: SegmentSourceRef[]}
export interface Row {id: string; name: string; line: LngLat[]; accuracy?: string; segments: Segment[]}
export interface Block {id: string; name: string; outline: LngLat[]; accuracy?: string; rows: Row[]}
export interface Layout {site_id: string; version: number; saved_at: string; blocks: Block[]}

export interface LineageEntry {
  segment_id: string; block_id: string; row_id: string; name: string; parent_ids: string[];
  created_version: number; retired_version: number | null; created_at: string; retired_at: string | null;
}
export type Lineage = Record<string, LineageEntry>;

export const MIN_SEGMENT_FRACTION = 0.02;
export const MAX_SEGMENTS = 50;

export function newId(prefix: string): string {
  const rand = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID().replace(/-/g, '').slice(0, 12) : Math.random().toString(36).slice(2, 14);
  return `${prefix}-${rand}`;
}

/* ---------- planar geometry (fine at plot scale) ---------- */

const M_PER_DEG_LAT = 110_950;
const mPerDegLng = (lat: number) => 111_320 * Math.cos((lat * Math.PI) / 180);

function xy(points: readonly LngLat[]) {
  const lat0 = points[0]?.[1] ?? 0;
  const k = mPerDegLng(lat0);
  return {pts: points.map(([lng, lat]) => [lng * k, lat * M_PER_DEG_LAT] as const), k};
}

function cumulative(points: readonly LngLat[]): number[] {
  const {pts} = xy(points);
  const out = [0];
  for (let i = 1; i < pts.length; i++) out.push(out[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  return out;
}

export function lineLengthM(line: readonly LngLat[]): number {
  const c = cumulative(line);
  return c[c.length - 1] ?? 0;
}

/** Planar (shoelace) area of a small ring in m². */
export function ringAreaM2(ring: readonly LngLat[]): number {
  if (ring.length < 3) return 0;
  const {pts} = xy(ring);
  let sum = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length];
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum) / 2;
}

export function pointAt(line: readonly LngLat[], fraction: number): LngLat {
  const c = cumulative(line);
  const d = Math.max(0, Math.min(1, fraction)) * c[c.length - 1];
  for (let i = 1; i < line.length; i++) {
    if (d <= c[i] || i === line.length - 1) {
      const seg = c[i] - c[i - 1] || 1;
      const t = Math.max(0, Math.min(1, (d - c[i - 1]) / seg));
      return [line[i - 1][0] + (line[i][0] - line[i - 1][0]) * t, line[i - 1][1] + (line[i][1] - line[i - 1][1]) * t];
    }
  }
  return line[line.length - 1];
}

/** Portion of `line` between two fractions of its length (inner vertices included). */
export function sliceLine(line: readonly LngLat[], start: number, end: number): LngLat[] {
  const c = cumulative(line);
  const total = c[c.length - 1] || 1;
  const a = start * total, b = end * total;
  const inner = line.filter((_, i) => i > 0 && i < line.length - 1 && c[i] > a && c[i] < b);
  return [pointAt(line, start), ...inner, pointAt(line, end)];
}

/** Fraction along `line` of the point nearest to `p`. */
export function projectFraction(line: readonly LngLat[], p: LngLat): number {
  const {pts, k} = xy([...line]);
  const q = [p[0] * k, p[1] * M_PER_DEG_LAT];
  const c = cumulative(line);
  const total = c[c.length - 1] || 1;
  let best = {d: Infinity, f: 0};
  for (let i = 1; i < pts.length; i++) {
    const [x1, y1] = pts[i - 1], [x2, y2] = pts[i];
    const dx = x2 - x1, dy = y2 - y1;
    const len2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((q[0] - x1) * dx + (q[1] - y1) * dy) / len2));
    const d = Math.hypot(x1 + dx * t - q[0], y1 + dy * t - q[1]);
    if (d < best.d) best = {d, f: (c[i - 1] + t * (c[i] - c[i - 1])) / total};
  }
  return best.f;
}

/** Short line perpendicular to the row at `fraction`, `halfM` metres each side. */
export function tickAt(line: readonly LngLat[], fraction: number, halfM: number): [LngLat, LngLat] {
  const eps = 0.002;
  const a = pointAt(line, Math.max(0, fraction - eps)), b = pointAt(line, Math.min(1, fraction + eps));
  const p = pointAt(line, fraction);
  const k = mPerDegLng(p[1]);
  const dx = (b[0] - a[0]) * k, dy = (b[1] - a[1]) * M_PER_DEG_LAT;
  const len = Math.hypot(dx, dy) || 1;
  const nx = (-dy / len) * halfM, ny = (dx / len) * halfM;
  return [[p[0] - nx / k, p[1] - ny / M_PER_DEG_LAT], [p[0] + nx / k, p[1] + ny / M_PER_DEG_LAT]];
}

/** Point offset `metres` from `fraction` along the row (positive = left of travel direction). */
export function offsetFrom(line: readonly LngLat[], fraction: number, metres: number): LngLat {
  return tickAt(line, fraction, Math.abs(metres))[metres >= 0 ? 1 : 0];
}

export function centroid(points: readonly LngLat[]): LngLat {
  const n = points.length || 1;
  return [points.reduce((s, p) => s + p[0], 0) / n, points.reduce((s, p) => s + p[1], 0) / n];
}

/* ---------- segment drafting ---------- */

export function evenSegments(count: number): Segment[] {
  return Array.from({length: count}, (_, i) => ({
    id: newId('seg'), name: `Segment ${i + 1}`, start: i / count, end: (i + 1) / count, parent_ids: [], sources: [],
  }));
}

/**
 * New segment arrangement for a row. Returning to the saved count restores the saved segments (same ids);
 * any other count makes new segments, which the backend links to the saved ones they overlap.
 */
export function withSegmentCount(count: number, saved: Row | undefined): Segment[] {
  const n = Math.max(1, Math.min(MAX_SEGMENTS, count));
  if (saved && saved.segments.length === n) return saved.segments.map(s => ({...s}));
  return evenSegments(n);
}

/** Move the boundary between segments i and i+1 to `fraction`, keeping a minimum length on both sides. */
export function moveBoundary(segments: Segment[], i: number, fraction: number): Segment[] {
  const lo = segments[i].start + MIN_SEGMENT_FRACTION, hi = segments[i + 1].end - MIN_SEGMENT_FRACTION;
  const f = Math.round(Math.max(lo, Math.min(hi, fraction)) * 1e6) / 1e6;
  return segments.map((s, j) => (j === i ? {...s, end: f} : j === i + 1 ? {...s, start: f} : s));
}

/** Next free default block name ("Block 2", "Block 3", …). */
export function nextBlockName(layout: Layout): string {
  const used = layout.blocks.map(b => /^Block (\d+)$/.exec(b.name.trim())?.[1]).filter(Boolean).map(Number);
  return `Block ${Math.max(layout.blocks.length, ...used, 0) + 1}`;
}

export function cloneLayout(layout: Layout): Layout {
  return JSON.parse(JSON.stringify(layout)) as Layout;
}

export function sameBlocks(a: Layout, b: Layout): boolean {
  return JSON.stringify(a.blocks) === JSON.stringify(b.blocks);
}

export function findRow(layout: Layout, rowId: string): {block: Block; row: Row} | null {
  for (const block of layout.blocks) for (const row of block.rows) if (row.id === rowId) return {block, row};
  return null;
}

export function findSegment(layout: Layout, segmentId: string): {block: Block; row: Row; segment: Segment} | null {
  for (const block of layout.blocks) for (const row of block.rows) for (const segment of row.segments) if (segment.id === segmentId) return {block, row, segment};
  return null;
}

/** Display label for any segment id, current or retired, e.g. "Row 2 · Segment 1". */
export function segmentLabel(id: string, layout: Layout, lineage: Lineage): string {
  const cur = findSegment(layout, id);
  if (cur) return `${cur.row.name} · ${cur.segment.name}`;
  const entry = lineage[id];
  if (!entry) return id;
  const row = findRow(layout, entry.row_id)?.row.name ?? 'removed row';
  return `${row} · ${entry.name} (before v${entry.retired_version ?? '?'} edit)`;
}
