import type { RecordValue } from './outbox';
export interface OfflineSeaMilesService {
  enabled(): boolean;
  refresh(): Promise<void>;
  subscribe(listener: () => void): () => void;
  list(review?: boolean): Promise<RecordValue[]>;
  read(id: string): Promise<RecordValue | null>;
  context(): Promise<RecordValue>;
  create(value: RecordValue): Promise<RecordValue>;
  update(id: string, value: RecordValue, version?: number): Promise<void>;
  beforeOnline(): Promise<void>;
}
const unavailable = async (): Promise<never> => {
  throw new Error('Web only');
};
export const offlineSeaMiles: OfflineSeaMilesService = {
  enabled: () => false,
  refresh: async () => {},
  subscribe: () => () => {},
  list: unavailable,
  read: unavailable,
  context: unavailable,
  create: unavailable,
  update: unavailable,
  beforeOnline: async () => {},
};
