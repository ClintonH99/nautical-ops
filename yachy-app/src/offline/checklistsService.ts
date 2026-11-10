import type { RecordValue } from './outbox';
export interface OfflineChecklistsService {
  enabled(): boolean;
  subscribe(listener: () => void): () => void;
  refresh(): Promise<void>;
  list(vesselId: string): Promise<RecordValue[]>;
  read(id: string): Promise<RecordValue | null>;
  create(value: RecordValue): Promise<RecordValue>;
  update(id: string, value: RecordValue, version?: number): Promise<RecordValue>;
  add(id: string, label: string, version?: number): Promise<RecordValue>;
  check(itemId: string, checked: boolean, expected?: boolean): Promise<void>;
  beforeDelete(id: string, isItem?: boolean): Promise<void>;
}
const unavailable = async (): Promise<never> => {
  throw new Error('Web only');
};
export const offlineChecklists: OfflineChecklistsService = {
  enabled: () => false,
  subscribe: () => () => {},
  refresh: async () => {},
  list: unavailable,
  read: unavailable,
  create: unavailable,
  update: unavailable,
  add: unavailable,
  check: unavailable,
  beforeDelete: async () => {},
};
