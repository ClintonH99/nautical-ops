const mockPrintToFileAsync = jest.fn();
const mockMoveAsync = jest.fn();
const mockIsAvailableAsync = jest.fn();
const mockShareAsync = jest.fn();

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
import type { FuelLog, FuelLogAllocationSnapshot } from '../../src/types';

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
    expect(html).toContain('100 L + 50 US gal');
    expect(html).toContain('€120.00 + $200.00');
    expect(html).not.toContain('150.00 gal');
    expect(html).toContain('<h1>Fuel Receipts</h1>');
    expect(html).toContain('class="summary-grid"');
    expect(html).not.toContain('Generated');
    expect(html).not.toContain('<p class="subtitle">Test Vessel');
  });

  it('stacks tank allocations in each receipt unit and identifies legacy unallocated rows', async () => {
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
      comment: '',
      createdBy: 'user-1',
      createdByName: 'Captain',
      createdAt: '2026-09-18T10:30:00Z',
    };
    const logs: FuelLog[] = [
      { ...base, id: 'allocated', volumeUnit: 'LITRES', priceVolumeUnit: 'LITRES' },
      { ...base, id: 'legacy', volumeUnit: null, priceVolumeUnit: 'US_GALLONS' },
    ];
    const allocationSnapshot: FuelLogAllocationSnapshot = {
      displayUnit: 'US_GALLONS',
      allocationsByLogId: {
        allocated: [
          {
            fuelLogId: 'allocated',
            fuelTankId: 'tank-1',
            tankName: 'Port & Day Tank',
            amountLitres: 378.5411784,
          },
        ],
      },
    };

    await exportFuelLogPdf(logs, 'Test Vessel', allocationSnapshot);

    const html = mockPrintToFileAsync.mock.calls[0][0].html as string;
    expect(html).toContain('class="receipt-card"');
    expect(html).toContain('class="allocation-panel"');
    expect(html).toContain('Port &amp; Day Tank');
    expect(html).toContain('class="allocation-amount">378.541 L</span>');
    expect(html).toContain('No tank allocation recorded.');
    expect(html).toContain('page-break-inside: avoid');
  });
});
