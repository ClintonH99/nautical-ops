import type { OfflineAdapter, RecordValue } from './outbox';
export type PublicationFeature = 'rules' | 'safetyEquipment' | 'musterStations';
const fields = ['id', 'vessel_id', 'title', 'data', 'created_by', 'created_at'];
export const publicationsAdapter: OfflineAdapter = {
  serverFields: ['created_at'],
  validate: (v) =>
    fields.every((k) => k in v) &&
    Object.keys(v).every((k) => fields.includes(k)) &&
    ['id', 'vessel_id', 'title', 'created_at'].every((k) => typeof v[k] === 'string') &&
    String(v.title).trim().length > 0 &&
    (v.created_by === null || typeof v.created_by === 'string') &&
    !!v.data &&
    typeof v.data === 'object' &&
    !Array.isArray(v.data),
  authorizeRead: (s, v) => s.vesselId === v.vessel_id,
  authorize: (s, kind, v, previous) =>
    s.vesselId === v.vessel_id &&
    (kind === 'create'
      ? v.created_by === s.userId
      : !!previous && ['id', 'vessel_id', 'created_by'].every((k) => v[k] === previous.value[k])),
};
export function publicationDeviceCopy(v: RecordValue, id: string, userId: string): RecordValue {
  const title = String(v.title) + ' (device copy)';
  const data = { ...(v.data as RecordValue) };
  if ('title' in data) data.title = title;
  return { ...v, id, title, data, created_by: userId, created_at: new Date().toISOString() };
}
