// Built-in copy of the example site, used ONLY when the local API is unreachable.
// It reads the same file as the backend example provider (data/examples/), so the
// two can't drift. Every value is labelled as an example. It shows the *seed* layout:
// saved map edits, alerts and photos live in the local database and need the API.
import raw from '../../../data/examples/ssu-wsc-campus.example.json';
import type {LngLat} from '../lib/geo';
import type {Layout, Lineage} from '../lib/layout';
import type {MetricInfo, Reading, SegmentSummary, Series, SiteBundle} from '../lib/sensors';

type RawSite = {
  site: SiteBundle['site'];
  sample_window: SiteBundle['site']['sample_window'];
  geometry: SiteBundle['geometry'];
  provider: {id: string; name: string; kind: 'example'};
  layout: {blocks: Layout['blocks']};
  segment_data: Record<string, {description: string; metrics: MetricInfo[]; device_id: string | null}>;
  series: Record<string, Record<string, [string, number][]>>;
};

const data = raw as unknown as RawSite;

export const EMBEDDED_PROVIDER = {
  id: data.provider.id,
  name: `${data.provider.name} (built into the app)`,
  kind: 'example' as const,
  configured: true,
  detail: 'Shown because the local API could not be reached.',
};

export function embeddedSite(): SiteBundle {
  return {site: {...data.site, sample_window: data.sample_window}, geometry: data.geometry, provider: EMBEDDED_PROVIDER};
}

export function embeddedLayout(): {layout: Layout; lineage: Lineage} {
  const blocks = data.layout.blocks.map(b => ({...b, outline: b.outline as LngLat[], rows: b.rows.map(r => ({...r, line: r.line as LngLat[]}))}));
  const lineage: Lineage = {};
  for (const b of blocks) for (const r of b.rows) for (const s of r.segments) {
    lineage[s.id] = {segment_id: s.id, block_id: b.id, row_id: r.id, name: s.name, parent_ids: [], created_version: 1, retired_version: null, created_at: data.sample_window?.end ?? '', retired_at: null};
  }
  return {layout: {site_id: data.site.id, version: 1, saved_at: '', blocks}, lineage};
}

export function embeddedSegments(): SegmentSummary[] {
  return Object.entries(data.segment_data).map(([id, d]) => {
    const latest: Reading[] = d.metrics.map(m => {
      const points = data.series[id]?.[m.metric] ?? [];
      const last = points[points.length - 1];
      return {
        segment_id: id, metric: m.metric, unit: m.unit, source: data.provider.id, is_example: true, inherited: false,
        value: last ? last[1] : null, observed_at: last ? last[0] : null, quality: last ? 'example' : 'missing',
      };
    });
    return {
      segment_id: id, status: latest.some(r => r.quality !== 'missing') ? 'example' : 'no_data', inherited_only: false, is_example: true,
      description: d.description, metrics: d.metrics, latest, ancestors: [], has_own_data: true,
    };
  });
}

export function embeddedHistory(segmentId: string, metric: string): Series[] {
  const d = data.segment_data[segmentId];
  const info = d?.metrics.find(m => m.metric === metric);
  if (!d || !info) throw new Error(`Unknown segment or metric: ${segmentId} / ${metric}`);
  const points = (data.series[segmentId]?.[metric] ?? []).map(([t, v]) => ({t, v}));
  return [{segment_id: segmentId, metric, unit: info.unit, source: data.provider.id, is_example: true, inherited: false, points}];
}
