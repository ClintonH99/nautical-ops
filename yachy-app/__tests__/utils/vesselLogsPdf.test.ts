const mockPrintToFileAsync = jest.fn();
const mockMoveAsync = jest.fn();
const mockIsAvailableAsync = jest.fn();
const mockShareAsync = jest.fn();

jest.mock('../../src/utils/standardPdf', () => ({
  printStandardPdf: (...args: unknown[]) => mockPrintToFileAsync(...args),
}));

jest.mock('expo-print', () => ({
  printToFileAsync: (...args: unknown[]) => mockPrintToFileAsync(...args),
}));
jest.mock('expo-file-system/legacy', () => ({
  cacheDirectory: 'file:///cache/',
  moveAsync: (...args: unknown[]) => mockMoveAsync(...args),
}));
jest.mock('expo-sharing', () => ({
  isAvailableAsync: (...args: unknown[]) => mockIsAvailableAsync(...args),
  shareAsync: (...args: unknown[]) => mockShareAsync(...args),
}));

import { exportFuelLogPdf } from '../../src/utils/vesselLogsPdf';
import type { FuelLog } from '../../src/types';

describe('fuel log PDF metadata', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrintToFileAsync.mockResolvedValue({ uri: 'file:///tmp/print.pdf' });
    mockMoveAsync.mockResolvedValue(undefined);
    mockIsAvailableAsync.mockResolvedValue(false);
  });

  it('labels mixed units and currencies without inventing a combined total', async () => {
    const base = {
      vesselId: 'vessel-1',
      locationOfRefueling: 'Port Hercules',
      logDate: '2026-09-18',
      logTime: '10:30',
      createdBy: 'user-1',
      createdByName: 'Captain',
      createdAt: '2026-09-18T10:30:00Z',
      comment: '',
    };
    const logs: FuelLog[] = [
      {
        ...base,
        id: 'litres',
        amountOfFuel: 100,
        pricePerGallon: 1.2,
        pricePerVolumeUnit: 1.2,
        priceVolumeUnit: 'LITRES',
        totalPrice: 120,
        volumeUnit: 'LITRES',
        currencyCode: 'EUR',
      },
      {
        ...base,
        id: 'gallons',
        amountOfFuel: 50,
        pricePerGallon: 4,
        pricePerVolumeUnit: 4,
        priceVolumeUnit: 'US_GALLONS',
        totalPrice: 200,
        volumeUnit: 'US_GALLONS',
        currencyCode: 'USD',
      },
    ];

    await exportFuelLogPdf(logs, 'Test Vessel');

    const html = mockPrintToFileAsync.mock.calls[0][0].html as string;
    expect(html).toContain('100 L');
    expect(html).toContain('50 US gal');
    expect(html).toContain('Price / L');
    expect(html).toContain('Price / US gal');
    expect(html).toContain('€1.20');
    expect(html).toContain('$4.00');
    expect(html).toContain('€120.00');
    expect(html).toContain('$200.00');
    expect(html).not.toContain('100 L + 50 US gal');
    expect(html).not.toContain('€120.00 + $200.00');
    expect(html).not.toContain('150.00 gal');
    expect(html).toContain('<h1>Fuel Receipts</h1>');
    expect(html).not.toContain('summary-grid');
    expect(html).not.toContain('Generated');
    expect(html).not.toContain('<p class="subtitle">Test Vessel');
  });

  it('shows only essential fields, preserving historical units and local dates/times', async () => {
    const base = {
      vesselId: 'vessel-1',
      locationOfRefueling: 'Port Hercules',
      logDate: '2026-09-18',
      logTime: '10:30',
      amountOfFuel: 100,
      pricePerGallon: 1,
      pricePerVolumeUnit: 1,
      totalPrice: 100,
      currencyCode: 'USD',
      comment: 'Refuelled before departure.',
      createdBy: 'user-1',
      createdByName: 'Captain',
      createdAt: '2026-09-18T10:30:00Z',
    };
    const logs: FuelLog[] = [
      { ...base, id: 'allocated', volumeUnit: 'LITRES', priceVolumeUnit: 'LITRES' },
      { ...base, id: 'legacy', volumeUnit: null, priceVolumeUnit: 'US_GALLONS' },
    ];
    await exportFuelLogPdf(logs, 'Test Vessel');

    const html = mockPrintToFileAsync.mock.calls[0][0].html as string;
    expect(html).toContain('class="fuel-receipt"');
    for (const label of [
      'Location',
      'Date',
      'Time',
      'Fuel received',
      'Price / Litre',
      'Total purchase',
      'Comment',
    ]) {
      expect(html).toContain(`>${label}<`);
    }
    expect(html).toContain('Port Hercules');
    expect(html).toContain('18 Sep 2026');
    expect(html).toContain('10:30');
    expect(html).toContain('100 L');
    expect(html).toContain('100 US gal');
    expect(html).toContain('Refuelled before departure.');
    for (const removed of [
      'Tank allocation',
      'allocation-panel',
      'Logged by',
      'Captain',
      'Test Vessel',
      'Total fuel',
      'Total cost',
      'border-left',
    ]) {
      expect(html).not.toContain(removed);
    }
    expect(html).toContain('page-break-inside: avoid');
  });

  it('keeps quantity and price units separate and escapes long comments without truncating them', async () => {
    const comment =
      '<script>alert("x")</script> & fuel\n' + 'Full comment. '.repeat(300) + 'END-COMMENT';
    const log: FuelLog = {
      id: 'mixed',
      vesselId: 'vessel',
      locationOfRefueling: 'Port <A> & B',
      logDate: '2026-01-01',
      logTime: '00:05',
      amountOfFuel: 100,
      volumeUnit: 'LITRES',
      priceVolumeUnit: 'US_GALLONS',
      pricePerGallon: 4,
      pricePerVolumeUnit: 4,
      totalPrice: 105.67,
      currencyCode: 'USD',
      comment,
      createdBy: 'crew',
      createdByName: 'Captain',
      createdAt: '2025-12-31T14:05:00Z',
    };
    await exportFuelLogPdf([log], 'Test Vessel');
    const html = mockPrintToFileAsync.mock.calls[0][0].html as string;
    expect(html).toContain('Port &lt;A&gt; &amp; B');
    expect(html).toContain('1 Jan 2026');
    expect(html).toContain('00:05');
    expect(html).toContain('100 L');
    expect(html).toContain('Price / US gal');
    expect(html).toContain('$105.67');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
    expect(html).toContain('END-COMMENT');
    expect(html).toContain('white-space: pre-wrap');
  });

  it('uses the shared branded export and preserves the file sharing workflow', async () => {
    mockIsAvailableAsync.mockResolvedValue(true);
    await exportFuelLogPdf([], 'Test Vessel');
    expect(mockPrintToFileAsync).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Fuel Receipts' })
    );
    expect(mockPrintToFileAsync.mock.calls[0][0].html).toContain('No fuel receipts');
    expect(mockMoveAsync).toHaveBeenCalledWith({
      from: 'file:///tmp/print.pdf',
      to: expect.stringMatching(/Test_Vessel_.*_Fuel_Log\.pdf$/),
    });
    expect(mockShareAsync).toHaveBeenCalledWith(
      expect.stringContaining('Test_Vessel_'),
      expect.objectContaining({ mimeType: 'application/pdf' })
    );
  });
});
