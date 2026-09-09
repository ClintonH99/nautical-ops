import { TaskCategory, TaskRecurring } from '../types';
import { parseLocalDate, toYYYYMMDD } from './index';

export type RecurringInterval = Exclude<TaskRecurring, null>;

export const TASK_RECURRENCE_OPTIONS: Record<TaskCategory, RecurringInterval[]> = {
  DAILY: [],
  WEEKLY: ['7_DAYS', '14_DAYS'],
  MONTHLY: ['14_DAYS', '30_DAYS'],
};

export const TASK_RECURRENCE_LABELS: Record<RecurringInterval, string> = {
  '7_DAYS': '7 Days',
  '14_DAYS': '14 Days',
  '30_DAYS': '30 Days',
};

export function isTaskRecurrenceAllowed(
  category: TaskCategory,
  recurring: TaskRecurring
): recurring is RecurringInterval {
  return recurring !== null && TASK_RECURRENCE_OPTIONS[category].includes(recurring);
}

export function getDefaultTaskRecurrence(category: TaskCategory): TaskRecurring {
  if (category === 'WEEKLY') return '7_DAYS';
  if (category === 'MONTHLY') return '30_DAYS';
  return null;
}

export function normalizeTaskRecurrence(
  category: TaskCategory,
  recurring: TaskRecurring
): TaskRecurring {
  if (category === 'DAILY') return null;
  return isTaskRecurrenceAllowed(category, recurring)
    ? recurring
    : getDefaultTaskRecurrence(category);
}

export function getTaskRecurrenceDays(recurring: RecurringInterval): number {
  if (recurring === '7_DAYS') return 7;
  if (recurring === '14_DAYS') return 14;
  return 30;
}

function dateOnlyLikeToLocalDate(from: Date | string): Date {
  if (typeof from === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(from)) {
    return parseLocalDate(from);
  }

  const parsed = typeof from === 'string' ? new Date(from) : new Date(from);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error('Cannot calculate a task due date from an invalid date.');
  }
  return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
}

export function calculateRecurringTaskDueDate(
  recurring: RecurringInterval,
  from: Date | string = new Date()
): string {
  const date = dateOnlyLikeToLocalDate(from);
  date.setDate(date.getDate() + getTaskRecurrenceDays(recurring));
  return toYYYYMMDD(date);
}
