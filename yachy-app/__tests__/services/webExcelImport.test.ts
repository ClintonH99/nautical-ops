const mockNativeRead = jest.fn();
jest.mock('react-native', () => ({ Platform: { OS: 'web' }, Alert: { alert: jest.fn() } }));
jest.mock('expo-file-system/legacy', () => ({
  readAsStringAsync: (...args: unknown[]) => mockNativeRead(...args),
}));
jest.mock('expo-sharing', () => ({}));
import * as XLSX from 'xlsx';
import {
  parseTasksFile,
  parseMaintenanceFile,
  parseYardFile,
  parseInventoryFile,
} from '../../src/services/excelTemplates';

describe('web spreadsheet file reading', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });
  it.each([
    [
      parseTasksFile,
      'Daily',
      ['Department', 'Category', 'Title'],
      ['BRIDGE', 'DAILY', 'Check lights'],
    ],
    [
      parseMaintenanceFile,
      'Maintenance Log',
      ['Equipment', 'Location', 'Service Done By'],
      ['Generator', 'Engine room', 'Test Engineer'],
    ],
    [
      parseYardFile,
      'Shipyard List',
      ['Job Title', 'Department', 'Start Date', 'End Date'],
      ['Hull paint', 'EXTERIOR', '2026-09-27', '2026-09-28'],
    ],
    [
      parseInventoryFile,
      'Bridge',
      ['Title', 'Location', 'Description', 'Quantity', 'Item'],
      ['Supplies', 'Bridge', 'Test', '2', 'Pens'],
    ],
  ] as const)('reads selected browser bytes for %s', async (parser, sheetName, headers, values) => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([Array.from(headers), Array.from(values)]),
      sheetName
    );
    const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
    global.fetch = jest.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => bytes });
    const result = await parser('blob:test-file');
    expect(result.errors).toEqual([]);
    expect(result.success.length).toBeGreaterThan(0);
    expect(mockNativeRead).not.toHaveBeenCalled();
  });
  it('reports an unreadable browser file instead of succeeding silently', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false });
    const result = await parseTasksFile('blob:expired');
    expect(result.success).toEqual([]);
    expect(result.errors[0].message).toContain('Could not read');
  });
});
