// Segment records shared by the Inspector and Options → Vineyard layout, so both edit the same records
// through the same calls. Photos and notes are user records (editable). Readings come from the data
// provider and are read-only: a wrong value is annotated with a correction note, never overwritten.
import {useCallback, useEffect, useState, type ReactNode} from 'react';
import {addNote, loadRecords, updateNote, updatePhoto, uploadPhoto, type DataOrigin, type NoteBody} from '../lib/api';
import {formatTime, formatValue} from '../lib/format';
import {typeIcon, typeName} from '../lib/alerts';
import {QUALITY_LABEL, SEVERITY_LABEL, type Alert, type AlertType, type Note, type NoteKind, type Photo, type SegmentSummary} from '../lib/sensors';

export type RecordsState =
  | {status: 'loading'}
  | {status: 'ready'; photos: Photo[]; notes: Note[]}
  | {status: 'error'; message: string}
  | {status: 'unavailable'; reason: string};

export interface SegmentRecordsApi {
  state: RecordsState;
  canAdd: boolean;
  upload: (file: File, when: string, caption: string) => Promise<void>;
  editPhoto: (id: string, body: {caption?: string | null; taken_at?: string | null}) => Promise<void>;
  addNote: (body: NoteBody) => Promise<void>;
  editNote: (id: string, body: Partial<NoteBody>) => Promise<void>;
}

export function useSegmentRecords({siteId, segmentId, origin, saved, readOnly}: {siteId: string; segmentId: string; origin: DataOrigin; saved: boolean; readOnly: string | null}): SegmentRecordsApi {
  const [state, setState] = useState<RecordsState>({status: 'loading'});
  const [serial, setSerial] = useState(0);
  const reason = origin !== 'api' ? 'Photos and notes need the local API.' : !saved ? 'Save the layout to start this segment’s record.' : null;
  useEffect(() => {
    if (reason) {setState({status: 'unavailable', reason}); return;}
    const controller = new AbortController();
    setState(s => (s.status === 'ready' ? s : {status: 'loading'}));
    loadRecords(siteId, segmentId, controller.signal)
      .then(r => setState({status: 'ready', ...r}))
      .catch(e => {if (!controller.signal.aborted) setState({status: 'error', message: e instanceof Error ? e.message : 'Could not load records.'});});
    return () => controller.abort();
  }, [siteId, segmentId, reason, serial]);
  const after = useCallback(async (p: Promise<unknown>) => {await p; setSerial(n => n + 1);}, []);
  return {
    state,
    canAdd: !reason && !readOnly,
    upload: (file, when, caption) => after(uploadPhoto(siteId, segmentId, file, when, caption)),
    editPhoto: (id, body) => after(updatePhoto(id, body)),
    addNote: body => after(addNote(siteId, segmentId, body)),
    editNote: (id, body) => after(updateNote(id, body)),
  };
}

const day = (iso: string, tz: string) => (iso.length === 10 ? iso : formatTime(iso, tz));
const Inherited = ({from}: {from: string}) => <span className="inherited-tag">Inherited from {from}</span>;

function useBusy() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<void>, onOk?: () => void) => {
    setBusy(true); setError(null);
    try {await fn(); onOk?.();} catch (e) {setError(e instanceof Error ? e.message : 'Something went wrong.');} finally {setBusy(false);}
  };
  return {busy, error, run};
}

/* ---------- photos ---------- */

