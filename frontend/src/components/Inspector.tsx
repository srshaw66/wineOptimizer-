import {useEffect, useState, type ReactNode} from 'react';
import Sparkline from './Sparkline';
import AlertsPanel, {type AlertActions} from './AlertsPanel';
import {loadHistory, type DataOrigin} from '../lib/api';
import {NoteForm, PhotoHero, ReadingCards, RecordTimeline, useSegmentRecords} from './SegmentRecords';
import {formatRange, formatTime, formatValue} from '../lib/format';
import {alertsFor} from '../lib/alerts';
import {breadcrumb, descendants, segmentsUnder, type Hierarchy, type TreeItem} from '../lib/hierarchy';
import {segmentLabel, type Layout, type Lineage} from '../lib/layout';
import {STATUS_LABEL, type Alert, type AlertType, type ProviderInfo, type SegmentSummary, type Series, type Site} from '../lib/sensors';

export type InspectorTab = 'Details' | 'Trend' | 'History' | 'Segments';
export const tabsFor = (item: TreeItem): InspectorTab[] => (item.kind === 'segment' ? ['Details', 'Trend', 'History'] : ['Details', 'Segments']);

export interface InspectorCtx {
  items: Hierarchy;
  site: Site;
  origin: DataOrigin;
  provider: ProviderInfo;
  layout: Layout;
  lineage: Lineage;
  alerts: Alert[];
  alertTypes: AlertType[];
  activeByItem: Map<string, Alert[]>;
  readOnly: string | null;
  alertActions: AlertActions;
  onPick: (id: string) => void;
  onHover: (id: string | null) => void;
}

interface Props extends InspectorCtx {
  item: TreeItem;
  tab: InspectorTab;
  onTab: (tab: InspectorTab) => void;
}

export const statusChip = (s?: SegmentSummary) => {
  if (!s) return null;
  const text = s.status === 'no_data' ? 'No data' : s.inherited_only ? 'Inherited data' : s.is_example ? 'Example' : STATUS_LABEL[s.status];
  return <span className={`chip chip--${s.status}`}>{text}</span>;
};

export default function Inspector({item, tab, onTab, ...ctx}: Props) {
  const tabs = tabsFor(item);
  const active = tabs.includes(tab) ? tab : 'Details';
  const label = (id: string) => segmentLabel(id, ctx.layout, ctx.lineage);
  const childActive = descendants(ctx.items, item.id).slice(1).reduce((n, id) => n + (ctx.activeByItem.get(id)?.length ?? 0), 0);
  return (
    <section className="inspector" aria-labelledby="inspector-title">
      <div className="inspector-head">
        <h2 id="inspector-title">{item.kind === 'segment' && item.row ? `${item.row.name} · ${item.name}` : item.name}</h2>
        {statusChip(item.summary)}
      </div>
      <p className="muted small">{breadcrumb(ctx.items, item.id) || 'Campus vineyard overview'}</p>
      <AlertsPanel item={item} alerts={ctx.alerts} types={ctx.alertTypes} timeZone={ctx.site.timezone} readOnly={ctx.readOnly} originLabel={label} childActive={childActive} actions={ctx.alertActions} />
      <div className="tab-group" role="tablist" aria-label="Inspector sections">
        {tabs.map(t => (
          <button key={t} type="button" role="tab" aria-selected={active === t} className={active === t ? 'active' : ''} onClick={() => onTab(t)}>{t}</button>
        ))}
      </div>
      <div role="tabpanel" aria-label={active}>
        {item.kind === 'segment'
          ? <SegmentPanels key={item.id} item={item} tab={active} {...ctx} />
          : active === 'Details' ? <AreaDetails item={item} {...ctx} /> : <SegmentList segments={segmentsUnder(ctx.items, item.id)} {...ctx} />}
      </div>
    </section>
  );
}

/* ---------- row / block / site ---------- */

