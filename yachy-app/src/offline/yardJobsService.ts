import type { RecordValue } from './outbox';
export type OfflineYardJobsService = {
  enabled(): boolean;
  folders(vesselId?: string): Promise<{ folders: RecordValue[]; assignments: RecordValue[] }>;
  beforeOnlineAction(): Promise<void>;
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
export const offlineYardJobs: OfflineYardJobsService = {
  enabled: () => false,
  folders: unavailable,
  beforeOnlineAction: async () => {},
  refresh: async () => {},
  list: unavailable,
  read: unavailable,
  create: unavailable,
  update: unavailable,
  beforeDelete: async () => {},
  subscribe: () => () => {},
};
