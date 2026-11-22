// Layout controls for Options → Vineyard layout. All changes go to a draft until Save.
import type {DrawState, VertexSel} from './MapEditor';
import {updateBlock, updateRow} from './MapEditor';
import {MAX_SEGMENTS, moveBoundary, withSegmentCount, type Layout, type Row, type Segment, type SegmentSourceRef} from '../lib/layout';
import {blockItemId, rowItemId, type TreeItem} from '../lib/hierarchy';

interface Props {
  item: TreeItem;
  draft: Layout;
  saved: Layout;
  drawing: DrawState | null;
  drawPoints: number;
  vertexSel: VertexSel | null;
  pendingCountRow: string | null;
  pendingNameBlock: string | null;
  onDoneBlockName: () => void;
  onDraft: (next: Layout) => void;
  onStartDraw: (d: DrawState) => void;
  onUndoPoint: () => void;
  onFinishDraw: () => void;
  onCancelDraw: () => void;
  onRemoveVertex: () => void;
  onPick: (id: string) => void;
  onHover: (id: string | null) => void;
  onDonePending: () => void;
}

function Counter({row, saved, onChange, label}: {row: Row; saved: Row | undefined; onChange: (r: Row) => void; label: string}) {
  const n = row.segments.length;
  const set = (count: number) => onChange({...row, segments: withSegmentCount(count, saved)});
  return (
    <div className="counter" role="group" aria-label={label}>
      <button type="button" className="btn" onClick={() => set(n - 1)} disabled={n <= 1} aria-label="One fewer segment">−</button>
      <output aria-live="polite"><b>{n}</b> segment{n === 1 ? '' : 's'}</output>
      <button type="button" className="btn" onClick={() => set(n + 1)} disabled={n >= MAX_SEGMENTS} aria-label="One more segment">+</button>
    </div>
  );
}

function RowControls({row, saved, draft, onDraft, highlight}: {row: Row; saved: Row | undefined; draft: Layout; onDraft: (l: Layout) => void; highlight: boolean}) {
  const put = (r: Row) => onDraft(updateRow(draft, row.id, () => r));
  const changed = saved && saved.segments.map(s => s.id).join() !== row.segments.map(s => s.id).join();
  return (
    <div className={`edit-box${highlight ? ' edit-box--prompt' : ''}`}>
      {highlight && (
        <label className="edit-name">New row name
          <input autoFocus value={row.name} maxLength={80} onChange={e => put({...row, name: e.target.value})} />
        </label>
      )}
      <h4>{highlight ? `How many segments for ${row.name || 'this row'}?` : 'Segments'}</h4>
      <Counter row={row} saved={saved} onChange={put} label={`Segments in ${row.name}`} />
      {changed && (
        <p className="fine">
          Saving creates new segments. Their photos, readings and alerts link back to the current segments as <b>inherited</b> history;
          nothing is copied. Return to {saved!.segments.length} to keep the current segments.
        </p>
      )}
      {row.segments.length > 1 && (
        <>
          <p className="fine">Drag the round boundary handles on the map, or use the sliders:</p>
          {row.segments.slice(0, -1).map((s, i) => (
            <label key={`${s.id}-${i}`} className="boundary-slider">
              <span>{s.name} | {row.segments[i + 1].name}</span>
              <input
                type="range" min={0} max={1000} step={1}
                value={Math.round(s.end * 1000)}
                aria-valuetext={`${Math.round(s.end * 100)}% along the row`}
                onChange={e => put({...row, segments: moveBoundary(row.segments, i, Number(e.target.value) / 1000)})}
              />
              <output>{Math.round(s.end * 100)}%</output>
            </label>
          ))}
          <button type="button" className="btn btn--small" onClick={() => put({...row, segments: row.segments.map((s, i, all) => ({...s, start: i / all.length, end: (i + 1) / all.length}))})}>Even spacing</button>
        </>
      )}
      <p className="fine">Boundaries are set by eye. The app does not estimate vegetation density.</p>
    </div>
  );
}

