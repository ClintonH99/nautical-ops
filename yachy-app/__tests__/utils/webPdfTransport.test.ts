jest.mock('../../src/services/supabase', () => ({ supabase: { auth: { getSession: jest.fn() } } }));
jest.mock('../../src/utils/pdfAsset', () => ({ readPdfAsset: jest.fn(async () => 'logo') }));
jest.mock('../../src/utils/pdfBranding', () => ({ brandPdf: jest.fn(async () => 'JVBERg==') }));
jest.mock('../../assets/sea-miles-pdf-logo-source.png', () => 1);
import { supabase } from '../../src/services/supabase';
import { printStandardPdf } from '../../src/utils/standardPdf.web';
import { brandPdf } from '../../src/utils/pdfBranding';
import { sharePdfFile } from '../../src/utils/sharePdfFile.web';

const originalFetch = global.fetch;
const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;
beforeEach(() => {
  jest.clearAllMocks();
  (supabase.auth.getSession as jest.Mock).mockResolvedValue({
    data: { session: { access_token: 'test-token' } },
  });
  URL.createObjectURL = jest.fn(() => 'blob:pdf');
  URL.revokeObjectURL = jest.fn();
});
afterEach(() => {
  global.fetch = originalFetch;
  URL.createObjectURL = originalCreateObjectURL;
  URL.revokeObjectURL = originalRevokeObjectURL;
});

test('sends an authenticated prepared document and brands real PDF bytes', async () => {
  global.fetch = jest
    .fn()
    .mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-type': 'application/pdf' }),
      arrayBuffer: async () => new Uint8Array([37, 80, 68, 70]).buffer,
    });
  expect(
    await printStandardPdf({
      html: '<html><head></head><body>Test</body></html>',
      title: 'Inventory',
    })
  ).toEqual({ uri: 'blob:pdf' });
  const call = (global.fetch as jest.Mock).mock.calls[0];
  expect(call[0]).toBe('/api/export-pdf');
  expect(call[1].headers.Authorization).toBe('Bearer test-token');
  expect(JSON.parse(call[1].body).html).toContain('nautical-pdf-standard');
  expect(brandPdf).toHaveBeenCalledWith(expect.any(Uint8Array), 'Inventory', 'logo', false);
});
test('does not call the renderer without a session', async () => {
  (supabase.auth.getSession as jest.Mock).mockResolvedValue({ data: { session: null } });
  global.fetch = jest.fn();
  await expect(printStandardPdf({ html: '', title: 'Test' })).rejects.toThrow('sign in');
  expect(global.fetch).not.toHaveBeenCalled();
});
test('rejects expired authorization and SPA fallback responses', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 403 });
  await expect(printStandardPdf({ html: '', title: 'Test' })).rejects.toThrow('authorized device');
  global.fetch = jest
    .fn()
    .mockResolvedValue({ ok: true, headers: new Headers({ 'content-type': 'text/html' }) });
  await expect(printStandardPdf({ html: '', title: 'Test' })).rejects.toThrow('not available');
});
test('downloads with a sanitized filename then releases the blob URL', async () => {
  jest.useFakeTimers();
  const anchor = { href: '', download: '', style: {}, click: jest.fn(), remove: jest.fn() };
  const previous = global.document;
  Object.defineProperty(global, 'document', {
    configurable: true,
    value: { createElement: () => anchor, body: { appendChild: jest.fn() } },
  });
  try {
    await sharePdfFile('blob:pdf', 'Report/name.pdf');
    expect(anchor.download).toBe('Report_name.pdf');
    expect(anchor.click).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    jest.advanceTimersByTime(60_000);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:pdf');
    await expect(sharePdfFile('https://untrusted.invalid', 'test.pdf')).rejects.toThrow();
  } finally {
    Object.defineProperty(global, 'document', { configurable: true, value: previous });
    jest.useRealTimers();
  }
});
