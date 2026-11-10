import type { OfflineAdapter } from './outbox';
import { validTripDate } from './tripsAdapter.ts';
import { mergeChecklistItems } from './checklistsAdapter.ts';
export type DutyFeature = 'watchDuties' | 'watchDutyRules' | 'watchDutyChecks' | 'watchAssignments';
const fields: Record<DutyFeature, string[]> = {
  watchDuties: ['id', 'vessel_id', 'title', 'department', 'created_at', 'items'],
  watchDutyRules: ['id', 'vessel_id', 'content', 'updated_at'],
  watchDutyChecks: ['id', 'vessel_id', 'user_id', 'item_id', 'checked', 'updated_at'],
  watchAssignments: ['id', 'vessel_id', 'user_id', 'date', 'start_time', 'end_time', 'created_at'],
};
const time = (v: unknown) => typeof v === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(v);
export function watchDutiesAdapter(feature: DutyFeature): OfflineAdapter {
  return {
    serverFields: [
      feature === 'watchDutyRules' || feature === 'watchDutyChecks' ? 'updated_at' : 'created_at',
    ],
    mergeField: (key, before, next, online) =>
      key === 'items' ? mergeChecklistItems(before, next, online) : undefined,
    validate(v) {
      const keys = fields[feature];
      if (
        !keys.every((k) => k in v) ||
        !Object.keys(v).every((k) => keys.includes(k)) ||
        !keys
          .filter((k) => !['items', 'checked'].includes(k))
          .every((k) => typeof v[k] === 'string')
      )
        return false;
      if (feature === 'watchDutyRules') return v.id === v.vessel_id;
      if (feature === 'watchDutyChecks')
        return v.id === v.item_id && typeof v.checked === 'boolean';
      if (feature === 'watchAssignments')
        return validTripDate(v.date) && time(v.start_time) && time(v.end_time);
      if (
        !String(v.title).trim() ||
        !['BRIDGE', 'ENGINEERING', 'EXTERIOR', 'INTERIOR', 'GALLEY'].includes(
          String(v.department)
        ) ||
        !Array.isArray(v.items)
      )
        return false;
      const ids = new Set();
      return v.items.every((i) => {
        if (
          !i ||
          typeof i !== 'object' ||
          Array.isArray(i) ||
          Object.keys(i).length !== 5 ||
          !['id', 'group_id', 'label', 'created_at'].every((k) => typeof i[k] === 'string') ||
          !Number.isInteger(i.sort_order) ||
          i.group_id !== v.id ||
          ids.has(i.id)
        )
          return false;
        ids.add(i.id);
        return true;
      });
    },
    authorizeRead: (s, v) =>
      v.vessel_id === s.vesselId && (feature !== 'watchDutyChecks' || v.user_id === s.userId),
    authorize: (s, kind, v, old) =>
      v.vessel_id === s.vesselId &&
      (feature !== 'watchDutyChecks' || v.user_id === s.userId) &&
      (kind === 'create' ||
        (!!old &&
          [
            'id',
            'vessel_id',
            ...(feature === 'watchDutyChecks' ? ['user_id', 'item_id'] : []),
          ].every((k) => v[k] === old.value[k]))),
  };
}
