import type { RecordValue } from './outbox';
export type OfflineDocuments = {
  enabled(): boolean;
  context(): Promise<RecordValue>;
  scope(): Promise<string>;
  image(url: string): Promise<string | null>;
};
const unavailable = async (): Promise<never> => {
  throw new Error('Web offline documents unavailable');
};
export const offlineDocuments: OfflineDocuments = {
  enabled: () => false,
  context: unavailable,
  scope: unavailable,
  image: unavailable,
};