export function AreaDetails({item, items, site, provider, layout}: {item: TreeItem} & InspectorCtx) {
  const segs = segmentsUnder(items, item.id);
  const rows = descendants(items, item.id).filter(id => items.get(id)?.kind === 'row').length;
  const reporting = segs.filter(s => s.summary && s.summary.status !== 'no_data').length;
  const acc = (a?: string) => (a === 'traced' ? 'Traced from aerial imagery (not surveyed)' : a === 'edited' ? 'Edited in this app over imagery (not surveyed)' : a === 'drawn' ? 'Drawn in this app over imagery (not surveyed)' : '—');
  return (
    <>
      <div className="summary-card">
        <span className="metric">{segs.length}</span>
        <span>row segment{segs.length === 1 ? '' : 's'}{item.kind === 'row' ? ' in this row' : ''}</span>
        <small>{reporting} with example readings · {segs.length - reporting} with no data</small>
      </div>
      {item.kind === 'site' && (
        <>
          <Info label="Institution" value={site.institution} />
          <Info label="Location" value="Rohnert Park, California" />
          <Info label="Blocks" value={String(layout.blocks.length)} />
          <Info label="Rows" value={String(rows)} />
          {site.sample_window && <Info label="Sample window" value={formatRange(site.sample_window.start, site.sample_window.end, site.timezone)} />}
          <Info label="Data source" value={provider.name} />
          <Info label="Map layout" value={`Version ${layout.version}${layout.saved_at ? ` · saved ${formatTime(layout.saved_at, site.timezone)}` : ''}`} />
          <Info label="Time zone" value={site.timezone} />
          <ul className="notes">{site.geometry_notes.map(n => <li key={n}>{n}</li>)}</ul>
        </>
      )}
      {item.kind === 'block' && (
        <>
          <Info label="Area" value={item.areaM2 ? `≈ ${Math.round(item.areaM2)} m²` : '—'} />
          <Info label="Rows" value={String(rows)} />
          <Info label="Outline" value={`${acc(item.block?.accuracy)} · ${item.block?.outline.length ?? 0} points`} />
          <Info label="Block ID" value={<code>{item.entityId}</code>} />
        </>
      )}
      {item.kind === 'row' && (
        <>
          <Info label="Length" value={item.lengthM ? `≈ ${item.lengthM.toFixed(1)} m` : '—'} />
          <Info label="Segments" value={String(item.row?.segments.length ?? 0)} />
          <Info label="Geometry" value={acc(item.row?.accuracy)} />
          <Info label="Row ID" value={<code>{item.entityId}</code>} />
        </>
      )}
    </>
  );
}

