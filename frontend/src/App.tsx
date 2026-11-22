import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import SiteMap, {type LayerKey} from './components/SiteMap';
import MapEditor, {updateBlock, updateRow, type DrawState, type VertexSel} from './components/MapEditor';
import Inspector, {type InspectorTab} from './components/Inspector';
import FlagTypesSection from './components/FlagTypes';
import OptionsLayoutPanel, {type LayoutTab} from './components/OptionsLayoutPanel';
import type {AlertActions} from './components/AlertsPanel';
import {
  createAlert, createAlertType, DEFAULT_SITE_ID, deleteAlertType, loadAlerts, loadAlertTypes, loadSegments, loadSite,
  saveLayout, setAlertResolved, updateAlert, updateAlertType, type SiteData,
} from './lib/api';
import {activeByItem as groupActive} from './lib/alerts';
import {blockItemId, breadcrumb, buildHierarchy, ENTITY_KIND, lineage, rowItemId, segmentItemId, SITE_ITEM_ID, type TreeItem} from './lib/hierarchy';
import {cloneLayout, evenSegments, newId, nextBlockName, sameBlocks, type Layout} from './lib/layout';
import type {LngLat} from './lib/geo';
import './styles/app.css';

// The CSV/XLSX importer (src/features/data-import/, /api/imports/*) is kept for later but is not linked
// from the UI in this presentation build. See README "Data import (hidden)".
type View = 'map' | 'options';
type OptionsSection = 'layout' | 'flags';

type LoadState = {status: 'loading'} | {status: 'ready'; data: SiteData} | {status: 'error'; message: string};

const LAYERS: [LayerKey, string][] = [['block', 'Block outlines'], ['rows', 'Rows & segments'], ['alerts', 'Alert flags']];
const TREE_ICON: Record<TreeItem['kind'], string> = {site: '◆', block: '▣', row: '≡', segment: '▬'};

export default function App() {
  const [load, setLoad] = useState<LoadState>({status: 'loading'});
  const [reloadSerial, setReloadSerial] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoad(prev => (prev.status === 'ready' ? prev : {status: 'loading'}));
    loadSite(DEFAULT_SITE_ID, controller.signal)
      .then(data => setLoad({status: 'ready', data}))
      .catch(error => {
        if (!controller.signal.aborted) setLoad({status: 'error', message: error instanceof Error ? error.message : 'The site could not be loaded.'});
      });
    return () => controller.abort();
  }, [reloadSerial]);

  const retry = useCallback(() => setReloadSerial(n => n + 1), []);

  if (load.status === 'loading') return <div className="app-state" role="status"><div className="spinner" aria-hidden="true" />Loading campus vineyard…</div>;
  if (load.status === 'error') return (
    <div className="app-state" role="alert">
      <h1>The site could not be loaded</h1>
      <p>{load.message}</p>
      <button type="button" className="btn btn--primary" onClick={retry}>Try again</button>
    </div>
  );
  return <Workspace initial={load.data} onRetry={retry} />;
}

