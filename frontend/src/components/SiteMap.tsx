import {Fragment, useEffect, useMemo, useRef, useState, type ReactNode} from 'react';
import {CircleMarker, MapContainer, Marker, Polygon, Polyline, TileLayer, Tooltip, useMap} from 'react-leaflet';
import L from 'leaflet';
import {boundsOf, lineToLatLngs, toLatLng, type FeatureCollection, type LngLat} from '../lib/geo';
import {lineage, SITE_ITEM_ID, type Hierarchy, type TreeItem} from '../lib/hierarchy';
import {pointAt, sliceLine, tickAt, type Layout} from '../lib/layout';
import {topSeverity, typeColor, typeIcon, typeName} from '../lib/alerts';
import {SEVERITY_LABEL, type Alert, type AlertType, type SiteFeatureProps} from '../lib/sensors';

// Satellite imagery is the only basemap (no street-map fallback). Configurable through frontend env.
// Default: Esri World Imagery, licensed under the Esri Master License Agreement; keep its attribution.
// See README "Satellite basemap" for terms and how to switch to campus/licensed imagery.
const TILE_URL = import.meta.env.VITE_BASEMAP_URL || 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const TILE_ATTRIBUTION = import.meta.env.VITE_BASEMAP_ATTRIBUTION ||
  'Powered by <a href="https://www.esri.com/">Esri</a> | Imagery: Esri, Vantor, Earthstar Geographics, and the GIS User Community';
const TILE_MAX_NATIVE = Number(import.meta.env.VITE_BASEMAP_MAX_NATIVE_ZOOM) || 20;

const FIT = {padding: [48, 48] as [number, number], maxZoom: 21};
const GAP_M = 0.12;      // visual gap either side of a segment boundary
const TICK_HALF_M = 0.55; // half-length of the boundary tick across the row

export type LayerKey = 'block' | 'rows' | 'alerts';

const COLORS = {
  block: '#fff3c4', blockOn: '#4aa3ff',
  casing: '#16210f',
  seg: '#a5d66f', rowOn: '#ffb74d', segOn: '#ff5c8a',
  tick: '#ffffff',
};

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]!));

function flagIcon(alerts: Alert[], types: Map<string, AlertType>, state: {on: boolean}) {
  const first = alerts[0];
  const sev = topSeverity(alerts);
  const html = `<span class="alert-flag${state.on ? ' alert-flag--on' : ''}${sev ? ` alert-flag--${sev}` : ''}" style="--flag:${esc(typeColor(types, first.type_id))}" aria-hidden="true">`
    + `<span class="alert-flag__icon">${esc(typeIcon(types, first.type_id))}</span><span class="alert-flag__count">${alerts.length}</span></span>`;
  return L.divIcon({className: 'alert-flag-wrap', html, iconSize: [34, 22], iconAnchor: [4, 26], tooltipAnchor: [14, -26]});
}

function AlertLines({alerts, types}: {alerts: Alert[]; types: Map<string, AlertType>}) {
  return (
    <ul className="tip-alerts">
      {alerts.map(a => (
        <li key={a.id}>
          <b>{typeIcon(types, a.type_id)} {typeName(types, a.type_id)}</b>{a.severity ? ` · ${SEVERITY_LABEL[a.severity]} severity` : ''}
          <span>{a.description.length > 90 ? `${a.description.slice(0, 90)}…` : a.description}</span>
        </li>
      ))}
    </ul>
  );
}

function flagPosition(item: TreeItem): LngLat | null {
  if (item.kind === 'segment' && item.row && item.segment) return pointAt(item.row.line, (item.segment.start + item.segment.end) / 2);
  if (item.kind === 'row' && item.row) return item.row.line[0];
  if (item.kind === 'block' && item.block) return item.block.outline.reduce((a, b) => (b[1] > a[1] ? b : a));
  return null;
}

