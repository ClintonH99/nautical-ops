import type { RecordValue } from './outbox';
export type OfflineDocuments = {
  enabled(): boolean;
  context(): Promise<RecordValue>;
  scope(): Promise<string>;
  image(url: string): Promise<string | null>;
  help(): Promise<{ id: string; question: string; answer: string; display_order: number }[] | null>;
  updates(): Promise<RecordValue[] | null>;
};
const unavailable = async (): Promise<never> => {
  throw new Error('Web offline documents unavailable');
};
export const offlineDocuments: OfflineDocuments = {
  enabled: () => false,
  context: unavailable,
  scope: unavailable,
  image: unavailable,
  help: unavailable,
  updates: unavailable,
};