function Workspace({initial, onRetry}: {initial: SiteData; onRetry: () => void}) {
  const [data, setData] = useState(initial);
  useEffect(() => setData(initial), [initial]);
  const {bundle, origin, provider} = data;
  const site = bundle.site;
  const apiReady = origin === 'api';

  /* ----- edit mode ----- */
  const [view, setView] = useState<View>('map');
  const [section, setSection] = useState<OptionsSection>('layout');
  const inLayout = view === 'options' && section === 'layout';
  const [draft, setDraft] = useState<Layout | null>(null);
  const editing = Boolean(inLayout && apiReady && draft);
  const [drawing, setDrawing] = useState<DrawState | null>(null);
  const [drawPoints, setDrawPoints] = useState<LngLat[]>([]);
  const [vertexSel, setVertexSel] = useState<VertexSel | null>(null);
  const [pendingCountRow, setPendingCountRow] = useState<string | null>(null);
  const [pendingNameBlock, setPendingNameBlock] = useState<string | null>(null);
  const [layoutTab, setLayoutTab] = useState<LayoutTab>('Layout');
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const layout = editing && draft ? draft : data.layout;
  const dirty = Boolean(editing && draft && !sameBlocks(draft, data.layout));

  const summaries = useMemo(() => new Map(data.segments.map(s => [s.segment_id, s])), [data.segments]);
  const items = useMemo(() => buildHierarchy(layout, site.short_name, summaries), [layout, site.short_name, summaries]);
  const activeAlerts = useMemo(() => groupActive(data.alerts), [data.alerts]);
  const alertTypes = useMemo(() => new Map(data.alertTypes.map(t => [t.id, t])), [data.alertTypes]);
  const firstWithData = data.segments.find(s => s.status !== 'no_data');

  const [selected, setSelected] = useState<string>(() => (firstWithData ? segmentItemId(firstWithData.segment_id) : SITE_ITEM_ID));
  const [hovered, setHovered] = useState<string | null>(null);
  const [tab, setTab] = useState<InspectorTab>('Details');
  const [expanded, setExpanded] = useState<Set<string>>(() => lineage(items, selected));
  const [layers, setLayers] = useState<Record<LayerKey, boolean>>({block: true, rows: true, alerts: true});
  // On phone widths the panels overlay the map, so start with the map visible.
  const wide = typeof window === 'undefined' || !window.matchMedia('(max-width: 600px)').matches;
  const [left, setLeft] = useState(wide);
  const [right, setRight] = useState(wide);
  const [prior, setPrior] = useState<[boolean, boolean]>([true, true]);
  const [focus, setFocus] = useState<{id: string; serial: number} | null>(null);
  const [fitSerial, setFitSerial] = useState(0);
  const [notesOpen, setNotesOpen] = useState(false);
  const hoverClear = useRef(0);
  const treeRef = useRef<HTMLDivElement>(null);
  const leftRef = useRef<HTMLElement>(null);
  const rightRef = useRef<HTMLElement>(null);
  const mapViewRef = useRef<HTMLDivElement>(null);
  // Collapsed panels leave the tab order and accessibility tree (React 18 has no typed `inert` prop).
  useEffect(() => {leftRef.current?.toggleAttribute('inert', !left);}, [left]);
  useEffect(() => {rightRef.current?.toggleAttribute('inert', !right);}, [right]);
  // The map stays mounted (keeping selection and view) but is unreachable while a full-page section is open.
  const fullPage = view === 'options' && section === 'flags';
  useEffect(() => {mapViewRef.current?.toggleAttribute('inert', fullPage);}, [fullPage]);

  // Keep the selection valid if the layout changes (save, cancel, reload).
  const current = items.get(selected) ?? items.get(SITE_ITEM_ID)!;
  useEffect(() => {if (!items.has(selected)) setSelected(SITE_ITEM_ID);}, [items, selected]);
  const hover = hovered ? items.get(hovered) : undefined;

  const reveal = (id: string) => setExpanded(old => new Set([...old, ...lineage(items, id)]));

  const pick = (id: string, fromMap: boolean) => {
    if (drawing) return;
    setSelected(id);
    setTab('Details');
    setRight(true);
    setVertexSel(null);
    reveal(id);
    if (!fromMap) setFocus(f => ({id, serial: (f?.serial ?? 0) + 1}));
  };

  // Short delay on clear so moving between adjacent elements doesn't flicker the highlight.
  const setHover = (id: string | null) => {
    window.clearTimeout(hoverClear.current);
    if (id) {setHovered(id); return;}
    hoverClear.current = window.setTimeout(() => setHovered(null), 50);
  };

  useEffect(() => {
    treeRef.current?.querySelector('.tree-row.selected')?.scrollIntoView({block: 'nearest', behavior: 'smooth'});
  }, [selected, left]);

  const toggle = (id: string) => setExpanded(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const onlyMap = () => {
    if (left || right) {setPrior([left, right]); setLeft(false); setRight(false);}
    else {setLeft(prior[0]); setRight(prior[1]);}
  };

  /* ----- derived data refresh (after saves / alert changes) ----- */
  const refreshSegments = async () => {
    try {
      const r = await loadSegments(site.id);
      setData(d => ({...d, segments: r.segments, provider: r.provider, segmentsError: null}));
    } catch (e) {
      setData(d => ({...d, segmentsError: e instanceof Error ? e.message : 'Segment data could not be loaded.'}));
    }
  };
  const refreshAlerts = async () => {
    const [alerts, types] = await Promise.all([loadAlerts(site.id), loadAlertTypes()]);
    setData(d => ({...d, alerts, alertTypes: types.types, icons: types.icons, recordsError: null}));
  };

  /* ----- edit actions (Options → Vineyard layout works on a draft of the saved layout) ----- */
  const resetDraft = (next: Layout | null) => {
    setDraft(next ? cloneLayout(next) : null);
    setDrawing(null); setDrawPoints([]); setVertexSel(null); setPendingCountRow(null); setPendingNameBlock(null); setEditError(null);
  };
  useEffect(() => {
    if (inLayout && apiReady && !draft) resetDraft(data.layout);
  }, [inLayout, apiReady, draft, data.layout]); // eslint-disable-line react-hooks/exhaustive-deps
  const cancelEditing = () => {
    if (dirty && !window.confirm('Discard unsaved map changes and restore the last saved layout?')) return;
    resetDraft(data.layout);
  };
  /** Change view/section; unsaved layout edits must be saved or discarded first. */
  const go = (nextView: View, nextSection: OptionsSection = section) => {
    const leavingLayout = inLayout && !(nextView === 'options' && nextSection === 'layout');
    if (leavingLayout && dirty && !window.confirm('You have unsaved layout changes. Discard them?')) return;
    if (leavingLayout) resetDraft(null);
    setView(nextView);
    setSection(nextSection);
    if (nextView === 'options' && nextSection === 'layout') {setRight(true); setLayoutTab('Layout');}
  };
  const save = async () => {
    if (!draft) return;
    setSaving(true); setEditError(null);
    try {
      const body = {
        base_version: data.layout.version,
        blocks: draft.blocks.map(b => ({
          id: b.id, name: b.name.trim() || 'Unnamed block', outline: b.outline,
          rows: b.rows.map(r => ({id: r.id, name: r.name.trim() || 'Unnamed row', line: r.line, segments: r.segments.map(s => ({
            id: s.id, name: s.name.trim() || 'Segment', description: s.description?.trim() || null, start: s.start, end: s.end,
            sources: s.sources.filter(src => src.provider.trim()),
          }))})),
        })),
      };
      const saved = await saveLayout(site.id, body);
      setData(d => ({...d, layout: saved.layout, lineage: saved.lineage}));
      resetDraft(saved.layout); // keep editing from the newly saved version
      await Promise.all([refreshSegments(), refreshAlerts().catch(() => undefined)]);
    } catch (e) {
      setEditError(e instanceof Error ? e.message : 'The layout could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  const finishDraw = (pts: LngLat[] = drawPoints) => {
    if (!drawing || !draft) return;
    if (drawing.kind === 'block') {
      if (pts.length < 3) return;
      const block = {id: newId('block'), name: nextBlockName(draft), outline: pts, rows: [], accuracy: 'drawn'};
      setDraft({...draft, blocks: [...draft.blocks, block]});
      setDrawing(null); setDrawPoints([]);
      setSelected(blockItemId(block.id));
      setExpanded(old => new Set([...old, SITE_ITEM_ID, blockItemId(block.id)]));
      setLayoutTab('Layout');
      setPendingNameBlock(block.id); // next: name it, then add rows
      return;
    }
    if (pts.length < 2) return;
    const blockRows = draft.blocks.find(b => b.id === drawing.blockId)?.rows.length ?? 0;
    const row = {id: newId('row'), name: `Row ${blockRows + 1}`, line: pts, accuracy: 'drawn', segments: evenSegments(1)};
    setDraft(updateBlock(draft, drawing.blockId, b => ({...b, rows: [...b.rows, row]})));
    setDrawing(null); setDrawPoints([]);
    setSelected(rowItemId(row.id));
    setExpanded(old => new Set([...old, SITE_ITEM_ID, blockItemId(drawing.blockId), rowItemId(row.id)]));
    setLayoutTab('Layout');
    setPendingCountRow(row.id); // prompt for the row name and number of segments
  };
  const addDrawPoint = (p: LngLat) => {
    if (!drawing) return;
    const next = [...drawPoints, p];
    setDrawPoints(next);
    // Straight row: start + end, connected automatically.
    if (drawing.kind === 'row' && drawing.straight && next.length === 2) finishDraw(next);
  };
  const removeVertex = () => {
    if (!draft || !vertexSel) return;
    const [kind, ...rest] = vertexSel.owner.split(':');
    const id = rest.join(':');
    if (kind === 'block') setDraft(updateBlock(draft, id, b => (b.outline.length > 3 ? {...b, outline: b.outline.filter((_, i) => i !== vertexSel.index)} : b)));
    else setDraft(updateRow(draft, id, r => (r.line.length > 2 ? {...r, line: r.line.filter((_, i) => i !== vertexSel.index)} : r)));
    setVertexSel(null);
  };

  // Keyboard: Escape cancels drawing; Enter finishes; Delete removes the selected point.
  useEffect(() => {
    if (!editing) return;
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
      if (typing) return;
      if (drawing && e.key === 'Escape') {setDrawing(null); setDrawPoints([]);}
      if (drawing && e.key === 'Enter') finishDraw();
      if (!drawing && vertexSel && (e.key === 'Delete' || e.key === 'Backspace')) {e.preventDefault(); removeVertex();}
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // Warn before closing the tab with unsaved edits.
  useEffect(() => {
    if (!dirty) return;
    const onUnload = (e: BeforeUnloadEvent) => {e.preventDefault(); e.returnValue = '';};
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [dirty]);

  /* ----- alerts ----- */
  const replaceAlert = (a: SiteData['alerts'][number]) => setData(d => ({...d, alerts: d.alerts.some(x => x.id === a.id) ? d.alerts.map(x => (x.id === a.id ? a : x)) : [a, ...d.alerts]}));
  const alertActions: AlertActions = {
    create: async (item, body) => {
      const a = await createAlert(site.id, {entity_kind: ENTITY_KIND[item.kind], entity_id: item.entityId, ...body});
      replaceAlert(a);
      loadAlertTypes().then(t => setData(d => ({...d, alertTypes: t.types}))).catch(() => undefined);
    },
    update: async (id, body) => replaceAlert(await updateAlert(id, {type_id: body.type_id, severity: body.severity, clear_severity: body.severity === null, description: body.description})),
    setResolved: async (id, resolved) => replaceAlert(await setAlertResolved(id, resolved)),
  };
  const readOnly = !apiReady ? 'Alerts, photos and layout edits need the local API. Start the backend and retry the connection.'
    : data.recordsError ? `Alerts are unavailable: ${data.recordsError}` : null;

  /* ----- tree ----- */
  const treeRow = (item: TreeItem, depth = 0): JSX.Element => {
    const open = expanded.has(item.id);
    const flags = activeAlerts.get(item.id)?.length ?? 0;
    const s = item.summary;
    return (
      <div key={item.id} role="none">
        <div
          className={`tree-row${selected === item.id ? ` selected ${item.kind}` : ''}${hovered === item.id ? ' hovered' : ''}`}
          style={{paddingLeft: 6 + depth * 16}}
          onMouseEnter={() => setHover(item.id)}
          onMouseLeave={() => setHover(null)}
        >
          {item.children.length > 0
            ? <button type="button" className="expander" onClick={() => toggle(item.id)} aria-expanded={open} aria-label={`${open ? 'Collapse' : 'Expand'} ${item.name}`}>{open ? '▾' : '▸'}</button>
            : <span className="expander-spacer" />}
          <button
            type="button"
            className="tree-label"
            aria-current={selected === item.id ? 'true' : undefined}
            onClick={() => pick(item.id, false)}
            onFocus={() => setHover(item.id)}
            onBlur={() => setHover(null)}
          >
            {item.kind === 'segment'
              ? <span className={`seg-swatch seg-swatch--${s?.status ?? 'draft'}`} aria-hidden="true" />
              : <span className="tree-icon" aria-hidden="true">{TREE_ICON[item.kind]}</span>}
            <span className="tree-name" title={s?.status === 'no_data' ? `${item.name} (no data)` : !s && item.kind === 'segment' ? `${item.name} (unsaved)` : undefined}>{item.name}</span>
            {flags > 0 && <span className="tree-flag" aria-label={`${flags} active alert${flags === 1 ? '' : 's'}`}>⚑{flags}</span>}
          </button>
        </div>
        {open && item.children.map(c => items.get(c)).filter((c): c is TreeItem => Boolean(c)).map(c => treeRow(c, depth + 1))}
      </div>
    );
  };

  const editTarget = items.get(selected);

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="branding"><span className="brand-icon" aria-hidden="true">♧</span>VineyardOS</div>
        <div className="current-site">
          <strong>{site.name}</strong>
          <span className="muted">{site.institution} · Rohnert Park, CA</span>
        </div>
        <div className="topbar-meta">
          {view === 'options'
            ? <button type="button" className="options-btn options-btn--back" onClick={() => go('map')}>← Back to map</button>
            : <button type="button" className="options-btn" onClick={() => go('options', 'layout')} aria-haspopup="false"><span aria-hidden="true">⚙</span> Options</button>}
        </div>
      </header>

      {view === 'options' && (
        <nav className="options-bar" aria-label="Options sections">
          <strong>Options</strong>
          <div className="options-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={section === 'layout'} className={section === 'layout' ? 'active' : ''} onClick={() => go('options', 'layout')}>Vineyard layout</button>
            <button type="button" role="tab" aria-selected={section === 'flags'} className={section === 'flags' ? 'active' : ''} onClick={() => go('options', 'flags')}>Flag types</button>
          </div>
          <span className="options-hint muted">{section === 'layout' ? 'Edit blocks, rows and segments, and manage the selected item’s records.' : 'Reusable alert types used across the site.'}</span>
        </nav>
      )}

      {origin === 'embedded' && (
        <div className="banner banner--warn" role="status">
          <span><b>Local API not reachable.</b> Showing the built-in example copy of this site (original layout, read-only). Saved map edits, alerts and photos appear once the API is back.</span>
          <button type="button" className="btn" onClick={onRetry}>Retry connection</button>
        </div>
      )}

      <div className="workspace">
        {fullPage && (
          <div className="page-overlay">
            <FlagTypesSection
              types={data.alertTypes}
              icons={data.icons}
              alerts={data.alerts}
              onCreate={async b => {await createAlertType(b); await refreshAlerts();}}
              onUpdate={async (id, b) => {await updateAlertType(id, b); await refreshAlerts();}}
              onDelete={async id => {await deleteAlertType(id); await refreshAlerts();}}
            />
            {!apiReady && <p className="state state--error">Flag types need the local API. {readOnly}</p>}
          </div>
        )}
        <div ref={mapViewRef} className="workspace-view">
        <aside ref={leftRef} className={`sidebar left${left ? '' : ' closed'}`} aria-label="Vineyard structure">
          <div className="sidebar-content">
            <div className="sidebar-title">
              <button type="button" className="panel-toggle" onClick={() => setLeft(false)} title="Collapse vineyard panel" aria-label="Collapse vineyard panel">⇤</button>
              <strong>Vineyard</strong>
              {editing && <span className="edit-tag">Editing</span>}
            </div>
            {data.segmentsError && (
              <div className="state state--error" role="alert">
                <p><b>Segment data unavailable.</b> {data.segmentsError}</p>
                <button type="button" className="btn" onClick={onRetry}>Try again</button>
              </div>
            )}
            <div className="tree" ref={treeRef} role="tree" aria-label="Site, blocks, rows and row segments">{treeRow(items.get(SITE_ITEM_ID)!)}</div>
            {editing && !drawing && (
              <button type="button" className="btn btn--primary add-block" onClick={() => {setDrawing({kind: 'block'}); setDrawPoints([]); setVertexSel(null); setPendingCountRow(null); setPendingNameBlock(null); setRight(true);}}>
                + Add block
              </button>
            )}
            <div className="layer-section">
              <h3>Map layers</h3>
              {LAYERS.map(([key, label]) => (
                <label key={key}>
                  <input type="checkbox" checked={layers[key]} onChange={e => setLayers(old => ({...old, [key]: e.target.checked}))} />
                  {label}
                </label>
              ))}
            </div>
          </div>
        </aside>

        <main className="main-map" aria-label="Campus vineyard map">
          <SiteMap
            layout={layout}
            items={items}
            reference={bundle.geometry}
            selectedId={selected}
            hoveredId={hovered}
            layers={layers}
            activeAlerts={activeAlerts}
            alertTypes={alertTypes}
            onSelect={id => pick(id, true)}
            onHover={setHover}
            fitKey={`${data.layout.version}|${fitSerial}`}
            focus={focus}
            drawing={Boolean(drawing)}
            editing={editing}
          >
            {editing && draft && (
              <MapEditor
                layout={draft}
                target={editTarget}
                drawing={drawing}
                drawPoints={drawPoints}
                vertexSel={vertexSel}
                onLayout={setDraft}
                onDrawPoint={addDrawPoint}
                onFinishDraw={() => finishDraw()}
                onSelectVertex={setVertexSel}
              />
            )}
          </SiteMap>
          <div className="floating-controls">
            <button type="button" className={`float-toggle ${left ? 'invisible' : ''}`} onClick={() => setLeft(true)} title="Open vineyard panel" aria-label="Open vineyard panel">⇥</button>
            <div className="float-cluster">
              {editing
                ? (
                  <>
                    <div className="edit-bar" role="toolbar" aria-label="Layout editing">
                      <span className="edit-bar-status">{saving ? 'Saving…' : dirty ? <><b>Draft</b> · unsaved changes</> : 'Editing layout · no unsaved changes'}</span>
                      <button type="button" className="map-only" onClick={cancelEditing} disabled={saving || !dirty}>Cancel</button>
                      <button type="button" className="map-only map-only--primary" onClick={save} disabled={saving || !dirty || Boolean(drawing)} title={drawing ? 'Finish or cancel the drawing first' : undefined}>Save</button>
                    </div>
                    <button type="button" className="map-only" onClick={() => setFitSerial(n => n + 1)} title="Fit the vineyard in view">Fit vineyard</button>
                  </>
                )
                : (
                  <>
                    <button type="button" className="map-only" onClick={onlyMap}>{left || right ? 'Map only' : 'Restore panels'}</button>
                    <button type="button" className="map-only" onClick={() => setFitSerial(n => n + 1)} title="Fit the vineyard in view">Fit vineyard</button>
                  </>
                )}
            </div>
            <button type="button" className={`float-toggle ${right ? 'invisible' : ''}`} onClick={() => setRight(true)} title="Open inspector" aria-label="Open inspector">⇤</button>
          </div>
          {editError && <div className="map-notice map-notice--error" role="alert"><b>Not saved.</b> {editError}</div>}
          <div className="map-legend">
            <strong>{site.short_name}</strong>
            <div>
              <span className="legend-swatch block" />Block <span className="legend-swatch row" />Row <span className="legend-swatch seg" />Segment <span className="legend-tick" />Boundary <span className="legend-flag">⚑</span>Active alert
            </div>
          </div>
          {hover && !drawing && <div className="hover-status" aria-hidden="true">Hovering: {breadcrumb(items, hover.id) ? `${breadcrumb(items, hover.id)} / ${hover.name}` : hover.name}</div>}
        </main>

        <aside ref={rightRef} className={`sidebar right${right ? '' : ' closed'}`} aria-label={editing ? 'Layout editing' : 'Inspector'}>
          <div className="sidebar-content">
            <div className="sidebar-title">
              <strong>{editing ? (current.kind === 'segment' && current.row ? `${current.row.name} · ${current.name}` : current.name) : 'Inspector'}</strong>
              <button type="button" className="panel-toggle" onClick={() => setRight(false)} title="Collapse panel" aria-label="Collapse right panel">⇥</button>
            </div>
            {inLayout && !apiReady && <div className="state state--error" role="status"><p><b>Layout editing is unavailable.</b> {readOnly}</p></div>}
            {editing && draft
              ? (
                <OptionsLayoutPanel
                  item={current}
                  tab={layoutTab}
                  onTab={setLayoutTab}
                  items={items}
                  site={site}
                  origin={origin}
                  saved={data.layout}
                  draft={draft}
                  lineage={data.lineage}
                  alerts={data.alerts}
                  alertTypes={data.alertTypes}
                  activeByItem={activeAlerts}
                  readOnly={readOnly}
                  alertActions={alertActions}
                  onDraft={setDraft}
                  edit={{
                    drawing,
                    drawPoints: drawPoints.length,
                    vertexSel,
                    pendingCountRow,
                    pendingNameBlock,
                    onDoneBlockName: () => setPendingNameBlock(null),
                    onStartDraw: d => {setDrawing(d); setDrawPoints([]); setVertexSel(null); setPendingCountRow(null); setPendingNameBlock(null);},
                    onUndoPoint: () => setDrawPoints(pts => pts.slice(0, -1)),
                    onFinishDraw: () => finishDraw(),
                    onCancelDraw: () => {setDrawing(null); setDrawPoints([]);},
                    onRemoveVertex: removeVertex,
                    onPick: id => pick(id, false),
                    onHover: setHover,
                    onDonePending: () => setPendingCountRow(null),
                  }}
                />
              )
              : (
                <Inspector
                  item={current}
                  tab={tab}
                  onTab={setTab}
                  items={items}
                  site={site}
                  origin={origin}
                  provider={provider}
                  layout={data.layout}
                  lineage={data.lineage}
                  alerts={data.alerts}
                  alertTypes={data.alertTypes}
                  activeByItem={activeAlerts}
                  readOnly={readOnly}
                  alertActions={alertActions}
                  onPick={id => pick(id, false)}
                  onHover={setHover}
                />
              )}
          </div>
        </aside>
        </div>
      </div>

      <footer>
        <span>{site.short_name} · Presentation mode · Readings are synthetic examples, not live</span>
        <span>
          Layout traced from aerial imagery (not surveyed) · v{data.layout.version} ·{' '}
          <button type="button" className="link" aria-expanded={notesOpen} onClick={() => setNotesOpen(o => !o)}>{notesOpen ? 'Hide map notes' : 'Map notes'}</button>
        </span>
        {notesOpen && <ul className="notes">{site.geometry_notes.map(n => <li key={n}>{n}</li>)}</ul>}
      </footer>
    </div>
  );
}
