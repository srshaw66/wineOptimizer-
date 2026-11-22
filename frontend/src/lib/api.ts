// Data access for the presentation site.
//
// Failures are never swallowed into empty arrays. Callers always learn whether
// data came from the local API or from the built-in example copy, and why.
// Editing, alerts and photos need the local API; the built-in copy is read-only.
import {embeddedHistory, embeddedLayout, embeddedSegments, embeddedSite} from '../data/embeddedExample';
import type {Layout, Lineage} from './layout';
import type {Alert, AlertType, EntityKind, Note, NoteKind, Photo, ProviderInfo, SegmentSummary, Series, Severity, SiteBundle} from './sensors';

export const DEFAULT_SITE_ID = 'ssu-wsc-campus';
const TIMEOUT_MS = 2500;
const site = (id: string) => `/sites/${encodeURIComponent(id)}`;

export class ApiError extends Error {
  constructor(message: string, readonly kind: 'unreachable' | 'http', readonly status?: number) {super(message);}
}

async function request<T>(path: string, init: RequestInit & {timeoutMs?: number} = {}): Promise<T> {
  // Combine caller cancellation with a timeout (manual, for older Safari without AbortSignal.any).
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), init.timeoutMs ?? TIMEOUT_MS);
  const signal = init.signal;
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort, {once: true});
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {...init, signal: controller.signal, headers: {Accept: 'application/json', ...(init.body && !(init.body instanceof FormData) ? {'Content-Type': 'application/json'} : {}), ...init.headers}});
  } catch (error) {
    if (signal?.aborted) throw error; // caller cancelled; not an outage
    throw new ApiError('The local API could not be reached.', 'unreachable');
  } finally {
    window.clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
  const isJson = response.headers.get('content-type')?.includes('application/json') ?? false;
  if (!response.ok && !isJson && response.status >= 500) {
    // e.g. the Vite dev proxy answering for a backend that is not running.
    throw new ApiError('The local API could not be reached.', 'unreachable', response.status);
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null) as {detail?: unknown} | null;
    const detail = body?.detail;
    const message = typeof detail === 'string' ? detail
      : Array.isArray(detail) ? detail.map(d => (d as {msg?: string}).msg).filter(Boolean).join('; ') || `Request failed (${response.status})`
      : (detail as {message?: string} | undefined)?.message ?? `Request failed (${response.status})`;
    throw new ApiError(message, 'http', response.status);
  }
  // A dev proxy with the backend down can answer 200/HTML; treat non-JSON as unreachable.
  if (!isJson) throw new ApiError('The local API returned an unexpected response.', 'unreachable');
  return response.json() as Promise<T>;
}

const send = <T>(method: string, path: string, body?: unknown) =>
  request<T>(path, {method, body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body), timeoutMs: 15000});

export type DataOrigin = 'api' | 'embedded';

export interface SiteData {
  origin: DataOrigin;
  bundle: SiteBundle;
  provider: ProviderInfo;
  layout: Layout;
  lineage: Lineage;
  segments: SegmentSummary[];
  segmentsError: string | null;
  alerts: Alert[];
  alertTypes: AlertType[];
  icons: string[];
  recordsError: string | null;
}

type LayoutPayload = {layout: Layout; lineage: Lineage};

export async function loadSegments(siteId: string, signal?: AbortSignal): Promise<{provider: ProviderInfo; segments: SegmentSummary[]}> {
  return request(`${site(siteId)}/segments`, {signal});
}