export function PhotoForm({onUpload, replacing}: {onUpload: SegmentRecordsApi['upload']; replacing: boolean}) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [when, setWhen] = useState(() => new Date().toLocaleDateString('en-CA'));
  const [caption, setCaption] = useState('');
  const {busy, error, run} = useBusy();
  if (!open) return <button type="button" className="btn btn--small" onClick={() => setOpen(true)}>{replacing ? 'Replace photo' : '+ Add photo'}</button>;
  return (
    <form className="photo-form" onSubmit={e => {e.preventDefault(); if (file) run(() => onUpload(file, when, caption.trim()), () => {setOpen(false); setFile(null); setCaption('');});}}>
      {replacing && <p className="fine">The new photo becomes the representative photo. Earlier photos stay in the dated history.</p>}
      <label>Image (JPEG, PNG, WebP or GIF, up to 10 MB)<input type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={e => setFile(e.target.files?.[0] ?? null)} required /></label>
      <label>Date taken<input type="date" value={when} onChange={e => setWhen(e.target.value)} required /></label>
      <label>Caption <span className="muted">(optional)</span><input value={caption} maxLength={300} onChange={e => setCaption(e.target.value)} /></label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="form-actions">
        <button type="button" className="btn" onClick={() => setOpen(false)} disabled={busy}>Cancel</button>
        <button type="submit" className="btn btn--primary" disabled={busy || !file}>{busy ? 'Uploading…' : 'Upload photo'}</button>
      </div>
    </form>
  );
}

/** Representative (latest) photo with add/replace. */
export function PhotoHero({api, tz, label, title}: {api: SegmentRecordsApi; tz: string; label: (id: string) => string; title: string}) {
  const photos = api.state.status === 'ready' ? api.state.photos : [];
  const latest = photos[0];
  return (
    <div className="photo-card">
      {latest
        ? (
          <figure>
            <a href={latest.url} target="_blank" rel="noreferrer"><img src={latest.url} alt={latest.caption ?? `Latest photo of ${title}`} /></a>
            <figcaption>
              {latest.caption && <b>{latest.caption}</b>} Taken {day(latest.taken_at, tz)}
              {latest.inherited && <Inherited from={label(latest.segment_id)} />}
              {photos.length > 1 && <span className="muted small"> · {photos.length - 1} earlier in history</span>}
            </figcaption>
          </figure>
        )
        : <div className="photo-empty"><span aria-hidden="true">▧</span><p>{api.state.status === 'loading' ? 'Loading photos…' : 'No photo yet.'}</p></div>}
      {api.canAdd && <PhotoForm onUpload={api.upload} replacing={Boolean(latest)} />}
      {api.state.status === 'unavailable' && <p className="fine">{api.state.reason}</p>}
      {api.state.status === 'error' && <p className="form-error" role="alert">{api.state.message}</p>}
    </div>
  );
}

function PhotoRow({photo, tz, label, canEdit, onEdit}: {photo: Photo; tz: string; label: (id: string) => string; canEdit: boolean; onEdit: SegmentRecordsApi['editPhoto']}) {
  const [editing, setEditing] = useState(false);
  const [caption, setCaption] = useState(photo.caption ?? '');
  const [when, setWhen] = useState(photo.taken_at.slice(0, 10));
  const {busy, error, run} = useBusy();
  return (
    <li className="record-row">
      <a href={photo.url} target="_blank" rel="noreferrer"><img src={photo.url} alt={photo.caption ?? `Photo of ${label(photo.segment_id)}`} className="record-thumb" /></a>
      <div className="record-body">
        {editing
          ? (
            <form className="photo-form" onSubmit={e => {e.preventDefault(); run(() => onEdit(photo.id, {caption, taken_at: when}), () => setEditing(false));}}>
              <label>Caption<input value={caption} maxLength={300} onChange={e => setCaption(e.target.value)} /></label>
              <label>Date taken<input type="date" value={when} onChange={e => setWhen(e.target.value)} required /></label>
              {error && <p className="form-error" role="alert">{error}</p>}
              <div className="form-actions">
                <button type="button" className="btn btn--small" onClick={() => setEditing(false)} disabled={busy}>Cancel</button>
                <button type="submit" className="btn btn--small btn--primary" disabled={busy}>Save</button>
              </div>
            </form>
          )
          : (
            <>
              <b>{photo.caption || 'Untitled photo'}</b>
              <span className="muted small">Taken {day(photo.taken_at, tz)} · uploaded {formatTime(photo.uploaded_at, tz)}{photo.edited_at ? ' · edited' : ''}</span>
              {photo.inherited && <Inherited from={label(photo.segment_id)} />}
              {canEdit && <button type="button" className="btn btn--small" onClick={() => setEditing(true)}>Edit caption / date</button>}
            </>
          )}
      </div>
    </li>
  );
}

