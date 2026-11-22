// Edit-mode handles drawn over the satellite map (rendered inside the Leaflet map).
//  * Block outline: drag vertices; click a midpoint (+) to insert one; double-click / right-click a vertex to remove it.
//  * Row line: same vertex tools (open line).
//  * Segment boundaries: drag the round handles along the row.
//  * Drawing: map clicks add points; click the first point (blocks) or press Finish to close.
import {useEffect} from 'react';
import {Marker, Polygon, Polyline, useMap, useMapEvents} from 'react-leaflet';
import L from 'leaflet';
import {lineToLatLngs, toLatLng, type LngLat} from '../lib/geo';
import {moveBoundary, pointAt, projectFraction, type Layout} from '../lib/layout';
import type {TreeItem} from '../lib/hierarchy';

export type DrawState = {kind: 'block'} | {kind: 'row'; blockId: string; straight: boolean};
export interface VertexSel {owner: string; index: number}

const icon = (cls: string, size: number, label = '') => L.divIcon({className: 'edit-handle-wrap', html: `<span class="${cls}">${label}</span>`, iconSize: [size, size], iconAnchor: [size / 2, size / 2]});
const ICONS = {
  vertex: icon('edit-vertex', 14),
  vertexSel: icon('edit-vertex edit-vertex--selected', 16),
  mid: icon('edit-mid', 14, '+'),
  divider: icon('edit-divider', 20),
  drawFirst: icon('edit-vertex edit-vertex--first', 18),
  draw: icon('edit-vertex', 12),
};

const ll = (e: L.LeafletEvent): LngLat => {
  const p = (e.target as L.Marker).getLatLng();
  return [p.lng, p.lat];
};
const mid = (a: LngLat, b: LngLat): LngLat => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

export function updateBlock(layout: Layout, blockId: string, fn: (b: Layout['blocks'][number]) => Layout['blocks'][number]): Layout {
  return {...layout, blocks: layout.blocks.map(b => (b.id === blockId ? fn(b) : b))};
}
export function updateRow(layout: Layout, rowId: string, fn: (r: Layout['blocks'][number]['rows'][number]) => Layout['blocks'][number]['rows'][number]): Layout {
  return {...layout, blocks: layout.blocks.map(b => (b.rows.some(r => r.id === rowId) ? {...b, rows: b.rows.map(r => (r.id === rowId ? fn(r) : r))} : b))};
}

interface Props {
  layout: Layout;
  target: TreeItem | undefined;
  drawing: DrawState | null;
  drawPoints: LngLat[];
  vertexSel: VertexSel | null;
  onLayout: (next: Layout) => void;
  onDrawPoint: (p: LngLat) => void;
  onFinishDraw: () => void;
  onSelectVertex: (sel: VertexSel | null) => void;
}

function PointHandles({owner, points, closed, min, selected, onChange, onSelect}: {
  owner: string; points: LngLat[]; closed: boolean; min: number; selected: VertexSel | null;
  onChange: (pts: LngLat[]) => void; onSelect: (sel: VertexSel | null) => void;
}) {
  const remove = (i: number) => {
    if (points.length <= min) return;
    onChange(points.filter((_, j) => j !== i));
    onSelect(null);
  };
  const mids = points.map((p, i) => (i < points.length - 1 ? mid(p, points[i + 1]) : closed ? mid(p, points[0]) : null));
  return (
    <>
      {mids.map((m, i) => m && (
        <Marker key={`m${i}`} position={toLatLng(m)} icon={ICONS.mid} title="Add a point here" zIndexOffset={1500}
          eventHandlers={{click: e => {L.DomEvent.stopPropagation(e); onChange([...points.slice(0, i + 1), m, ...points.slice(i + 1)]); onSelect({owner, index: i + 1});}}} />
      ))}
      {points.map((p, i) => {
        const isSel = selected?.owner === owner && selected.index === i;
        return (
          <Marker key={`v${i}`} position={toLatLng(p)} icon={isSel ? ICONS.vertexSel : ICONS.vertex} draggable zIndexOffset={2000}
            title={`Point ${i + 1}. Drag to move; double-click or right-click to remove.`}
            eventHandlers={{
              click: e => {L.DomEvent.stopPropagation(e); onSelect({owner, index: i});},
              dragstart: () => onSelect({owner, index: i}),
              drag: e => onChange(points.map((q, j) => (j === i ? ll(e) : q))),
              dblclick: e => {L.DomEvent.stopPropagation(e); remove(i);},
              contextmenu: e => {L.DomEvent.stopPropagation(e); remove(i);},
            }} />
        );
      })}
    </>
  );
}