/** Segment description and source/device associations. Part of the layout draft: kept with Save, undone by Cancel. */
export function SegmentMetadataEditor({segment, onChange}: {segment: Segment; onChange: (patch: Partial<Segment>) => void}) {
  const sources = segment.sources;
  const set = (i: number, patch: Partial<SegmentSourceRef>) => onChange({sources: sources.map((s, j) => (j === i ? {...s, ...patch} : s))});
  return (
    <div className="edit-box">
      <h4>Description</h4>
      <label className="edit-name"><span className="sr-only">Segment description</span>
        <textarea rows={2} maxLength={500} value={segment.description ?? ''} placeholder="e.g. vigorous canopy, replanted 2024" onChange={e => onChange({description: e.target.value || null})} />
      </label>
      <h4>Data sources</h4>
      <p className="fine">Optional provider and physical device IDs, so a documented live provider can be attached later. These are labels only; nothing is connected.</p>
      {sources.map((s, i) => (
        <fieldset key={i} className="source-row">
          <legend className="sr-only">Source {i + 1}</legend>
          <label>Provider<input value={s.provider} maxLength={40} onChange={e => set(i, {provider: e.target.value})} /></label>
          <label>Device ID<input value={s.device_id ?? ''} maxLength={80} onChange={e => set(i, {device_id: e.target.value || null})} /></label>
          <label>External ID<input value={s.external_id ?? ''} maxLength={120} onChange={e => set(i, {external_id: e.target.value || null})} /></label>
          <button type="button" className="btn btn--small" onClick={() => onChange({sources: sources.filter((_, j) => j !== i)})}>Remove source</button>
        </fieldset>
      ))}
      <button type="button" className="btn btn--small" onClick={() => onChange({sources: [...sources, {provider: 'thingsboard', device_id: null, external_id: null}]})}>+ Add source</button>
    </div>
  );
}

