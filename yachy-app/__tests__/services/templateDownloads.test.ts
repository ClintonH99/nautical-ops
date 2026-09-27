/** @jest-environment node */
import * as XLSX from 'xlsx';
import { downloadTemplate, TemplateType } from '../../src/services/excelTemplates';

let mockPlatform = 'web';
const mockWrite = jest.fn();
const mockShare = jest.fn();
const mockAvailable = jest.fn();
jest.mock('react-native', () => ({
  Platform: {
    get OS() {
      return mockPlatform;
    },
  },
  Alert: { alert: jest.fn() },
}));
jest.mock('expo-file-system/legacy', () => ({
  cacheDirectory: 'file:///cache/',
  writeAsStringAsync: (...args: unknown[]) => mockWrite(...args),
}));
jest.mock('expo-sharing', () => ({
  isAvailableAsync: () => mockAvailable(),
  shareAsync: (...args: unknown[]) => mockShare(...args),
}));
const cases: [TemplateType, string][] = [
  ['tasks', 'Tasks'],
  ['maintenance', 'Maintenance_Log'],
  ['yard', 'Shipyard_List'],
  ['inventory', 'Inventory'],
];
const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
let link: {
  href: string;
  download: string;
  style: { display: string };
  click: jest.Mock;
  remove: jest.Mock;
};
let append: jest.Mock;
beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  mockPlatform = 'web';
  mockAvailable.mockResolvedValue(true);
  link = { href: '', download: '', style: { display: '' }, click: jest.fn(), remove: jest.fn() };
  append = jest.fn();
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      createElement: jest.fn(() => link),
      body: { appendChild: append },
    },
  });
  jest.spyOn(URL, 'createObjectURL').mockReturnValue('blob:template');
  jest.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
});
afterEach(() => {
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
  jest.restoreAllMocks();
  if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument);
  else Reflect.deleteProperty(globalThis, 'document');
});
it.each(cases)('downloads a valid %s workbook on web', async (type, label) => {
  await downloadTemplate(type);
  expect(link.download).toBe(`Nautical_Ops_${label}_Template.xlsx`);
  expect(link.href).toBe('blob:template');
  expect(append).toHaveBeenCalledWith(link);
  expect(link.click).toHaveBeenCalledTimes(1);
  expect(link.remove).toHaveBeenCalledTimes(1);
  const blob = jest.mocked(URL.createObjectURL).mock.calls[0][0] as Blob;
  const workbook = XLSX.read(await blob.arrayBuffer(), { type: 'array' });
  expect(workbook.SheetNames).toContain('Info Dump');
  expect(workbook.SheetNames.length).toBeGreaterThan(1);
  expect(mockWrite).not.toHaveBeenCalled();
  expect(mockShare).not.toHaveBeenCalled();
  expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  jest.advanceTimersByTime(60_000);
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:template');
});
it.each(cases)('preserves the native %s sharing path', async (type, label) => {
  mockPlatform = 'ios';
  await downloadTemplate(type);
  expect(mockWrite).toHaveBeenCalledWith(
    `file:///cache/Nautical_Ops_${label}_Template.xlsx`,
    expect.any(String),
    { encoding: 'base64' }
  );
  const workbook = XLSX.read(mockWrite.mock.calls[0][1], { type: 'base64' });
  expect(workbook.SheetNames).toContain('Info Dump');
  expect(mockShare).toHaveBeenCalledTimes(1);
  expect(link.click).not.toHaveBeenCalled();
});
it('cleans up and reports a browser download failure', async () => {
  link.click.mockImplementation(() => {
    throw new Error('Browser failure');
  });
  await expect(downloadTemplate('tasks')).rejects.toThrow('Browser failure');
  expect(link.remove).toHaveBeenCalled();
  jest.advanceTimersByTime(60_000);
  expect(URL.revokeObjectURL).toHaveBeenCalled();
});
