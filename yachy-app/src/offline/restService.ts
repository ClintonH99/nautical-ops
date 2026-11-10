import type { RecordValue } from './outbox';
export interface OfflineRestService {
  enabled(): boolean;
  subscribe(listener: () => void): () => void;
  list(userId?: string): Promise<RecordValue[]>;
  roster(vesselId: string): Promise<RecordValue[]>;
  canManage(userId: string, vesselId: string): Promise<boolean>;
  hasSignature(userId: string): Promise<boolean>;
  editor(
    userId: string,
    date: string
  ): Promise<{
    entry: RecordValue | null;
    watchRows: RecordValue[];
    watchVersions: Record<string, string>;
    watchPending: boolean;
  }>;
  save(
    value: RecordValue,
    version: number,
    watchVersions: Record<string, string>
  ): Promise<RecordValue>;
}
const unavailable = async (): Promise<never> => {
  throw new Error('Web only');
};
export const offlineRest: OfflineRestService = {
  enabled: () => false,
  subscribe: () => () => {},
  list: unavailable,
  roster: unavailable,
  canManage: unavailable,
  hasSignature: unavailable,
  editor: unavailable,
  save: unavailable,
};
