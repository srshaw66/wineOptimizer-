import type {TreeItem} from './hierarchy';
import {itemIdFor} from './hierarchy';
import type {Alert, AlertType, Severity} from './sensors';

const SEV_RANK: Record<Severity, number> = {low: 1, medium: 2, high: 3};

/** Alerts (any status) that belong to an item. Segment alerts include ones inherited through splits/merges. */
export function alertsFor(item: TreeItem, alerts: Alert[]): Alert[] {
  if (item.kind === 'segment') return alerts.filter(a => a.entity_kind === 'segment' && (a.entity_id === item.entityId || a.applies_to.includes(item.entityId)));
  return alerts.filter(a => a.entity_kind === item.kind && a.entity_id === item.entityId);
}

/** Tree item id -> active alerts that apply to it (what the map flags and tree badges show). */
export function activeByItem(alerts: Alert[]): Map<string, Alert[]> {
  const out = new Map<string, Alert[]>();
  for (const a of alerts) {
    if (a.status !== 'active') continue;
    for (const target of a.applies_to) {
      const id = itemIdFor(a.entity_kind, target);
      out.set(id, [...(out.get(id) ?? []), a]);
    }
  }
  return out;
}

export function topSeverity(alerts: Alert[]): Severity | null {
  return alerts.reduce<Severity | null>((best, a) => (a.severity && (!best || SEV_RANK[a.severity] > SEV_RANK[best]) ? a.severity : best), null);
}

export const typeName = (types: Map<string, AlertType>, id: string) => types.get(id)?.name ?? 'Unknown type';
export const typeIcon = (types: Map<string, AlertType>, id: string) => types.get(id)?.icon ?? '⚑';
export const typeColor = (types: Map<string, AlertType>, id: string) => types.get(id)?.color ?? '#5b5f66';
