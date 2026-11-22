// Alerts for the selected site / block / row / segment, shown at the top of the Inspector.
// Manually entered flags and observations only: no automatic diagnosis or treatment advice.
import {useEffect, useRef, useState, type CSSProperties} from 'react';
import {alertsFor, typeColor, typeIcon, typeName} from '../lib/alerts';
import {formatTime} from '../lib/format';
import type {TreeItem} from '../lib/hierarchy';
import {SEVERITY_LABEL, type Alert, type AlertType, type Severity} from '../lib/sensors';

export interface AlertActions {
  create: (item: TreeItem, body: {type_id: string; severity: Severity | null; description: string}) => Promise<void>;
  update: (id: string, body: {type_id: string; severity: Severity | null; description: string}) => Promise<void>;
  setResolved: (id: string, resolved: boolean) => Promise<void>;
}

interface Props {
  item: TreeItem;
  alerts: Alert[];
  types: AlertType[];
  timeZone: string;
  readOnly: string | null; // reason, when alerts can't be changed
  originLabel: (segmentId: string) => string;
  childActive: number;     // active alerts further down the hierarchy
  actions: AlertActions;
}

type Draft = {type_id: string; severity: Severity | '' ; description: string};

function AlertForm({types, initial, submitLabel, onSubmit, onCancel}: {types: AlertType[]; initial: Draft; submitLabel: string; onSubmit: (d: Draft) => Promise<void>; onCancel: () => void}) {
  const [draft, setDraft] = useState<Draft>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const first = useRef<HTMLSelectElement>(null);
  useEffect(() => {first.current?.focus();}, []);
  const pickType = (type_id: string) => {
    const t = types.find(x => x.id === type_id);
    // Apply the type's default severity unless the user already chose one.
    setDraft(d => ({...d, type_id, severity: d.severity || (t?.default_severity ?? '')}));
  };
  return (
    <form
      className="alert-form"
      onSubmit={async e => {
        e.preventDefault();
        if (!draft.description.trim()) {setError('Add a description.'); return;}
        setBusy(true); setError(null);
        try {await onSubmit(draft);} catch (err) {setError(err instanceof Error ? err.message : 'Could not save the alert.'); setBusy(false);}
      }}
    >
      <label>Type
        <select ref={first} value={draft.type_id} onChange={e => pickType(e.target.value)} required>
          {types.map(t => <option key={t.id} value={t.id}>{t.icon ?? '⚑'} {t.name}</option>)}
        </select>
      </label>
      <label>Severity <span className="muted">(optional)</span>
        <select value={draft.severity} onChange={e => setDraft(d => ({...d, severity: e.target.value as Severity | ''}))}>
          <option value="">Not set</option>
          {(['low', 'medium', 'high'] as Severity[]).map(s => <option key={s} value={s}>{SEVERITY_LABEL[s]}</option>)}
        </select>
      </label>
      <label>Description
        <textarea value={draft.description} rows={3} maxLength={2000} required placeholder="What was observed, where, and by whom" onChange={e => setDraft(d => ({...d, description: e.target.value}))} />
      </label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="form-actions">
        <button type="button" className="btn" onClick={onCancel} disabled={busy}>Cancel</button>
        <button type="submit" className="btn btn--primary" disabled={busy}>{busy ? 'Saving…' : submitLabel}</button>
      </div>
    </form>
  );
}

