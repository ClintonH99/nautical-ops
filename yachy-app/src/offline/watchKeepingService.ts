import type { RecordValue } from './outbox';
export type WatchFeature = 'watchKeeping' | 'watchKeepingRules';
export interface OfflineWatchService {
  enabled(): boolean;
  subscribe(listener: () => void): () => void;
  refresh(): Promise<void>;
  roster(vesselId: string): Promise<RecordValue[]>;
  canCreate(): Promise<boolean>;
  list(feature: WatchFeature, vesselId: string): Promise<RecordValue[]>;
  read(feature: WatchFeature, id: string): Promise<RecordValue | null>;
  create(feature: WatchFeature, value: RecordValue, id?: string): Promise<RecordValue>;
  update(
    feature: WatchFeature,
    id: string,
    value: RecordValue,
    version?: number
  ): Promise<RecordValue>;
  beforeDelete(id: string): Promise<void>;
}
const unavailable = async (): Promise<never> => {
  throw new Error('Web only');
};
export const offlineWatch: OfflineWatchService = {
  enabled: () => false,
  subscribe: () => () => {},
  refresh: async () => {},
  roster: unavailable,
  canCreate: unavailable,
  list: unavailable,
  read: unavailable,
  create: unavailable,
  update: unavailable,
  beforeDelete: async () => {},
};
