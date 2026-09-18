/** Fuel Logs service tests @jest-environment node */

const mockFrom = jest.fn();

jest.mock('../../src/services/supabase', () => ({
  supabase: { from: (...args: unknown[]) => mockFrom(...args) },
}));

import fuelLogsService from '../../src/services/fuelLogs';

const legacyRow = {
  id: 'fuel-log-1',
  vessel_id: 'vessel-1',
  location_of_refueling: 'Monaco',
  log_date: '2026-09-18',
  log_time: '10:30',
  amount_of_fuel: '2500',
  price_per_gallon: '1.08',
  total_price: '2700',
  created_by_name: 'Captain',
  created_at: '2026-09-18T10:30:00Z',
};

describe('FuelLogsService', () => {
  beforeEach(() => jest.clearAllMocks());

  it('maps legacy rows without inventing a volume unit while retaining USD and an empty comment', async () => {
    const single = jest.fn().mockResolvedValue({ data: legacyRow, error: null });
    const eq = jest.fn().mockReturnValue({ single });
    const select = jest.fn().mockReturnValue({ eq });
    mockFrom.mockReturnValue({ select });

    const fuelLog = await fuelLogsService.getById('fuel-log-1');

    expect(fuelLog).toMatchObject({
      volumeUnit: null,
      currencyCode: 'USD',
      comment: '',
      pricePerGallon: 1.08,
      pricePerVolumeUnit: 1.08,
    });
  });

  it('persists additive unit, currency, and comment metadata for new fuel logs', async () => {
    const row = {
      ...legacyRow,
      volume_unit: 'LITRES',
      currency_code: 'EUR',
      comment: '  Fuel sample stored  ',
    };
    const single = jest.fn().mockResolvedValue({ data: row, error: null });
    const select = jest.fn().mockReturnValue({ single });
    const insert = jest.fn().mockReturnValue({ select });
    mockFrom.mockReturnValue({ insert });

    const created = await fuelLogsService.create({
      vesselId: 'vessel-1',
      locationOfRefueling: ' Monaco ',
      logDate: '2026-09-18',
      logTime: '10:30',
      amountOfFuel: 2500,
      pricePerGallon: 1.08,
      totalPrice: 2700,
      createdByName: 'Captain',
      volumeUnit: 'LITRES',
      currencyCode: ' eur ',
      comment: ' Fuel sample stored ',
    });

    expect(mockFrom).toHaveBeenCalledWith('fuel_logs');
    expect(insert).toHaveBeenCalledWith([
      expect.objectContaining({
        volume_unit: 'LITRES',
        currency_code: 'EUR',
        comment: 'Fuel sample stored',
      }),
    ]);
    expect(created).toMatchObject({ volumeUnit: 'LITRES', currencyCode: 'EUR' });
  });

  it('rejects malformed currency codes before a mutation', async () => {
    await expect(
      fuelLogsService.create({
        vesselId: 'vessel-1',
        locationOfRefueling: 'Monaco',
        logDate: '2026-09-18',
        logTime: '10:30',
        amountOfFuel: 1,
        pricePerGallon: 1,
        totalPrice: 1,
        createdByName: 'Captain',
        currencyCode: 'US Dollars',
      })
    ).rejects.toThrow('Currency code');
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('keeps legacy updates compatible without sending server-owned actor fields', async () => {
    const select = jest.fn().mockResolvedValue({ data: [{ id: 'fuel-log-1' }], error: null });
    const eq = jest.fn().mockReturnValue({ select });
    const update = jest.fn().mockReturnValue({ eq });
    mockFrom.mockReturnValue({ update });

    await fuelLogsService.update('fuel-log-1', {
      amountOfFuel: 25,
      comment: ' Corrected legacy record ',
    });

    expect(update).toHaveBeenCalledWith({
      amount_of_fuel: 25,
      comment: 'Corrected legacy record',
    });
    expect(update.mock.calls[0][0]).not.toHaveProperty('created_by');
    expect(update.mock.calls[0][0]).not.toHaveProperty('created_by_name');
  });
});
