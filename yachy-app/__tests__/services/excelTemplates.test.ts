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
import { MAX_IMPORT_FILE_BYTES, parseTasksFile } from '../../src/services/excelTemplates';

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

  it('rejects oversized spreadsheet content before parsing it', async () => {
    mockReadAsStringAsync.mockResolvedValue(
      'A'.repeat(Math.ceil(MAX_IMPORT_FILE_BYTES / 3) * 4 + 5)
    );

    const result = await parseTasksFile('file:///oversized.xlsx');

    expect(result.success).toEqual([]);
    expect(result.errors[0]?.message).toContain('10 MB import limit');
  });
});
