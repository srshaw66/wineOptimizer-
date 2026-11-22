// Options → Vineyard layout: contextual panel for the selected site / block / row / segment.
//  Layout  – geometry and structure (draft, kept with Save on the map, undone with Cancel).
//  Records – alerts (all levels) and, for segments, photos, notes, description and data sources.
// Uses the same AlertsPanel and SegmentRecords components as the Inspector, so there is one edit path.
import AlertsPanel, {type AlertActions} from './AlertsPanel';
import EditPanel, {SegmentMetadataEditor} from './EditPanel';
import {updateRow} from './MapEditor';
import {NoteManager, PhotoManager, ReadingCards, useSegmentRecords} from './SegmentRecords';
import type {DataOrigin} from '../lib/api';
import {descendants, type Hierarchy, type TreeItem} from '../lib/hierarchy';
import {segmentLabel, type Layout, type Lineage, type Segment} from '../lib/layout';
import type {Alert, AlertType, Site} from '../lib/sensors';

export type LayoutTab = 'Layout' | 'Records';

interface RecordsCtx {
  items: Hierarchy;
  site: Site;
  origin: DataOrigin;
  saved: Layout;
  draft: Layout;
  lineage: Lineage;
  alerts: Alert[];
  alertTypes: AlertType[];
  activeByItem: Map<string, Alert[]>;
  readOnly: string | null;
  alertActions: AlertActions;
  onDraft: (l: Layout) => void;
}

type EditProps = Omit<Parameters<typeof EditPanel>[0], 'item' | 'draft' | 'saved' | 'onDraft'>;

interface Props extends RecordsCtx {
  item: TreeItem;
  tab: LayoutTab;
  onTab: (t: LayoutTab) => void;
  edit: EditProps;
}

function SegmentRecordsManager({item, ...ctx}: {item: TreeItem} & RecordsCtx) {
  const seg = item.segment!;
  const savedHere = Boolean(ctx.lineage[seg.id]);
  const api = useSegmentRecords({siteId: ctx.site.id, segmentId: seg.id, origin: ctx.origin, saved: savedHere, readOnly: ctx.readOnly});
  const label = (id: string) => segmentLabel(id, ctx.saved, ctx.lineage);
  const tz = ctx.site.timezone;
  const draftSeg = ctx.draft.blocks.flatMap(b => b.rows).flatMap(r => r.segments).find(s => s.id === seg.id);
  const patch = (p: Partial<Segment>) => item.row && ctx.onDraft(updateRow(ctx.draft, item.row.id, r => ({...r, segments: r.segments.map(s => (s.id === seg.id ? {...s, ...p} : s))})));
  return (
    <>
      <PhotoManager api={api} tz={tz} label={label} />
      <NoteManager api={api} tz={tz} label={label} metrics={(item.summary?.metrics ?? []).map(m => m.label)} />
      {draftSeg && (
        <>
          <p className="fine section-note">Description and sources are part of the layout: press <b>Save</b> on the map to keep them.</p>
          <SegmentMetadataEditor segment={draftSeg} onChange={patch} />
        </>
      )}
      <div className="records-block">
        <h4>Readings <span className="muted small">(read-only)</span></h4>
        <p className="fine">Values and their timestamps come from the data source and can’t be edited. To flag a wrong value, add a <b>correction note</b> above; the original reading stays as recorded.</p>
        <ReadingCards summary={item.summary} tz={tz} label={label} />
      </div>
    </>
  );
}

export default function OptionsLayoutPanel({item, tab, onTab, edit, ...ctx}: Props) {
  const label = (id: string) => segmentLabel(id, ctx.saved, ctx.lineage);
  const childActive = descendants(ctx.items, item.id).slice(1).reduce((n, id) => n + (ctx.activeByItem.get(id)?.length ?? 0), 0);
  const isSavedEntity = item.kind === 'site' || item.kind === 'segment' ? (item.kind === 'site' || Boolean(ctx.lineage[item.entityId]))
    : (item.kind === 'block' ? ctx.saved.blocks.some(b => b.id === item.entityId) : ctx.saved.blocks.some(b => b.rows.some(r => r.id === item.entityId)));
  const drawing = Boolean(edit.drawing);
  return (
    <div className="options-panel">
      {!drawing && (
        <div className="tab-group" role="tablist" aria-label="Layout panel sections">
          {(['Layout', 'Records'] as LayoutTab[]).map(t => (
            <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? 'active' : ''} onClick={() => onTab(t)}>{t}</button>
          ))}
        </div>
      )}
      {tab === 'Layout' || drawing
        ? <EditPanel item={item} draft={ctx.draft} saved={ctx.saved} onDraft={ctx.onDraft} {...edit} />
        : (
          <div role="tabpanel" aria-label="Records" className="panel-stack">
            {isSavedEntity
              ? <AlertsPanel item={item} alerts={ctx.alerts} types={ctx.alertTypes} timeZone={ctx.site.timezone} readOnly={ctx.readOnly} originLabel={label} childActive={childActive} actions={ctx.alertActions} />
              : <div className="state state--empty"><p>This {item.kind} is new in the unsaved draft. Save the layout to add alerts and records.</p></div>}
            {item.kind === 'segment' && <SegmentRecordsManager item={item} {...ctx} />}
            {item.kind !== 'segment' && <p className="fine">Photos, notes and data sources belong to row segments. Select a segment in the tree or on the map.</p>}
          </div>
        )}
    </div>
  );
}
