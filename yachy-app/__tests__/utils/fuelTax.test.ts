import { fuelReceiptTotals, validFuelTaxPercentage } from '../../src/utils/fuelTax';
import { buildFuelLogHtml } from '../../src/utils/vesselLogsPdf';
import type { FuelLog } from '../../src/types';

describe('manual fuel receipt tax', () => {
  it('matches the supplied receipt: rounded net then percentage then total', () => {
    expect(fuelReceiptTotals(930 * 6.1564, 6)).toEqual({
      subtotal: 5725.45,
      taxAmount: 343.53,
      totalPrice: 6068.98,
    });
  });
  it('supports blank, zero, fractional percentages and half-cent rounding', () => {
    expect(fuelReceiptTotals(100, null).totalPrice).toBe(100);
    expect(fuelReceiptTotals(100, 0).taxAmount).toBe(0);
    expect(fuelReceiptTotals(100, 7.125).taxAmount).toBe(7.13);
    expect(fuelReceiptTotals(1.005, 0).subtotal).toBe(1.01);
  });
  it('rejects invalid rates and amounts instead of saving NaN or a truncated rate', () => {
    for (const rate of [-1, 101, NaN, Infinity, 6.12345]) {
      expect(validFuelTaxPercentage(rate)).toBe(false);
      expect(() => fuelReceiptTotals(100, rate)).toThrow();
    }
    expect(() => fuelReceiptTotals(-1, 6)).toThrow();
  });
  it('exports tax and gross total without changing earlier receipts', () => {
    const log = {
      locationOfRefueling: 'Port',
      logDate: '2026-11-16',
      logTime: '10:00',
      amountOfFuel: 930,
      pricePerVolumeUnit: 6.1564,
      priceVolumeUnit: 'US_GALLONS',
      volumeUnit: 'US_GALLONS',
      totalPrice: 6068.98,
      taxPercentage: 6,
      taxAmount: 343.53,
      currencyCode: 'USD',
      comment: '',
    } as FuelLog;
    const html = buildFuelLogHtml([log]);
    expect(html).toContain('Tax (6%)');
    expect(html).toContain('343.53');
    expect(html).toContain('6,068.98');
    expect(buildFuelLogHtml([{ ...log, taxPercentage: null, taxAmount: 0 }])).not.toContain(
      'Subtotal before tax'
    );
  });
});
