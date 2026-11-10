import type { PublicationFeature } from './publicationsAdapter';
import type { RecordValue } from './outbox';
export type OfflinePublicationsService = {
  enabled(): boolean;
  vesselName(vesselId: string): Promise<string>;
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
export const offlinePublications = (_feature: PublicationFeature): OfflinePublicationsService => ({
  enabled: () => false,
  vesselName: unavailable,
  refresh: async () => {},
  list: unavailable,
  read: unavailable,
  create: unavailable,
  update: unavailable,
  beforeDelete: async () => {},
  subscribe: () => () => {},
});
