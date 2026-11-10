import type { VesselRecordFeature } from './vesselRecordAdapter';
import type { RecordValue } from './outbox';
export type OfflineVesselRecordService = {
  enabled(): boolean;
  refresh(): Promise<void>;
  read(id: string): Promise<RecordValue | null>;
  list(vesselId: string): Promise<RecordValue[]>;
  create(value: RecordValue): Promise<RecordValue>;
  update(id: string, value: RecordValue, version?: number): Promise<RecordValue>;
  beforeDelete(id: string): Promise<void>;
  subscribe(listener: () => void): () => void;
};
const unavailable = async (): Promise<never> => {
  throw new Error('Web only');
};
export const offlineVesselRecords = (
  _feature: VesselRecordFeature
): OfflineVesselRecordService => ({
  enabled: () => false,
  refresh: async () => {},
  list: unavailable,
  read: unavailable,
  create: unavailable,
  update: unavailable,
  beforeDelete: async () => {},
  subscribe: () => () => {},
});
