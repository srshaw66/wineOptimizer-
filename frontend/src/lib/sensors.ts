// Normalized, provider-independent shapes. Mirrors backend/app/sensors/models.py and app/store/.
import type {FeatureCollection} from './geo';

export type ProviderKind = 'example' | 'live' | 'import';
export type ReadingQuality = 'example' | 'ok' | 'stale' | 'missing' | 'suspect';
export type DataStatus = 'example' | 'ok' | 'stale' | 'no_data' | 'error';

export interface ProviderInfo {id: string; name: string; kind: ProviderKind; configured: boolean; detail?: string | null}
export interface MetricInfo {metric: string; label: string; unit: string}

export interface Reading {
  segment_id: string;        // segment the value was recorded for (its origin)
  metric: string;
  value: number | null;
  unit: string;
  observed_at: string | null; // ISO-8601 UTC
  quality: ReadingQuality;
  source: string;
  device_id?: string | null;
  is_example: boolean;
  inherited: boolean;        // recorded for an earlier segment this one was split/merged from
}

export interface SegmentSummary {
  segment_id: string;
  status: DataStatus;
  inherited_only: boolean;
  is_example: boolean;
  description: string | null;
  metrics: MetricInfo[];
  latest: Reading[];
  ancestors: string[];
  has_own_data: boolean;
}

export interface Series {segment_id: string; metric: string; unit: string; source: string; is_example: boolean; inherited: boolean; points: {t: string; v: number | null}[]}

export interface SiteFeatureProps {kind: 'landmark'; name: string; accuracy?: string; source?: string}

export interface Site {
  id: string;
  name: string;
  short_name: string;
  institution: string;
  timezone: string;
  is_example: boolean;
  geometry_accuracy: 'surveyed' | 'approximate';
  geometry_notes: string[];
  primary_block_id: string;
  sample_window?: {start: string; end: string; interval_minutes: number} | null;
}

export interface SiteBundle {
  site: Site;
  geometry: FeatureCollection<SiteFeatureProps>; // reference features (landmarks) only
  provider: ProviderInfo;
}

export type Severity = 'low' | 'medium' | 'high';
export type EntityKind = 'site' | 'block' | 'row' | 'segment';

export interface AlertType {id: string; name: string; color: string | null; icon: string | null; default_severity: Severity | null; is_example: boolean; in_use: number}

export interface Alert {
  id: string;
  site_id: string;
  entity_kind: EntityKind;
  entity_id: string;
  type_id: string;
  severity: Severity | null;
  description: string;
  status: 'active' | 'resolved';
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  layout_version: number | null;
  entity_exists: boolean;
  applies_to: string[];      // current entity ids this alert applies to (segments: current descendants)
}

export interface Photo {id: string; segment_id: string; taken_at: string; caption: string | null; uploaded_at: string; edited_at?: string | null; url: string; inherited: boolean; layout_version: number | null}
export type NoteKind = 'observation' | 'correction';
/** Observation note, or a correction annotation about a reading (the reading itself is never changed). */
export interface Note {id: string; segment_id: string; observed_at: string; text: string; kind: NoteKind; refers_to: string | null; created_at: string; edited_at?: string | null; inherited: boolean; layout_version: number | null}

export const QUALITY_LABEL: Record<ReadingQuality, string> = {
  example: 'Example reading',
  ok: 'Live reading',
  stale: 'Stale',
  missing: 'No data',
  suspect: 'Flagged by source',
};

export const STATUS_LABEL: Record<DataStatus, string> = {
  example: 'Example',
  ok: 'Reporting',
  stale: 'Stale',
  no_data: 'No data',
  error: 'Error',
};

export const SEVERITY_LABEL: Record<Severity, string> = {low: 'Low', medium: 'Medium', high: 'High'};
