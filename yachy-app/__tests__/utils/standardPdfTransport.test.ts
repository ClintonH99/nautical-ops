const mockPrint = jest.fn();
const mockRead = jest.fn();
const mockWrite = jest.fn();
const mockDelete = jest.fn();
const mockBrand = jest.fn();
jest.mock('expo-print', () => ({ printToFileAsync: (...args: unknown[]) => mockPrint(...args) }));
jest.mock('expo-file-system/legacy', () => ({
  EncodingType: { Base64: 'base64' },
  readAsStringAsync: (...args: unknown[]) => mockRead(...args),
  writeAsStringAsync: (...args: unknown[]) => mockWrite(...args),
  deleteAsync: (...args: unknown[]) => mockDelete(...args),
}));
jest.mock('expo-asset', () => ({
  Asset: {
    fromModule: () => ({ localUri: 'file:///logo.png', downloadAsync: async () => undefined }),
  },
}));
jest.mock('../../src/utils/pdfBranding', () => ({
  brandPdf: (...args: unknown[]) => mockBrand(...args),
}));
import { Platform } from 'react-native';
import { printStandardPdf } from '../../src/utils/standardPdf';

describe('native shared PDF export', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRead.mockResolvedValue('logo-base64');
    mockPrint.mockResolvedValue({ uri: 'file:///print.pdf', base64: 'source-base64' });
    mockBrand.mockResolvedValue('branded-base64');
    mockWrite.mockResolvedValue(undefined);
    mockDelete.mockResolvedValue(undefined);
  });
  const html = '<html><head></head><body><h1>Inventory</h1><p>Contents</p></body></html>';

  it('only returns the generated file after branding it with the actual pages', async () => {
    await expect(printStandardPdf({ html, title: 'Inventory' })).resolves.toEqual({
      uri: 'file:///print.pdf',
    });
    expect(mockPrint).toHaveBeenCalledWith(
      expect.objectContaining({
        width: 595.28,
        height: 841.89,
        base64: true,
        margins: { top: 90, left: 36, right: 36, bottom: 32 },
      })
    );
    expect(mockBrand).toHaveBeenCalledWith('source-base64', 'Inventory', 'logo-base64');
    expect(mockWrite).toHaveBeenCalledWith('file:///print.pdf', 'branded-base64', {
      encoding: 'base64',
    });
  });

  it('uses a single margin owner for each native platform', async () => {
    const original = Platform.OS;
    try {
      Platform.OS = 'ios';
      await printStandardPdf({ html, title: 'Inventory' });
      expect(mockPrint.mock.calls[0][0].html).toContain('margin: 0;');
      Platform.OS = 'android';
      await printStandardPdf({ html, title: 'Inventory' });
      expect(mockPrint.mock.calls[1][0].html).toContain('margin: 90pt 36pt 32pt 36pt;');
    } finally {
      Platform.OS = original;
    }
  });

  it('supports the landscape Sea Miles exception', async () => {
    await printStandardPdf({
      html,
      title: 'Personal Sea Service Record',
      orientation: 'landscape',
    });
    expect(mockPrint).toHaveBeenCalledWith(
      expect.objectContaining({ width: 841.89, height: 595.28 })
    );
  });

  it('reserves the compact in-content header once for Hours of Rest', async () => {
    await printStandardPdf({
      html,
      title: 'Hours of Work and Rest',
      orientation: 'landscape',
      headerInContent: true,
    });
    expect(mockPrint).toHaveBeenCalledWith(
      expect.objectContaining({
        width: 841.89,
        height: 595.28,
        margins: { top: 24, left: 36, right: 36, bottom: 32 },
      })
    );
    expect(mockBrand).toHaveBeenCalledWith(
      'source-base64',
      'Hours of Work and Rest',
      'logo-base64',
      true
    );
  });

  it('rejects an incomplete PDF and removes only its temporary output', async () => {
    mockBrand.mockRejectedValue(new Error('Invalid PDF'));
    await expect(printStandardPdf({ html, title: 'Inventory' })).rejects.toThrow('Invalid PDF');
    expect(mockWrite).not.toHaveBeenCalled();
    expect(mockDelete).toHaveBeenCalledWith('file:///print.pdf', { idempotent: true });
  });
});
