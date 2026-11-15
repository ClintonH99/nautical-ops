import type { RecordValue } from './outbox';
export interface OfflineInventoryService {
  enabled(): boolean;
  subscribe(listener: () => void): () => void;
  refresh(): Promise<void>;
  read(id: string, vesselId?: string): Promise<RecordValue | null>;
  list(vesselId: string): Promise<RecordValue[]>;
  save(
    id: string,
    vesselId: string,
    value: RecordValue,
    base: RecordValue | null
  ): Promise<RecordValue>;
  delete(id: string, remove: () => Promise<void>): Promise<void>;
}
const unavailable = async (): Promise<never> => {
  throw new Error('Web only');
};
export const offlineInventory: OfflineInventoryService = {
  enabled: () => false,
  subscribe: () => () => {},
  refresh: async () => {},
  read: unavailable,
  list: unavailable,
  save: unavailable,
  delete: async (_id, remove) => remove(),
};
