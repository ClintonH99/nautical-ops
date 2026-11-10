import type { RecordValue } from './outbox';
import type { DutyFeature } from './watchDutiesAdapter';
export interface OfflineDutiesService {
  enabled(): boolean;
  subscribe(listener: () => void): () => void;
  refresh(): Promise<void>;
  roster(vesselId: string): Promise<RecordValue[]>;
  list(feature: DutyFeature, vesselId: string): Promise<RecordValue[]>;
  create(feature: DutyFeature, value: RecordValue): Promise<RecordValue>;
  update(
    feature: DutyFeature,
    id: string,
    value: RecordValue,
    version?: number
  ): Promise<RecordValue>;
  check(userId: string, itemId: string, checked: boolean, expected?: boolean): Promise<void>;
  beforeDelete(): Promise<void>;
}
const unavailable = async (): Promise<never> => {
  throw new Error('Web only');
};
export const offlineDuties: OfflineDutiesService = {
  enabled: () => false,
  subscribe: () => () => {},
  refresh: async () => {},
  roster: unavailable,
  list: unavailable,
  create: unavailable,
  update: unavailable,
  check: unavailable,
  beforeDelete: async () => {},
};