function DrawLayer({drawing, points, onPoint, onFinish}: {drawing: DrawState; points: LngLat[]; onPoint: (p: LngLat) => void; onFinish: () => void}) {
  const map = useMap();
  useEffect(() => {
    map.doubleClickZoom.disable();
    return () => {map.doubleClickZoom.enable();};
  }, [map]);
  useMapEvents({click: e => onPoint([e.latlng.lng, e.latlng.lat])});
  const latlngs = lineToLatLngs(points);
  return (
    <>
      {drawing.kind === 'block' && points.length >= 3
        ? <Polygon positions={latlngs} interactive={false} pathOptions={{color: '#4aa3ff', weight: 2, dashArray: '4 4', fillColor: '#4aa3ff', fillOpacity: 0.15}} />
        : points.length >= 2 && <Polyline positions={latlngs} interactive={false} pathOptions={{color: drawing.kind === 'row' ? '#ffb74d' : '#4aa3ff', weight: drawing.kind === 'row' ? 6 : 2, dashArray: drawing.kind === 'row' ? undefined : '4 4'}} />}
      {points.map((p, i) => (
        <Marker key={i} position={toLatLng(p)} icon={i === 0 ? ICONS.drawFirst : ICONS.draw} zIndexOffset={2000}
          title={i === 0 && drawing.kind === 'block' ? 'Click to close the outline' : `Point ${i + 1}`}
          eventHandlers={{click: e => {L.DomEvent.stopPropagation(e); if (i === 0 && drawing.kind === 'block' && points.length >= 3) onFinish();}}} />
      ))}
    </>
  );
}

export default function MapEditor({layout, target, drawing, drawPoints, vertexSel, onLayout, onDrawPoint, onFinishDraw, onSelectVertex}: Props) {
  if (drawing) return <DrawLayer drawing={drawing} points={drawPoints} onPoint={onDrawPoint} onFinish={onFinishDraw} />;
  if (!target) return null;

  if (target.kind === 'block' && target.block) {
    const block = layout.blocks.find(b => b.id === target.block!.id);
    if (!block) return null;
    return <PointHandles owner={`block:${block.id}`} points={block.outline} closed min={3} selected={vertexSel} onSelect={onSelectVertex}
      onChange={pts => onLayout(updateBlock(layout, block.id, b => ({...b, outline: pts})))} />;
  }

  if ((target.kind === 'row' || target.kind === 'segment') && target.row) {
    const row = layout.blocks.flatMap(b => b.rows).find(r => r.id === target.row!.id);
    if (!row) return null;
    return (
      <>
        <PointHandles owner={`row:${row.id}`} points={row.line} closed={false} min={2} selected={vertexSel} onSelect={onSelectVertex}
          onChange={pts => onLayout(updateRow(layout, row.id, r => ({...r, line: pts})))} />
        {row.segments.slice(0, -1).map((s, i) => (
          <Marker key={`d-${s.id}-${i}`} position={toLatLng(pointAt(row.line, s.end))} icon={ICONS.divider} draggable zIndexOffset={2500}
            title={`Boundary between ${s.name} and ${row.segments[i + 1].name}. Drag along the row.`}
            eventHandlers={{
              drag: e => {
                const next = moveBoundary(row.segments, i, projectFraction(row.line, ll(e)));
                (e.target as L.Marker).setLatLng(toLatLng(pointAt(row.line, next[i].end)));
                onLayout(updateRow(layout, row.id, r => ({...r, segments: next})));
              },
            }} />
        ))}
      </>
    );
  }
  return null;
}