function MapController({items, fitKey, focus}: {items: Hierarchy; fitKey: string; focus: Props['focus']}) {
  const map = useMap();
  // Read geometry through a ref so editing (which changes items on every drag) never moves the camera.
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const siteBounds = () => boundsOf(itemsRef.current.get(SITE_ITEM_ID)?.positions ?? []);
  // Until the presenter pans/zooms, a resize (window or sliding panels) re-fits; afterwards it keeps the centre.
  const userMoved = useRef(false);
  useEffect(() => {
    const el = map.getContainer();
    const markUser = () => {userMoved.current = true;};
    const events = ['wheel', 'pointerdown', 'keydown'] as const;
    events.forEach(name => el.addEventListener(name, markUser, {passive: true}));
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        map.invalidateSize();
        const b = siteBounds();
        if (!userMoved.current && b) map.fitBounds(b, {...FIT, animate: false});
      });
    });
    observer.observe(el);
    return () => {cancelAnimationFrame(frame); observer.disconnect(); events.forEach(name => el.removeEventListener(name, markUser));};
  }, [map]); // eslint-disable-line react-hooks/exhaustive-deps
  // "Fit vineyard", initial load and after a save.
  const first = useRef(true);
  useEffect(() => {
    userMoved.current = false;
    const b = siteBounds();
    if (b) map.fitBounds(b, {...FIT, animate: !first.current});
    first.current = false;
  }, [map, fitKey]); // eslint-disable-line react-hooks/exhaustive-deps
  // Fly to an item picked in the tree or a list.
  useEffect(() => {
    if (!focus) return;
    const item = itemsRef.current.get(focus.id);
    if (!item?.positions.length) return;
    const b = boundsOf(item.positions);
    if (b) map.flyToBounds(b, {padding: item.kind === 'segment' || item.kind === 'row' ? [90, 90] : FIT.padding, maxZoom: FIT.maxZoom, duration: 0.4});
  }, [map, focus]);
  return null;
}

interface Props {
  layout: Layout;
  items: Hierarchy;
  reference: FeatureCollection<SiteFeatureProps>;
  selectedId: string | null;
  hoveredId: string | null;
  layers: Record<LayerKey, boolean>;
  activeAlerts: Map<string, Alert[]>;
  alertTypes: Map<string, AlertType>;
  onSelect: (id: string) => void;
  onHover: (id: string | null) => void;
  fitKey: string;
  /** Camera request for an item chosen outside the map; serial makes repeats distinct. */
  focus: {id: string; serial: number} | null;
  /** While drawing, existing geometry ignores the pointer so clicks add points. */
  drawing: boolean;
  editing: boolean;
  children?: ReactNode;
}

