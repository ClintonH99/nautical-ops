import type { RecordValue } from './outbox';
export interface OfflineCrewLeaveService {
  enabled(): boolean;
  subscribe(listener: () => void): () => void;
  refresh(): Promise<void>;
  roster(vesselId: string): Promise<RecordValue[]>;
  list(vesselId: string): Promise<RecordValue[]>;
  read(id: string): Promise<RecordValue | null>;
  create(value: RecordValue): Promise<RecordValue>;
  update(id: string, value: RecordValue, version?: number): Promise<RecordValue>;
  beforeDelete(id: string): Promise<void>;
}
const unavailable = async (): Promise<never> => {
  throw new Error('Web only');
};
export const offlineCrewLeave: OfflineCrewLeaveService = {
  enabled: () => false,
  subscribe: () => () => {},
  refresh: async () => {},
  roster: unavailable,
  list: unavailable,
  read: unavailable,
  create: unavailable,
  update: unavailable,
  beforeDelete: async () => {},
};
