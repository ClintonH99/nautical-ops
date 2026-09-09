import {
  calculateRecurringTaskDueDate,
  isTaskRecurrenceAllowed,
  normalizeTaskRecurrence,
  TASK_RECURRENCE_OPTIONS,
} from '../../src/utils/taskRecurrence';

describe('task recurrence rules', () => {
  it('exposes only the approved options for each category', () => {
    expect(TASK_RECURRENCE_OPTIONS.DAILY).toEqual([]);
    expect(TASK_RECURRENCE_OPTIONS.WEEKLY).toEqual(['7_DAYS', '14_DAYS']);
    expect(TASK_RECURRENCE_OPTIONS.MONTHLY).toEqual(['14_DAYS', '30_DAYS']);
  });

  it('validates intervals against their task category', () => {
    expect(isTaskRecurrenceAllowed('WEEKLY', '7_DAYS')).toBe(true);
    expect(isTaskRecurrenceAllowed('WEEKLY', '30_DAYS')).toBe(false);
    expect(isTaskRecurrenceAllowed('MONTHLY', '14_DAYS')).toBe(true);
    expect(isTaskRecurrenceAllowed('MONTHLY', '7_DAYS')).toBe(false);
    expect(isTaskRecurrenceAllowed('DAILY', null)).toBe(false);
  });

  it('normalizes legacy active task values to the approved defaults', () => {
    expect(normalizeTaskRecurrence('DAILY', '7_DAYS')).toBeNull();
    expect(normalizeTaskRecurrence('WEEKLY', null)).toBe('7_DAYS');
    expect(normalizeTaskRecurrence('WEEKLY', '30_DAYS')).toBe('7_DAYS');
    expect(normalizeTaskRecurrence('MONTHLY', null)).toBe('30_DAYS');
    expect(normalizeTaskRecurrence('MONTHLY', '7_DAYS')).toBe('30_DAYS');
  });

  it('calculates due dates without UTC date shifting', () => {
    expect(calculateRecurringTaskDueDate('7_DAYS', '2026-09-04')).toBe('2026-09-11');
    expect(calculateRecurringTaskDueDate('14_DAYS', '2026-12-24')).toBe('2027-01-07');
    expect(calculateRecurringTaskDueDate('30_DAYS', '2026-09-04')).toBe('2026-10-04');
  });
});