function AlertCard({alert, types, timeZone, inheritedFrom, readOnly, onEdit, onToggle}: {
  alert: Alert; types: Map<string, AlertType>; timeZone: string; inheritedFrom: string | null; readOnly: boolean;
  onEdit: () => void; onToggle: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const active = alert.status === 'active';
  return (
    <li className={`alert-card alert-card--${alert.status}`} style={{'--flag': typeColor(types, alert.type_id)} as CSSProperties}>
      <div className="alert-card-head">
        <span className="alert-type"><span className="alert-type-icon" aria-hidden="true">{typeIcon(types, alert.type_id)}</span>{typeName(types, alert.type_id)}</span>
        {alert.severity && <span className={`sev sev--${alert.severity}`}>{SEVERITY_LABEL[alert.severity]} severity</span>}
        <span className={`alert-status alert-status--${alert.status}`}>{active ? '● Active' : '✓ Resolved'}</span>
      </div>
      <p className="alert-desc">{alert.description}</p>
      <p className="fine">
        Added {formatTime(alert.created_at, timeZone)}{alert.resolved_at ? ` · resolved ${formatTime(alert.resolved_at, timeZone)}` : ''}
        {inheritedFrom && <><br /><span className="inherited-tag">Inherited from {inheritedFrom}</span></>}
      </p>
      {!readOnly && (
        <div className="alert-actions">
          {active && <button type="button" className="btn btn--small" onClick={onEdit}>Edit</button>}
          <button type="button" className="btn btn--small" disabled={busy} onClick={async () => {setBusy(true); try {await onToggle();} finally {setBusy(false);}}}>
            {active ? 'Resolve' : 'Reopen'}
          </button>
        </div>
      )}
    </li>
  );
}

export default function AlertsPanel({item, alerts, types, timeZone, readOnly, originLabel, childActive, actions}: Props) {
  const [mode, setMode] = useState<{kind: 'add'} | {kind: 'edit'; id: string} | null>(null);
  const typeMap = new Map(types.map(t => [t.id, t]));
  const mine = alertsFor(item, alerts);
  const active = mine.filter(a => a.status === 'active');
  const resolved = mine.filter(a => a.status === 'resolved');
  const inheritedFrom = (a: Alert) => (item.kind === 'segment' && a.entity_id !== item.entityId ? originLabel(a.entity_id) : null);
  const defaultType = types[0];
  useEffect(() => setMode(null), [item.id]);

  return (
    <section className="alerts-section" aria-labelledby="alerts-title">
      <div className="alerts-head">
        <h3 id="alerts-title">Alerts</h3>
        {!readOnly && !mode && types.length > 0 && <button type="button" className="btn btn--small btn--primary" onClick={() => setMode({kind: 'add'})}>+ Add alert</button>}
      </div>
      {readOnly && <p className="fine">{readOnly}</p>}
      {mode?.kind === 'add' && defaultType && (
        <AlertForm
          types={types}
          initial={{type_id: defaultType.id, severity: defaultType.default_severity ?? '', description: ''}}
          submitLabel="Add alert"
          onCancel={() => setMode(null)}
          onSubmit={async d => {await actions.create(item, {type_id: d.type_id, severity: d.severity || null, description: d.description.trim()}); setMode(null);}}
        />
      )}
      {active.length === 0 && mode?.kind !== 'add' && <p className="no-alerts"><span aria-hidden="true">✓</span> No active alerts</p>}
      {active.length > 0 && (
        <ul className="alert-list">
          {active.map(a => (mode?.kind === 'edit' && mode.id === a.id
            ? (
              <li key={a.id}>
                <AlertForm types={types} initial={{type_id: a.type_id, severity: a.severity ?? '', description: a.description}} submitLabel="Save changes" onCancel={() => setMode(null)}
                  onSubmit={async d => {await actions.update(a.id, {type_id: d.type_id, severity: d.severity || null, description: d.description.trim()}); setMode(null);}} />
              </li>
            )
            : <AlertCard key={a.id} alert={a} types={typeMap} timeZone={timeZone} inheritedFrom={inheritedFrom(a)} readOnly={Boolean(readOnly)} onEdit={() => setMode({kind: 'edit', id: a.id})} onToggle={() => actions.setResolved(a.id, true)} />))}
        </ul>
      )}
      {childActive > 0 && <p className="fine">{childActive} more active alert{childActive === 1 ? '' : 's'} on items inside this {item.kind}. Select them in the tree or on the map.</p>}
      {resolved.length > 0 && (
        <details className="resolved">
          <summary>Resolved ({resolved.length})</summary>
          <ul className="alert-list">
            {resolved.map(a => <AlertCard key={a.id} alert={a} types={typeMap} timeZone={timeZone} inheritedFrom={inheritedFrom(a)} readOnly={Boolean(readOnly)} onEdit={() => undefined} onToggle={() => actions.setResolved(a.id, false)} />)}
          </ul>
        </details>
      )}
    </section>
  );
}
