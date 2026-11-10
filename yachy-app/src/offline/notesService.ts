import type { Note } from '../services/notes';
export type OfflineNotesService = {
  enabled(): boolean;
  list(userId: string): Promise<Note[]>;
  get(id: string): Promise<Note | null>;
  create(
    vesselId: string,
    userId: string,
    title: string,
    content: string,
    name: string
  ): Promise<Note>;
  update(id: string, title: string, content: string, version?: number): Promise<Note>;
  beforeDelete(id: string): Promise<void>;
  subscribe(listener: () => void): () => void;
};
const unavailable = async (): Promise<never> => {
  throw new Error('Web only');
};
export const offlineNotes: OfflineNotesService = {
  enabled: () => false,
  list: unavailable,
  get: unavailable,
  create: unavailable,
  update: unavailable,
  beforeDelete: async () => {},
  subscribe: () => () => {},
};