export default function EditPanel(p: Props) {
  const {item, draft, saved, drawing, onDraft} = p;

  if (drawing) {
    const what = drawing.kind === 'block' ? 'block outline' : drawing.straight ? 'straight row' : 'row';
    const need = drawing.kind === 'block' ? 3 : 2;
    return (
      <div className="edit-panel">
        <div className="edit-box edit-box--prompt" role="status">
          <h4>Drawing a {what}</h4>
          <p>
            {drawing.kind === 'block' && 'Click around the block edge on the map. Add as many points as you need, then click the first point or press Finish.'}
            {drawing.kind === 'row' && drawing.straight && 'Click the row’s start point, then its end point.'}
            {drawing.kind === 'row' && !drawing.straight && 'Click along the row from one end to the other, then press Finish.'}
          </p>
          <p><b>{p.drawPoints}</b> point{p.drawPoints === 1 ? '' : 's'} placed.</p>
          <div className="form-actions">
            <button type="button" className="btn" onClick={p.onUndoPoint} disabled={!p.drawPoints}>Undo point</button>
            <button type="button" className="btn" onClick={p.onCancelDraw}>Cancel drawing</button>
            <button type="button" className="btn btn--primary" onClick={p.onFinishDraw} disabled={p.drawPoints < need}>Finish</button>
          </div>
        </div>
      </div>
    );
  }

  const block = item.block ? draft.blocks.find(b => b.id === item.block!.id) : undefined;
  const row = item.row && block ? block.rows.find(r => r.id === item.row!.id) : undefined;
  const savedRow = row ? saved.blocks.flatMap(b => b.rows).find(r => r.id === row.id) : undefined;
  const seg = item.segment && row ? row.segments.find(s => s.id === item.segment!.id) : undefined;
  const vertexOwner = item.kind === 'block' ? `block:${block?.id}` : row ? `row:${row.id}` : null;
  const canRemoveVertex = p.vertexSel && p.vertexSel.owner === vertexOwner && (item.kind === 'block' ? (block?.outline.length ?? 0) > 3 : (row?.line.length ?? 0) > 2);

  const vertexTools = vertexOwner && (
    <div className="edit-box">
      <h4>{item.kind === 'block' ? 'Outline' : 'Row line'}</h4>
      <p className="fine">
        {item.kind === 'block' ? `${block?.outline.length} points.` : `${row?.line.length} points.`} Drag the square handles to move points; click a “+” to add a point between two;
        double-click or right-click a point to remove it.
      </p>
      <button type="button" className="btn btn--small" disabled={!canRemoveVertex} onClick={p.onRemoveVertex}>Remove selected point</button>
    </div>
  );

  const rename = (value: string) => {
    if (item.kind === 'block' && block) onDraft(updateBlock(draft, block.id, b => ({...b, name: value})));
    if (item.kind === 'row' && row) onDraft(updateRow(draft, row.id, r => ({...r, name: value})));
    if (item.kind === 'segment' && row && seg) onDraft(updateRow(draft, row.id, r => ({...r, segments: r.segments.map(s => (s.id === seg.id ? {...s, name: value} : s))})));
  };
  const nameField = item.kind !== 'site' && (
    <label className="edit-name">Name
      <input value={item.kind === 'block' ? block?.name ?? '' : item.kind === 'row' ? row?.name ?? '' : seg?.name ?? ''} maxLength={80} onChange={e => rename(e.target.value)} />
    </label>
  );

  return (
    <div className="edit-panel">
      <p className="fine">Changes are a draft until you press <b>Save</b> on the map. <b>Cancel</b> restores the last saved layout.</p>

      {item.kind === 'site' && (
        <div className="edit-box">
          <h4>Blocks in this site</h4>
          <ul className="edit-list">
            {draft.blocks.map(b => (
              <li key={b.id}><button type="button" className="link" onClick={() => p.onPick(blockItemId(b.id))} onMouseEnter={() => p.onHover(blockItemId(b.id))} onMouseLeave={() => p.onHover(null)}>{b.name}</button> <span className="muted small">{b.rows.length} rows</span></li>
            ))}
          </ul>
          <button type="button" className="btn btn--primary" onClick={() => p.onStartDraw({kind: 'block'})}>+ Add block</button>
        </div>
      )}

      {!(item.kind === 'block' && p.pendingNameBlock === block?.id) && !(p.pendingCountRow && p.pendingCountRow === row?.id) && nameField}

      {item.kind === 'block' && block && p.pendingNameBlock === block.id && (
        <div className="edit-box edit-box--prompt">
          <h4>Name the new block</h4>
          <label className="edit-name">Block name
            <input autoFocus value={block.name} maxLength={80} onChange={e => rename(e.target.value)} onKeyDown={e => {if (e.key === 'Enter' && block.name.trim()) p.onDoneBlockName();}} />
          </label>
          <p className="fine">Next, add rows inside it. Each row then gets its segments.</p>
          <button type="button" className="btn btn--primary" disabled={!block.name.trim()} onClick={p.onDoneBlockName}>Continue to rows</button>
        </div>
      )}

      {item.kind === 'block' && block && p.pendingNameBlock !== block.id && (
        <>
          {vertexTools}
          <div className={`edit-box${block.rows.length === 0 ? ' edit-box--prompt' : ''}`}>
            <h4>Rows ({block.rows.length})</h4>
            {block.rows.length === 0 && <p className="fine">No rows yet. Draw one along the vines: click points along it, or just its start and end for a straight row.</p>}
            <ul className="edit-list">
              {block.rows.map(r => <li key={r.id}><button type="button" className="link" onClick={() => p.onPick(rowItemId(r.id))} onMouseEnter={() => p.onHover(rowItemId(r.id))} onMouseLeave={() => p.onHover(null)}>{r.name}</button> <span className="muted small">{r.segments.length} segments</span></li>)}
            </ul>
            <div className="form-actions">
              <button type="button" className="btn btn--primary" onClick={() => p.onStartDraw({kind: 'row', blockId: block.id, straight: false})}>+ Draw row</button>
              <button type="button" className="btn" onClick={() => p.onStartDraw({kind: 'row', blockId: block.id, straight: true})}>+ Straight row (start → end)</button>
            </div>
          </div>
          <button type="button" className="btn btn--danger" onClick={() => {
            if (window.confirm(`Remove ${block.name} and its ${block.rows.length} rows from the draft? Their records stay in the database as history.`)) {
              onDraft({...draft, blocks: draft.blocks.filter(b => b.id !== block.id)});
              p.onPick('site');
            }
          }}>Remove block</button>
        </>
      )}

      {(item.kind === 'row' || item.kind === 'segment') && row && block && (
        <>
          {item.kind === 'segment' && <p className="fine">Description and data sources for this segment are under <b>Records</b>.</p>}
          <RowControls row={row} saved={savedRow} draft={draft} onDraft={onDraft} highlight={p.pendingCountRow === row.id} />
          {p.pendingCountRow === row.id && <button type="button" className="btn btn--primary" onClick={p.onDonePending}>Done</button>}
          {item.kind === 'segment'
            ? <button type="button" className="link small" onClick={() => p.onPick(rowItemId(row.id))}>Edit {row.name} line</button>
            : vertexTools}
          {item.kind === 'row' && (
            <button type="button" className="btn btn--danger" onClick={() => {
              if (window.confirm(`Remove ${row.name} from the draft? Its segments' records stay in the database as history.`)) {
                onDraft(updateBlock(draft, block.id, b => ({...b, rows: b.rows.filter(r => r.id !== row.id)})));
                p.onPick(blockItemId(block.id));
              }
            }}>Remove row</button>
          )}
        </>
      )}
    </div>
  );
}