export default function SiteMap({layout, items, reference, selectedId, hoveredId, layers, activeAlerts, alertTypes, onSelect, onHover, fitKey, focus, drawing, editing, children}: Props) {
  const [tileProblem, setTileProblem] = useState(false);
  const tileErrors = useRef(0);
  const interactive = !drawing;
  const ik = interactive ? 'i' : 'd'; // interactivity is a creation option in Leaflet: remount on change
  // Highlight the hovered item (or, if none, the selected one) and everything above it.
  const active = useMemo(() => lineage(items, hoveredId ?? selectedId), [items, hoveredId, selectedId]);
  const hoverAware = (id: string) => ({
    click: (e: L.LeafletMouseEvent) => {L.DomEvent.stopPropagation(e); onSelect(id);},
    mouseover: () => onHover(id),
    mouseout: () => onHover(null),
  });

  return (
    <div className={`map-frame${editing ? ' map-frame--editing' : ''}${drawing ? ' map-frame--drawing' : ''}`}>
      <MapContainer className="leaflet-map" center={[38.34136, -122.67352]} zoom={20} minZoom={15} maxZoom={22} zoomSnap={0.25} scrollWheelZoom keyboard>
        <TileLayer
          url={TILE_URL}
          attribution={TILE_ATTRIBUTION}
          maxNativeZoom={TILE_MAX_NATIVE}
          maxZoom={22}
          eventHandlers={{
            tileerror: () => {tileErrors.current += 1; if (tileErrors.current >= 3) setTileProblem(true);},
            load: () => {tileErrors.current = 0; setTileProblem(false);},
          }}
        />
        <MapController items={items} fitKey={fitKey} focus={focus} />

        {layers.block && layout.blocks.map(block => {
          const id = `block:${block.id}`;
          const on = active.has(id);
          return (
            <Polygon
              key={`${block.id}|${ik}`}
              positions={lineToLatLngs(block.outline)}
              interactive={interactive}
              bubblingMouseEvents={false}
              pathOptions={{color: on ? COLORS.blockOn : COLORS.block, weight: on ? 2.5 : 2, dashArray: '6 5', fillColor: on ? COLORS.blockOn : COLORS.block, fillOpacity: on ? 0.2 : 0.12, lineJoin: 'round'}}
              eventHandlers={hoverAware(id)}
            >
              {interactive && <Tooltip sticky direction="top">{block.name}</Tooltip>}
            </Polygon>
          );
        })}

        {layers.rows && layout.blocks.flatMap(block => block.rows.map(row => {
          const rowId = `row:${row.id}`;
          const rowOn = active.has(rowId);
          const len = items.get(rowId)?.lengthM || 1;
          const gap = Math.min(GAP_M / len, 0.2 / Math.max(row.segments.length, 1));
          return (
            <Fragment key={`${row.id}|${ik}`}>
              <Polyline positions={lineToLatLngs(row.line)} interactive={false} pathOptions={{color: COLORS.casing, weight: rowOn ? 13 : 11, opacity: 0.6, lineCap: 'round'}} />
              {row.segments.map((s, i) => {
                const segId = `seg:${s.id}`;
                const segOn = segId === hoveredId || segId === selectedId;
                const a = i === 0 ? s.start : s.start + gap, b = i === row.segments.length - 1 ? s.end : s.end - gap;
                return <Polyline key={s.id} positions={lineToLatLngs(sliceLine(row.line, a, b))} interactive={false} pathOptions={{color: segOn ? COLORS.segOn : rowOn ? COLORS.rowOn : COLORS.seg, weight: segOn ? 9 : 7, opacity: 1, lineCap: 'butt'}} />;
              })}
              {row.segments.slice(1).map(s => {
                const [p, q] = tickAt(row.line, s.start, TICK_HALF_M);
                return <Polyline key={`tick-${s.id}`} positions={[toLatLng(p), toLatLng(q)]} interactive={false} pathOptions={{color: COLORS.tick, weight: 3, opacity: 1, lineCap: 'round'}} />;
              })}
              {interactive && row.segments.map(s => {
                const segId = `seg:${s.id}`;
                const flagged = activeAlerts.get(segId) ?? [];
                const summary = items.get(segId)?.summary;
                return (
                  // Transparent, wider hit target so the visible geometry stays a thin divided row.
                  <Polyline key={`hit-${s.id}`} positions={lineToLatLngs(sliceLine(row.line, s.start, s.end))} bubblingMouseEvents={false} pathOptions={{color: '#000', opacity: 0, weight: 22, lineCap: 'butt'}} eventHandlers={hoverAware(segId)}>
                    <Tooltip sticky direction="top" className="seg-tip">
                      <b>{row.name} · {s.name}</b>
                      <span className="tip-sub">{block.name}{summary ? (summary.status === 'no_data' ? ' · no data' : summary.is_example ? ' · example data' : '') : ''}</span>
                      {flagged.length > 0 ? <AlertLines alerts={flagged} types={alertTypes} /> : <span className="tip-sub">No active alerts</span>}
                    </Tooltip>
                  </Polyline>
                );
              })}
            </Fragment>
          );
        }))}

        {reference.features.map(f => f.properties.kind === 'landmark' && f.geometry.type === 'Point' && (
          <CircleMarker key={f.id ?? f.properties.name} center={toLatLng(f.geometry.coordinates)} radius={5} interactive={false} pathOptions={{color: '#ffffff', weight: 2, fillColor: '#2f3a44', fillOpacity: 1}}>
            <Tooltip permanent direction="bottom" offset={[0, 6]} className="landmark-tip">{f.properties.name}</Tooltip>
          </CircleMarker>
        ))}

        {layers.alerts && !editing && [...activeAlerts].map(([itemId, alerts]) => {
          const item = items.get(itemId);
          const pos = item && flagPosition(item);
          if (!item || !pos) return null;
          return (
            <Marker
              key={`flag-${itemId}`}
              position={toLatLng(pos)}
              icon={flagIcon(alerts, alertTypes, {on: active.has(itemId)})}
              zIndexOffset={800}
              keyboard
              title={`${alerts.length} active alert${alerts.length === 1 ? '' : 's'} on ${item.name}`}
              eventHandlers={{
                ...hoverAware(itemId),
                keypress: (e: L.LeafletKeyboardEvent) => {if (e.originalEvent.key === 'Enter' || e.originalEvent.key === ' ') onSelect(itemId);},
                add: e => {
                  const el = (e.target as L.Marker).getElement();
                  el?.setAttribute('role', 'button');
                  el?.setAttribute('aria-label', `${alerts.length} active alert${alerts.length === 1 ? '' : 's'} on ${item.name}. Show details.`);
                },
              }}
            >
              <Tooltip direction="top" className="seg-tip"><b>{item.name}</b><AlertLines alerts={alerts} types={alertTypes} /></Tooltip>
            </Marker>
          );
        })}

        {children}
      </MapContainer>
      {tileProblem && (
        <div className="map-notice" role="status">
          <b>Satellite imagery could not load</b> (offline or tile service unavailable). The block, rows and segments are still shown over a plain background.
        </div>
      )}
    </div>
  );
}
