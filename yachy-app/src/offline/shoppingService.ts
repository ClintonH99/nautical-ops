import type { RecordValue } from './outbox';
export type OfflineShoppingService = {
  enabled(): boolean;
  list(vesselId: string): Promise<RecordValue[]>;
  create(value: RecordValue): Promise<RecordValue>;
  update(
    id: string,
    value: RecordValue,
    version?: number,
    base?: RecordValue
  ): Promise<RecordValue>;
  delete(id: string, remove: () => Promise<void>): Promise<void>;
  subscribe(listener: () => void): () => void;
};
const unavailable = async (): Promise<never> => {
  throw new Error('Web only');
};
export const offlineShopping: OfflineShoppingService = {
  enabled: () => false,
  list: unavailable,
  create: unavailable,
  update: unavailable,
  delete: async (_id, remove) => remove(),
  subscribe: () => () => {},
};
