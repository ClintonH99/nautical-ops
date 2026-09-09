/**
 * Regression tests for spreadsheet parsing and import safety limits.
 * @jest-environment node
 */

const mockReadAsStringAsync = jest.fn();

jest.mock('expo-file-system/legacy', () => ({
  readAsStringAsync: (...args: unknown[]) => mockReadAsStringAsync(...args),
}));
jest.mock('expo-sharing', () => ({}));
jest.mock('react-native', () => ({ Alert: { alert: jest.fn() } }));

import * as XLSX from 'xlsx';
import {
  MAX_IMPORT_FILE_BYTES,
  parseTasksFile,
  parseYardFile,
} from '../../src/services/excelTemplates';

describe('spreadsheet imports', () => {
  afterEach(() => jest.clearAllMocks());

  it('parses a valid task workbook with the patched SheetJS package', async () => {
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([
      ['Department', 'Category', 'Title', 'Notes'],
      ['BRIDGE', 'DAILY', 'Test navigation lights', 'Before departure'],
    ]);
    XLSX.utils.book_append_sheet(workbook, sheet, 'Daily');
    mockReadAsStringAsync.mockResolvedValue(
      XLSX.write(workbook, { type: 'base64', bookType: 'xlsx' })
    );

    await expect(parseTasksFile('file:///tasks.xlsx')).resolves.toEqual({
      success: [
        {
          department: 'BRIDGE',
          category: 'DAILY',
          title: 'Test navigation lights',
          notes: 'Before departure',
          doneByDate: null,
          recurring: null,
        },
      ],
      errors: [],
    });
  });

  it('accepts approved Weekly recurrence and calculates its date at creation time', async () => {
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([
      ['Department', 'Category', 'Title', 'Done By Date', 'Recurring'],
      ['EXTERIOR', 'WEEKLY', 'Wash down', '2030-01-01', '14_DAYS'],
    ]);
    XLSX.utils.book_append_sheet(workbook, sheet, 'Weekly');
    mockReadAsStringAsync.mockResolvedValue(
      XLSX.write(workbook, { type: 'base64', bookType: 'xlsx' })
    );

    const result = await parseTasksFile('file:///weekly.xlsx');

    expect(result.errors).toEqual([]);
    expect(result.success[0]).toEqual(
      expect.objectContaining({
        category: 'WEEKLY',
        recurring: '14_DAYS',
        doneByDate: null,
      })
    );
  });

  it.each([
    ['WEEKLY', '', 'Weekly tasks require 7_DAYS or 14_DAYS'],
    ['MONTHLY', '7_DAYS', 'Monthly tasks require 14_DAYS or 30_DAYS'],
    ['DAILY', '7_DAYS', 'Daily tasks are one-off'],
  ])('rejects %s tasks with recurrence %s', async (category, recurring, message) => {
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([
      ['Department', 'Category', 'Title', 'Recurring'],
      ['BRIDGE', category, 'Invalid task', recurring],
    ]);
    XLSX.utils.book_append_sheet(workbook, sheet, 'Tasks');
    mockReadAsStringAsync.mockResolvedValue(
      XLSX.write(workbook, { type: 'base64', bookType: 'xlsx' })
    );

    const result = await parseTasksFile('file:///invalid-task.xlsx');

    expect(result.success).toEqual([]);
    expect(result.errors[0]?.message).toContain(message);
  });

  it('rejects oversized spreadsheet content before parsing it', async () => {
    mockReadAsStringAsync.mockResolvedValue(
      'A'.repeat(Math.ceil(MAX_IMPORT_FILE_BYTES / 3) * 4 + 5)
    );

    const result = await parseTasksFile('file:///oversized.xlsx');

    expect(result.success).toEqual([]);
    expect(result.errors[0]?.message).toContain('10 MB import limit');
  });

  it('parses Shipyard List jobs with an individual date range', async () => {
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([
      ['Job Title', 'Department', 'Start Date', 'End Date'],
      ['Hull paint', 'EXTERIOR', '2026-09-10', '2026-09-24'],
    ]);
    XLSX.utils.book_append_sheet(workbook, sheet, 'Shipyard List');
    mockReadAsStringAsync.mockResolvedValue(
      XLSX.write(workbook, { type: 'base64', bookType: 'xlsx' })
    );

    await expect(parseYardFile('file:///shipyard.xlsx')).resolves.toEqual({
      success: [
        expect.objectContaining({
          jobTitle: 'Hull paint',
          department: 'EXTERIOR',
          startDate: '2026-09-10',
          endDate: '2026-09-24',
        }),
      ],
      errors: [],
    });
  });

  it('rejects a Shipyard List range ending before it starts', async () => {
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([
      ['Job Title', 'Start Date', 'End Date'],
      ['Invalid range', '2026-09-24', '2026-09-10'],
    ]);
    XLSX.utils.book_append_sheet(workbook, sheet, 'Shipyard List');
    mockReadAsStringAsync.mockResolvedValue(
      XLSX.write(workbook, { type: 'base64', bookType: 'xlsx' })
    );

    const result = await parseYardFile('file:///invalid-shipyard.xlsx');

    expect(result.success).toEqual([]);
    expect(result.errors[0]?.message).toContain('End Date cannot be before Start Date');
  });
});
