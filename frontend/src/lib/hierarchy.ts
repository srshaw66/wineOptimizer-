// Site → block → row → row segment hierarchy shared by the tree, the map highlighting and the inspector.
// Built from the (saved or draft) layout plus per-segment data summaries; nothing here is SSU-specific.
import type {LngLat} from './geo';
import {lineLengthM, ringAreaM2, sliceLine, type Block, type Layout, type Row, type Segment} from './layout';
import type {EntityKind, SegmentSummary} from './sensors';

export type ItemKind = 'site' | 'block' | 'row' | 'segment';

export interface TreeItem {
  id: string;            // tree id, prefixed by kind (e.g. "row:teaching-plot:row-01")
  kind: ItemKind;
  entityId: string;      // id in the layout / alerts (unprefixed)
  name: string;
  parentId: string | null;
  children: string[];
  positions: LngLat[];   // geometry used for fitting the camera
  block?: Block;
  row?: Row;
  segment?: Segment;
  summary?: SegmentSummary;
  lengthM?: number;      // rows and segments
  areaM2?: number;       // blocks
}

export const segmentItemId = (id: string) => `seg:${id}`;
export const rowItemId = (id: string) => `row:${id}`;
export const blockItemId = (id: string) => `block:${id}`;
export const SITE_ITEM_ID = 'site';

export const ENTITY_KIND: Record<ItemKind, EntityKind> = {site: 'site', block: 'block', row: 'row', segment: 'segment'};
const PREFIX: Record<EntityKind, (id: string) => string> = {site: () => SITE_ITEM_ID, block: blockItemId, row: rowItemId, segment: segmentItemId};
export const itemIdFor = (kind: EntityKind, entityId: string) => PREFIX[kind](entityId);

export type Hierarchy = Map<string, TreeItem>;

export function buildHierarchy(layout: Layout, siteName: string, summaries: Map<string, SegmentSummary>): Hierarchy {
  const items: Hierarchy = new Map();
  const add = (item: TreeItem) => {
    items.set(item.id, item);
    if (item.parentId) items.get(item.parentId)?.children.push(item.id);
  };
  add({id: SITE_ITEM_ID, kind: 'site', entityId: layout.site_id, name: siteName, parentId: null, children: [], positions: []});
  for (const block of layout.blocks) {
    const bid = blockItemId(block.id);
    add({id: bid, kind: 'block', entityId: block.id, name: block.name, parentId: SITE_ITEM_ID, children: [], positions: [...block.outline], block, areaM2: ringAreaM2(block.outline)});
    for (const row of block.rows) {
      const rid = rowItemId(row.id);
      const len = lineLengthM(row.line);
      add({id: rid, kind: 'row', entityId: row.id, name: row.name, parentId: bid, children: [], positions: [...row.line], block, row, lengthM: len});
      for (const segment of row.segments) {
        add({
          id: segmentItemId(segment.id), kind: 'segment', entityId: segment.id, name: segment.name, parentId: rid, children: [],
          positions: sliceLine(row.line, segment.start, segment.end), block, row, segment, summary: summaries.get(segment.id), lengthM: len * (segment.end - segment.start),
        });
      }
    }
  }
  const site = items.get(SITE_ITEM_ID)!;
  site.positions = [...items.values()].filter(i => i.kind === 'block' || i.kind === 'row').flatMap(i => i.positions);
  return items;
}

/** Ids of the item and all its ancestors. */
export function lineage(items: Hierarchy, id: string | null): Set<string> {
  const out = new Set<string>();
  let cur = id ? items.get(id) : undefined;
  while (cur) {out.add(cur.id); cur = cur.parentId ? items.get(cur.parentId) : undefined;}
  return out;
}

/** Ids of the item and all its descendants. */
export function descendants(items: Hierarchy, id: string): string[] {
  const item = items.get(id);
  return item ? [id, ...item.children.flatMap(c => descendants(items, c))] : [];
}

export function breadcrumb(items: Hierarchy, id: string): string {
  const parts: string[] = [];
  let cur = items.get(id)?.parentId ? items.get(items.get(id)!.parentId!) : undefined;
  while (cur) {parts.unshift(cur.name); cur = cur.parentId ? items.get(cur.parentId) : undefined;}
  return parts.join(' / ');
}

export function segmentsUnder(items: Hierarchy, id: string): TreeItem[] {
  return descendants(items, id).map(i => items.get(i)!).filter(i => i.kind === 'segment');
}