export function SegmentList({segments, onPick, onHover, activeByItem}: {segments: TreeItem[]} & InspectorCtx) {
  if (!segments.length) return <div className="summary-card"><span>No row segments here yet.</span></div>;
  return (
    <ul className="sensor-list">
      {segments.map(seg => {
        const s = seg.summary;
        const flags = activeByItem.get(seg.id)?.length ?? 0;
        return (
          <li key={seg.id}>
            <button type="button" className="sensor-card" onClick={() => onPick(seg.id)} onMouseEnter={() => onHover(seg.id)} onMouseLeave={() => onHover(null)} onFocus={() => onHover(seg.id)} onBlur={() => onHover(null)}>
              <span className="sensor-card-head">
                <b>{seg.row?.name} · {seg.name}</b>
                {flags > 0 && <span className="flag-count">⚑ {flags} active</span>}
                {statusChip(s)}
              </span>
              <span className="muted small">≈ {seg.lengthM?.toFixed(1)} m of row</span>
              {s && (
                <span className="sensor-card-values">
                  {s.latest.map(r => {
                    const lbl = s.metrics.find(m => m.metric === r.metric)?.label.replace(/ \(.*\)$/, '') ?? r.metric;
                    return <span key={r.metric}><small>{lbl}{r.inherited ? ' (inherited)' : ''}</small><b>{formatValue(r)}</b></span>;
                  })}
                </span>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/* ---------- segment ---------- */

type SeriesState =
  | {key: string; status: 'loading'}
  | {key: string; status: 'ready'; series: Series[]}
  | {key: string; status: 'error'; message: string};

function SegmentPanels({item, tab, site, origin, provider, layout, lineage, alerts, alertTypes, readOnly}: {item: TreeItem; tab: InspectorTab} & InspectorCtx) {
  const summary = item.summary;
  const seg = item.segment!;
  const row = item.row!;
  const label = (id: string) => segmentLabel(id, layout, lineage);
  const isDraftOnly = !lineage[seg.id];
  const records = useSegmentRecords({siteId: site.id, segmentId: seg.id, origin, saved: !isDraftOnly, readOnly});
  const [metric, setMetric] = useState(summary?.metrics[0]?.metric ?? '');
  const [state, setState] = useState<SeriesState | null>(null);
  const [origin_, setOriginSeg] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const key = `${origin}|${seg.id}|${metric}|${retry}`;
  const tz = site.timezone;

  useEffect(() => {
    if (!metric || isDraftOnly) return;
    const controller = new AbortController();
    setState({key, status: 'loading'});
    loadHistory(origin, site.id, seg.id, metric, controller.signal)
      // Guard on the request key so a slow response for another segment/metric can't overwrite this one.
      .then(series => setState(prev => (prev?.key === key ? {key, status: 'ready', series} : prev)))
      .catch(error => {
        if (controller.signal.aborted) return;
        setState(prev => (prev?.key === key ? {key, status: 'error', message: error instanceof Error ? error.message : 'Could not load readings.'} : prev));
      });
    return () => controller.abort();
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const current = state?.key === key ? state : {key, status: 'loading' as const};
  const info = summary?.metrics.find(m => m.metric === metric);
  const ancestors = summary?.ancestors ?? lineage[seg.id]?.parent_ids ?? [];
  const parents = lineage[seg.id]?.parent_ids ?? [];

  const metricPicker = summary && summary.metrics.length > 1 && (
    <div className="segmented" role="group" aria-label="Metric">
      {summary.metrics.map(m => (
        <button key={m.metric} type="button" aria-pressed={m.metric === metric} onClick={() => {setMetric(m.metric); setOriginSeg(null);}}>{m.label.replace(/ \(.*\)$/, '')}</button>
      ))}
    </div>
  );

  const seriesBody = (render: (s: Series) => JSX.Element) => {
    if (isDraftOnly) return <div className="state state--empty"><p>This segment exists only in the unsaved draft.</p></div>;
    if (!summary || !metric) return <div className="state state--empty"><p><b>No readings</b> are associated with this segment.</p></div>;
    if (current.status === 'loading') return <div className="trend-placeholder" role="status">Loading readings…</div>;
    if (current.status === 'error') return (
      <div className="state state--error" role="alert">
        <p>Readings could not be loaded: {current.message}</p>
        <button type="button" className="btn" onClick={() => setRetry(n => n + 1)}>Try again</button>
      </div>
    );
    const withPoints = current.series.filter(s => s.points.length);
    const chosen = withPoints.find(s => s.segment_id === origin_) ?? withPoints.find(s => !s.inherited) ?? withPoints[0];
    if (!chosen) return (
      <div className="state state--empty"><p><b>No readings</b> for {info?.label.toLowerCase() ?? 'this metric'} in the sample window. A real segment in this state would have an offline or not-yet-reporting source.</p></div>
    );
    return (
      <>
        {withPoints.length > 1 && (
          <label className="series-pick">Recorded for
            <select value={chosen.segment_id} onChange={e => setOriginSeg(e.target.value)}>
              {withPoints.map(s => <option key={s.segment_id} value={s.segment_id}>{s.inherited ? `${label(s.segment_id)} (inherited)` : 'This segment'}</option>)}
            </select>
          </label>
        )}
        {chosen.inherited && <p className="inherited-tag">Inherited from {label(chosen.segment_id)}: recorded before this segment was created. Not a new measurement.</p>}
        {render(chosen)}
      </>
    );
  };

  if (tab === 'Trend') return (
    <div className="panel-stack">
      {metricPicker}
      {seriesBody(s => (
        <>
          <Sparkline series={s} label={info?.label ?? metric} timeZone={tz} />
          {s.is_example && <p className="fine">Example series: synthetic hourly values, not measured.</p>}
        </>
      ))}
    </div>
  );

  if (tab === 'History') return (
    <div className="panel-stack">
      <h3 className="section-label">Records</h3>
      {records.canAdd && <NoteForm submitLabel="Save note" metrics={(summary?.metrics ?? []).map(m => m.label)} onSubmit={records.addNote} />}
      <RecordTimeline api={records} alerts={alertsFor(item, alerts)} types={alertTypes} segmentId={seg.id} tz={tz} label={label} />
      <h3 className="section-label">Readings</h3>
      {metricPicker}
      {seriesBody(s => (
        <div className="history">
          {[...s.points].reverse().slice(0, 12).map(p => (
            <div className="history-item" key={p.t}>
              <b>{p.v === null ? '—' : formatValue({value: p.v, unit: s.unit})}</b>
              <span>{formatTime(p.t, tz)}{s.is_example ? ' · example' : ''}{s.inherited ? ' · inherited' : ''}</span>
            </div>
          ))}
          <p className="fine">Latest 12 of {s.points.length} hourly readings in the sample window. Readings are read-only.</p>
        </div>
      ))}
    </div>
  );

  return (
    <>
      <PhotoHero api={records} tz={tz} label={label} title={`${row.name} · ${seg.name}`} />
      {seg.description && <p className="detail-desc"><b>About this segment:</b> {seg.description}</p>}
      {summary?.description && <p className="detail-desc">{summary.description}</p>}
      <ReadingCards summary={summary} tz={tz} label={label} />
      <Info label="Location" value={`${row.name} · ${item.block?.name ?? ''}`} />
      <Info label="Position" value={`${Math.round(seg.start * 100)}–${Math.round(seg.end * 100)}% along the row · ≈ ${item.lengthM?.toFixed(1)} m`} />
      <Info label="Data source" value={`${provider.name}${summary?.is_example ? ' · example' : ''}`} />
      <Info label="Devices" value={seg.sources.length ? seg.sources.map(s => `${s.provider}${s.device_id ? ` · ${s.device_id}` : ''}${s.external_id ? ` · ${s.external_id}` : ''}`).join('; ') + ' (not connected)' : 'None linked'} />
      <Info label="Lineage" value={parents.length ? `From ${parents.map(label).join(', ')} (layout v${lineage[seg.id]?.created_version})` : isDraftOnly ? 'New in unsaved draft' : 'Original segment'} />
      {ancestors.length > parents.length && <Info label="Earlier" value={ancestors.filter(a => !parents.includes(a)).map(label).join(', ')} />}
      <Info label="Segment ID" value={<code>{seg.id}</code>} />
    </>
  );
}

export function Info({label, value}: {label: string; value: ReactNode}) {
  return <div className="info-line"><span>{label}</span><b>{value}</b></div>;
}

