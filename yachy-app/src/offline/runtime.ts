import { create } from 'zustand';
import type { User } from '../types';
export type OfflineStatus = {
  enabled: boolean;
  ready: boolean;
  disconnected: boolean;
  pending: number;
  issue: string | null;
  expiresAt: number | null;
  conflicts: { id: string; title: string }[];
  recoverable: number;
};
export const useOfflineStatus = create<OfflineStatus>(() => ({
  enabled: false,
  ready: false,
  disconnected: false,
  pending: 0,
  issue: null,
  expiresAt: null,
  conflicts: [],
  recoverable: 0,
}));
export async function prepareOffline(_user: User | null): Promise<void> {}
export async function syncOffline(): Promise<void> {}
export async function checkOfflineAccess(): Promise<boolean> {
  return false;
}
export const useOfflineRoute = create<{ name: string | null }>(() => ({ name: null }));
export function setOfflineRoute(_name: string | null): void {}
