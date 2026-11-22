// Options → Flag types. Edit the example set (Disease, Pest, Irrigation, Damage, Other) or add custom ones.
import {useState} from 'react';
import {SEVERITY_LABEL, type AlertType, type Severity} from '../lib/sensors';
import type {AlertTypeBody} from '../lib/api';

interface Props {
  types: AlertType[];
  icons: string[];
  onCreate: (body: AlertTypeBody) => Promise<void>;
  onUpdate: (id: string, body: AlertTypeBody) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

type Form = {name: string; color: string; icon: string; default_severity: Severity | ''};
const toForm = (t?: AlertType): Form => ({name: t?.name ?? '', color: t?.color ?? '#5b5f66', icon: t?.icon ?? '⚑', default_severity: t?.default_severity ?? ''});

function TypeRow({type, icons, onSave, onDelete}: {type?: AlertType; icons: string[]; onSave: (f: Form) => Promise<void>; onDelete?: () => Promise<void>}) {
  const [form, setForm] = useState<Form>(toForm(type));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = JSON.stringify(form) !== JSON.stringify(toForm(type));
  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setError(null);
    try {await fn();} catch (e) {setError(e instanceof Error ? e.message : 'Failed');} finally {setBusy(false);}
  };
  return (
    <form className="type-row" onSubmit={e => {e.preventDefault(); if (form.name.trim()) run(async () => {await onSave(form); if (!type) setForm(toForm());});}}>
      <label className="sr-only" htmlFor={`icon-${type?.id ?? 'new'}`}>Icon</label>
      <select id={`icon-${type?.id ?? 'new'}`} value={form.icon} onChange={e => setForm(f => ({...f, icon: e.target.value}))} aria-label="Icon">
        {icons.map(i => <option key={i} value={i}>{i}</option>)}
      </select>
      <input aria-label="Name" value={form.name} maxLength={40} placeholder={type ? '' : 'New type name'} onChange={e => setForm(f => ({...f, name: e.target.value}))} required />
      <input aria-label="Color" type="color" value={form.color} onChange={e => setForm(f => ({...f, color: e.target.value}))} />
      <select aria-label="Default severity" value={form.default_severity} onChange={e => setForm(f => ({...f, default_severity: e.target.value as Severity | ''}))}>
        <option value="">No default</option>
        {(['low', 'medium', 'high'] as Severity[]).map(s => <option key={s} value={s}>{SEVERITY_LABEL[s]}</option>)}
      </select>
      <button type="submit" className="btn btn--small btn--primary" disabled={busy || (Boolean(type) && !dirty)}>{type ? 'Save' : 'Add type'}</button>
      {type && onDelete && (
        <button type="button" className="btn btn--small" disabled={busy || type.in_use > 0} title={type.in_use > 0 ? `Used by ${type.in_use} alert(s), including resolved history; it can be edited but not deleted.` : 'Delete this type'} onClick={() => run(onDelete)}>Delete</button>
      )}
      {type && <span className="fine type-meta">{type.is_example ? 'Example type' : 'Custom'} · used {type.in_use}×</span>}
      {error && <p className="form-error" role="alert">{error}</p>}
    </form>
  );
}

/** Options → Flag types: the single place to edit the shared alert/flag types. */
export default function FlagTypesSection({types, icons, alerts, onCreate, onUpdate, onDelete}: Props & {alerts: {type_id: string; status: string}[]}) {
  const body = (f: Form): AlertTypeBody => ({name: f.name.trim(), color: f.color, icon: f.icon, default_severity: f.default_severity || null, clear_default_severity: !f.default_severity});
  const active = (id: string) => alerts.filter(a => a.type_id === id && a.status === 'active').length;
  return (
    <section className="options-page" aria-labelledby="flag-types-title">
      <div className="page-head">
        <div>
          <h1 id="flag-types-title">Flag types</h1>
          <p>Reusable alert types for the site, blocks, rows and segments. Changes apply everywhere the type is used: the Inspector, map flags and history.
            Each flag shows its icon and name as well as its colour.</p>
        </div>
      </div>
      <div className="types-table">
        {types.length === 0 && <p className="fine">Flag types need the local API.</p>}
        {types.map(t => (
          <div key={`${t.id}|${t.name}|${t.color}|${t.icon}|${t.default_severity}|${t.in_use}`} className="type-entry">
            <TypeRow type={t} icons={icons} onSave={f => onUpdate(t.id, body(f))} onDelete={() => onDelete(t.id)} />
            {active(t.id) > 0 && <p className="fine">{active(t.id)} active now</p>}
          </div>
        ))}
      </div>
      <h2 className="options-sub">Add a custom type</h2>
      {icons.length > 0 && <TypeRow icons={icons} onSave={f => onCreate(body(f))} />}
    </section>
  );
}
