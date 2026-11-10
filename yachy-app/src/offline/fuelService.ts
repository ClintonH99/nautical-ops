import type { FuelFeature } from './fuelAdapter';
import type { RecordValue } from './outbox';
export type OfflineFuelService = {
  enabled(): boolean;
  subscribe(listener: () => void): () => void;
  context(vesselId?: string): Promise<RecordValue>;
  list(feature: FuelFeature, vesselId?: string): Promise<RecordValue[]>;
  read(feature: FuelFeature, id: string): Promise<RecordValue | null>;
  save(
    feature: FuelFeature,
    vesselId: string,
    fields: RecordValue,
    entries: RecordValue[],
    id?: string,
    version?: number,
    reason?: string
  ): Promise<RecordValue>;
  beforeOnline(feature?: FuelFeature, id?: string): Promise<string | undefined>;
};
const unavailable = async (): Promise<never> => {
  throw new Error('Web offline storage is unavailable');
};
export const offlineFuel: OfflineFuelService = {
  enabled: () => false,
  subscribe: () => () => {},
  context: unavailable,
  list: unavailable,
  read: unavailable,
  save: unavailable,
  beforeOnline: unavailable,
};
