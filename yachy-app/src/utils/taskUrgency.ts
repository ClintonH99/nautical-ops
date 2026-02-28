/**
 * Task urgency color based on Done by Date
 * From PROJECT_SPEC: Green 70-100%, Yellow 30-70%, Red 0-30%, Overdue past deadline
 */

import { COLORS } from '../constants/theme';

export type UrgencyLevel = 'GREEN' | 'YELLOW' | 'RED' | 'OVERDUE' | 'NONE';

export function getTaskUrgencyColor(
  doneByDate: string | null,
  createdAt: string,
  status: string
): string {
  if (status === 'COMPLETED') return COLORS.success;
  if (!doneByDate) return COLORS.gray400; // No deadline = neutral

  const now = Date.now();
  const end = new Date(doneByDate).getTime();
  const start = new Date(createdAt).getTime();

  if (now > end) return COLORS.danger; // OVERDUE
  const total = end - start;
  const remaining = end - now;
  const percentRemaining = total > 0 ? (remaining / total) * 100 : 0;

  if (percentRemaining >= 70) return COLORS.success;   // GREEN
  if (percentRemaining >= 30) return COLORS.warning;   // YELLOW
  return COLORS.danger;                                 // RED (0-30%)
}

export function getUrgencyLevel(
  doneByDate: string | null,
  createdAt: string,
  status: string
): UrgencyLevel {
  if (status === 'COMPLETED') return 'GREEN';
  if (!doneByDate) return 'NONE';

  const now = Date.now();
  const end = new Date(doneByDate).getTime();
  const start = new Date(createdAt).getTime();

  if (now > end) return 'OVERDUE';
  const total = end - start;
  const remaining = end - now;
  const percentRemaining = total > 0 ? (remaining / total) * 100 : 0;

  if (percentRemaining >= 70) return 'GREEN';
  if (percentRemaining >= 30) return 'YELLOW';
  return 'RED';
}