export function PhotoManager({api, tz, label}: {api: SegmentRecordsApi; tz: string; label: (id: string) => string}) {
  const photos = api.state.status === 'ready' ? api.state.photos : [];
  return (
    <div className="records-block">
      <h4>Photos <span className="muted small">({photos.length})</span></h4>
      {api.canAdd && <PhotoForm onUpload={api.upload} replacing={photos.length > 0} />}
      {api.state.status === 'unavailable' && <p className="fine">{api.state.reason}</p>}
      {photos.length === 0 && api.state.status === 'ready' && <p className="fine">No photos yet.</p>}
      <ul className="record-list">{photos.map(p => <PhotoRow key={`${p.id}|${p.caption}|${p.taken_at}`} photo={p} tz={tz} label={label} canEdit={api.canAdd} onEdit={api.editPhoto} />)}</ul>
    </div>
  );
}

/* ---------- notes ---------- */

export function NoteForm({initial, submitLabel, metrics, onSubmit, onCancel}: {
  initial?: Partial<NoteBody>; submitLabel: string; metrics: string[]; onSubmit: (b: NoteBody) => Promise<void>; onCancel?: () => void;
}) {
  const [open, setOpen] = useState(Boolean(initial));
  const [text, setText] = useState(initial?.text ?? '');
  const [kind, setKind] = useState<NoteKind>(initial?.kind ?? 'observation');
  const [refersTo, setRefersTo] = useState(initial?.refers_to ?? '');
  const {busy, error, run} = useBusy();
  const close = () => {setOpen(false); setText(''); setKind('observation'); setRefersTo(''); onCancel?.();};
  if (!open) return <button type="button" className="btn btn--small" onClick={() => setOpen(true)}>+ Add note</button>;
  return (
    <form className="photo-form" onSubmit={e => {e.preventDefault(); if (text.trim()) run(() => onSubmit({text: text.trim(), kind, refers_to: kind === 'correction' ? refersTo.trim() || null : null}), close);}}>
      <label>Kind
        <select value={kind} onChange={e => setKind(e.target.value as NoteKind)}>
          <option value="observation">Observation</option>
          <option value="correction">Correction note about a reading</option>
        </select>
      </label>
      {kind === 'correction' && (
        <>
          <p className="fine">The original reading and its timestamp stay unchanged. This note is stored beside it.</p>
          <label>Which reading <span className="muted">(metric and time)</span>
            <input list="note-metrics" value={refersTo} maxLength={200} placeholder="e.g. Soil moisture, Oct 15 11:00 PM" onChange={e => setRefersTo(e.target.value)} />
            <datalist id="note-metrics">{metrics.map(m => <option key={m} value={m} />)}</datalist>
          </label>
        </>
      )}
      <label>Note<textarea rows={3} maxLength={4000} value={text} onChange={e => setText(e.target.value)} required placeholder={kind === 'correction' ? 'What is wrong with the value and why' : 'What you saw in this segment'} /></label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="form-actions">
        <button type="button" className="btn btn--small" onClick={close} disabled={busy}>Cancel</button>
        <button type="submit" className="btn btn--small btn--primary" disabled={busy}>{busy ? 'Saving…' : submitLabel}</button>
      </div>
    </form>
  );
}

export const noteHeading = (n: Note) => (n.kind === 'correction' ? `Correction note${n.refers_to ? ` (${n.refers_to})` : ''}` : 'Observation');