/** Load everything for the site. Falls back to the labelled built-in example only when the API is unreachable. */
export async function loadSite(siteId = DEFAULT_SITE_ID, signal?: AbortSignal): Promise<SiteData> {
  let bundle: SiteBundle;
  let layout: LayoutPayload;
  try {
    [bundle, layout] = await Promise.all([request<SiteBundle>(site(siteId), {signal}), request<LayoutPayload>(`${site(siteId)}/layout`, {signal})]);
  } catch (error) {
    if (error instanceof ApiError && error.kind === 'unreachable') {
      const b = embeddedSite();
      const l = embeddedLayout();
      return {origin: 'embedded', bundle: b, provider: b.provider, layout: l.layout, lineage: l.lineage, segments: embeddedSegments(), segmentsError: null, alerts: [], alertTypes: [], icons: [], recordsError: null};
    }
    throw error;
  }
  const [segs, alerts, types] = await Promise.allSettled([
    loadSegments(siteId, signal),
    request<Alert[]>(`${site(siteId)}/alerts`, {signal}),
    request<{types: AlertType[]; icons: string[]}>('/alert-types', {signal}),
  ]);
  if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
  const msg = (r: PromiseSettledResult<unknown>) => (r.status === 'rejected' ? (r.reason instanceof Error ? r.reason.message : 'Request failed') : null);
  return {
    origin: 'api', bundle, layout: layout.layout, lineage: layout.lineage,
    // Geometry loaded but the sensor provider failed: show the map with an explicit error, not "no data".
    provider: segs.status === 'fulfilled' ? segs.value.provider : bundle.provider,
    segments: segs.status === 'fulfilled' ? segs.value.segments : [],
    segmentsError: msg(segs),
    alerts: alerts.status === 'fulfilled' ? alerts.value : [],
    alertTypes: types.status === 'fulfilled' ? types.value.types : [],
    icons: types.status === 'fulfilled' ? types.value.icons : [],
    recordsError: msg(alerts) ?? msg(types),
  };
}

export async function loadHistory(origin: DataOrigin, siteId: string, segmentId: string, metric: string, signal?: AbortSignal): Promise<Series[]> {
  if (origin === 'embedded') return embeddedHistory(segmentId, metric);
  const r = await request<{series: Series[]}>(`${site(siteId)}/segments/${encodeURIComponent(segmentId)}/history?metric=${encodeURIComponent(metric)}`, {signal});
  return r.series;
}

export const loadRecords = (siteId: string, segmentId: string, signal?: AbortSignal) =>
  request<{photos: Photo[]; notes: Note[]}>(`${site(siteId)}/segments/${encodeURIComponent(segmentId)}/records`, {signal});

export interface LayoutSaveBody {base_version: number; blocks: unknown[]}
export const saveLayout = (siteId: string, body: LayoutSaveBody) => send<LayoutPayload>('PUT', `${site(siteId)}/layout`, body);

export const uploadPhoto = (siteId: string, segmentId: string, file: File, takenAt: string, caption: string) => {
  const form = new FormData();
  form.append('file', file);
  if (takenAt) form.append('taken_at', takenAt);
  if (caption) form.append('caption', caption);
  return send<Photo>('POST', `${site(siteId)}/segments/${encodeURIComponent(segmentId)}/photos`, form);
};
export type NoteBody = {text: string; observed_at?: string | null; kind?: NoteKind; refers_to?: string | null};
export const addNote = (siteId: string, segmentId: string, body: NoteBody) =>
  send<Note>('POST', `${site(siteId)}/segments/${encodeURIComponent(segmentId)}/notes`, body);
export const updateNote = (id: string, body: Partial<NoteBody>) => send<Note>('PATCH', `/notes/${encodeURIComponent(id)}`, body);
export const updatePhoto = (id: string, body: {caption?: string | null; taken_at?: string | null}) => send<Photo>('PATCH', `/photos/${encodeURIComponent(id)}`, body);

export const loadAlerts = (siteId: string) => request<Alert[]>(`${site(siteId)}/alerts`);
export const createAlert = (siteId: string, body: {entity_kind: EntityKind; entity_id: string; type_id: string; severity: Severity | null; description: string}) =>
  send<Alert>('POST', `${site(siteId)}/alerts`, body);
export const updateAlert = (id: string, body: {type_id?: string; severity?: Severity | null; clear_severity?: boolean; description?: string}) =>
  send<Alert>('PATCH', `/alerts/${encodeURIComponent(id)}`, body);
export const setAlertResolved = (id: string, resolved: boolean) => send<Alert>('POST', `/alerts/${encodeURIComponent(id)}/${resolved ? 'resolve' : 'reopen'}`);

export const loadAlertTypes = () => request<{types: AlertType[]; icons: string[]}>('/alert-types');
export type AlertTypeBody = {name?: string; color?: string | null; icon?: string | null; default_severity?: Severity | null; clear_default_severity?: boolean};
export const createAlertType = (body: AlertTypeBody) => send<AlertType>('POST', '/alert-types', body);
export const updateAlertType = (id: string, body: AlertTypeBody) => send<AlertType>('PATCH', `/alert-types/${encodeURIComponent(id)}`, body);
export const deleteAlertType = (id: string) => send<{deleted: string}>('DELETE', `/alert-types/${encodeURIComponent(id)}`);