export function NoteManager({api, tz, label, metrics}: {api: SegmentRecordsApi; tz: string; label: (id: string) => string; metrics: string[]}) {
  const [editing, setEditing] = useState<string | null>(null);
  const notes = api.state.status === 'ready' ? api.state.notes : [];
  return (
    <div className="records-block">
      <h4>Notes <span className="muted small">({notes.length})</span></h4>
      {api.canAdd && <NoteForm submitLabel="Save note" metrics={metrics} onSubmit={api.addNote} />}
      {notes.length === 0 && api.state.status === 'ready' && <p className="fine">No notes yet.</p>}
      <ul className="record-list">
        {notes.map(n => (
          <li key={n.id} className="record-row record-row--text">
            {editing === n.id
              ? <NoteForm initial={n} submitLabel="Save changes" metrics={metrics} onSubmit={b => api.editNote(n.id, b)} onCancel={() => setEditing(null)} />
              : (
                <div className="record-body">
                  <b>{noteHeading(n)}</b>
                  <span>{n.text}</span>
                  <span className="muted small">{day(n.observed_at, tz)}{n.edited_at ? ` · edited ${formatTime(n.edited_at, tz)}` : ''}</span>
                  {n.inherited && <Inherited from={label(n.segment_id)} />}
                  {api.canAdd && <button type="button" className="btn btn--small" onClick={() => setEditing(n.id)}>Edit</button>}
                </div>
              )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ---------- readings (read-only) ---------- */

export function ReadingCards({summary, tz, label}: {summary: SegmentSummary | undefined; tz: string; label: (id: string) => string}) {
  return (
    <div className="reading-cards">
      {(summary?.latest ?? []).map(r => {
        const lbl = summary?.metrics.find(m => m.metric === r.metric)?.label ?? r.metric;
        return (
          <div className="reading-card" key={r.metric}>
            <small>{lbl}</small>
            <span className="reading-value">{formatValue(r)}</span>
            <span className={`quality quality--${r.quality}`}>{QUALITY_LABEL[r.quality]}</span>
            <span className="muted small">{formatTime(r.observed_at, tz)}</span>
            {r.inherited && <Inherited from={label(r.segment_id)} />}
          </div>
        );
      })}
      {!summary?.latest.length && <div className="state state--empty"><p>No readings are associated with this segment.</p></div>}
    </div>
  );
}

/* ---------- timeline ---------- */

export function RecordTimeline({api, alerts, types, segmentId, tz, label}: {api: SegmentRecordsApi; alerts: Alert[]; types: AlertType[]; segmentId: string; tz: string; label: (id: string) => string}) {
  const typeMap = new Map(types.map(t => [t.id, t]));
  type Ev = {t: string; key: string; node: ReactNode};
  const events: Ev[] = [];
  if (api.state.status === 'ready') {
    for (const p of api.state.photos) events.push({t: p.taken_at, key: p.id, node: <><b>Photo</b>{p.caption ? `: ${p.caption}` : ''}<a href={p.url} target="_blank" rel="noreferrer"><img src={p.url} alt={p.caption ?? `Photo of ${label(p.segment_id)}`} className="thumb" /></a>{p.inherited && <Inherited from={label(p.segment_id)} />}</>});
    for (const n of api.state.notes) events.push({t: n.observed_at, key: n.id, node: <><b>{noteHeading(n)}</b>: {n.text}{n.inherited && <Inherited from={label(n.segment_id)} />}</>});
  }
  for (const a of alerts) {
    const from = a.entity_id !== segmentId ? <Inherited from={label(a.entity_id)} /> : null;
    events.push({t: a.created_at, key: `${a.id}-c`, node: <><b>{typeIcon(typeMap, a.type_id)} Alert added</b>: {typeName(typeMap, a.type_id)}{a.severity ? ` (${SEVERITY_LABEL[a.severity]})` : ''}, {a.description}{from}</>});
    if (a.resolved_at) events.push({t: a.resolved_at, key: `${a.id}-r`, node: <><b>✓ Alert resolved</b>: {typeName(typeMap, a.type_id)}{from}</>});
  }
  events.sort((a, b) => b.t.localeCompare(a.t));
  return (
    <>
      {api.state.status === 'unavailable' && <p className="fine">{api.state.reason}</p>}
      {api.state.status === 'error' && <p className="state state--error" role="alert">{api.state.message}</p>}
      {events.length === 0 && api.state.status !== 'loading' && <p className="fine">No photos, notes or alerts recorded yet.</p>}
      <ol className="timeline">{events.map(e => <li key={e.key}><time>{day(e.t, tz)}</time><div>{e.node}</div></li>)}</ol>
    </>
  );
}
