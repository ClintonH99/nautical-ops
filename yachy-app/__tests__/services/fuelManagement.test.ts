/** Fuel management service tests @jest-environment node */

const mockRpc = jest.fn();
const mockFrom = jest.fn();

jest.mock('../../src/services/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
    from: (...args: unknown[]) => mockFrom(...args),
  },
}));

import { fuelManagementService } from '../../src/services/fuelManagement';

const tank = {
  id: 'tank-1',
  vessel_id: 'vessel-1',
  name: 'Forward Starboard',
  location: 'Engine room',
  description: '',
  capacity_litres: '12000',
  created_by: 'captain-1',
  created_at: '2026-09-18T10:00:00Z',
  updated_at: '2026-09-18T10:00:00Z',
};

const settings = {
  vessel_id: 'vessel-1',
  volume_unit: 'LITRES',
  created_by: 'captain-1',
  created_at: '2026-09-18T10:00:00Z',
  updated_at: '2026-09-18T10:00:00Z',
};

describe('FuelManagementService', () => {
  beforeEach(() => jest.clearAllMocks());

  it('saves setup through one RPC and maps its refreshed derived capacity', async () => {
    mockRpc.mockResolvedValue({ data: { settings, tanks: [tank] }, error: null });

    const result = await fuelManagementService.saveSetup({
      vesselId: 'vessel-1',
      volumeUnit: 'LITRES',
      tanks: [
        {
          id: 'tank-1',
          name: ' Forward Starboard ',
          location: ' Engine room ',
          description: '',
          capacityLitres: 12000,
        },
      ],
    });

    expect(mockRpc).toHaveBeenCalledWith('save_vessel_fuel_setup', {
      p_vessel_id: 'vessel-1',
      p_volume_unit: 'LITRES',
      p_tanks: [
        {
          id: 'tank-1',
          name: 'Forward Starboard',
          location: 'Engine room',
          description: '',
          capacity_litres: 12000,
        },
      ],
    });
    expect(result.totalCapacityLitres).toBe(12000);
    expect(result.settings?.volumeUnit).toBe('LITRES');
  });

  it('maps retained fuel records with deleted creator profiles to null creators', async () => {
    const settingsMaybeSingle = jest
      .fn()
      .mockResolvedValue({ data: { ...settings, created_by: null }, error: null });
    const settingsEq = jest.fn().mockReturnValue({ maybeSingle: settingsMaybeSingle });
    const settingsSelect = jest.fn().mockReturnValue({ eq: settingsEq });
    const tanksOrder = jest
      .fn()
      .mockResolvedValue({ data: [{ ...tank, created_by: null }], error: null });
    const tanksEq = jest.fn().mockReturnValue({ order: tanksOrder });
    const tanksSelect = jest.fn().mockReturnValue({ eq: tanksEq });
    const transfersSecondOrder = jest.fn().mockResolvedValue({
      data: [
        {
          id: 'transfer-1',
          vessel_id: 'vessel-1',
          source_tank_id: 'tank-1',
          destination_tank_id: 'tank-2',
          amount_litres: 10,
          transfer_date: '2026-09-18',
          transfer_time: '11:00:00',
          location: '',
          notes: '',
          created_by: null,
          created_at: '2026-09-18T11:00:00Z',
          updated_at: '2026-09-18T11:00:00Z',
        },
      ],
      error: null,
    });
    const transfersFirstOrder = jest.fn().mockReturnValue({ order: transfersSecondOrder });
    const transfersEq = jest.fn().mockReturnValue({ order: transfersFirstOrder });
    const transfersSelect = jest.fn().mockReturnValue({ eq: transfersEq });

    mockFrom.mockImplementation((table: string) => {
      if (table === 'vessel_fuel_settings') return { select: settingsSelect };
      if (table === 'fuel_tanks') return { select: tanksSelect };
      if (table === 'fuel_transfers') return { select: transfersSelect };
      throw new Error(`Unexpected table ${table}`);
    });

    const [setup, transfers] = await Promise.all([
      fuelManagementService.getSetup('vessel-1'),
      fuelManagementService.getTransfersByVessel('vessel-1'),
    ]);

    expect(setup.settings?.createdBy).toBeNull();
    expect(setup.tanks[0].createdBy).toBeNull();
    expect(transfers[0].createdBy).toBeNull();
  });

  it('uses the atomic RPC for a tank-aware fuel log and canonical allocations', async () => {
    const log = {
      id: 'fuel-log-1',
      vessel_id: 'vessel-1',
      location_of_refueling: 'Monaco',
      log_date: '2026-09-18',
      log_time: '10:30',
      amount_of_fuel: '2500',
      price_per_gallon: '1.08',
      total_price: '2700',
      volume_unit: 'LITRES',
      currency_code: 'EUR',
      comment: 'Fuel sample stored',
      created_by_name: 'Captain',
      created_at: '2026-09-18T10:30:00Z',
    };
    mockRpc.mockResolvedValue({ data: log, error: null });

    const created = await fuelManagementService.createFuelLogWithTankEntries({
      log: {
        vesselId: 'vessel-1',
        locationOfRefueling: ' Monaco ',
        logDate: '2026-09-18',
        logTime: '10:30',
        amountOfFuel: 2500,
        pricePerGallon: 1.08,
        totalPrice: 2700,
        createdByName: 'Captain',
        volumeUnit: 'LITRES',
        currencyCode: 'eur',
        comment: ' Fuel sample stored ',
      },
      entries: [{ fuelTankId: 'tank-1', amountLitres: 2500 }],
    });

    expect(mockRpc).toHaveBeenCalledWith(
      'create_fuel_log_with_tank_entries',
      expect.objectContaining({
        p_entries: [{ fuel_tank_id: 'tank-1', amount_litres: 2500 }],
        p_log: expect.objectContaining({ volume_unit: 'LITRES', currency_code: 'EUR' }),
      })
    );
    expect(mockRpc.mock.calls[0][1].p_log).not.toHaveProperty('created_by_name');
    expect(created).toMatchObject({ pricePerVolumeUnit: 1.08, currencyCode: 'EUR' });
  });

  it('rejects duplicate tank allocations locally before calling the database', async () => {
    await expect(
      fuelManagementService.createFuelLogWithTankEntries({
        log: {
          vesselId: 'vessel-1',
          locationOfRefueling: 'Monaco',
          logDate: '2026-09-18',
          logTime: '10:30',
          amountOfFuel: 10,
          pricePerGallon: 1,
          totalPrice: 10,
          createdByName: 'Captain',
          volumeUnit: 'LITRES',
        },
        entries: [
          { fuelTankId: 'tank-1', amountLitres: 5 },
          { fuelTankId: 'tank-1', amountLitres: 5 },
        ],
      })
    ).rejects.toThrow('only appear once');
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('maps a batched allocation snapshot with joined tank names and the vessel display unit', async () => {
    const settingsMaybeSingle = jest.fn().mockResolvedValue({ data: settings, error: null });
    const settingsEq = jest.fn().mockReturnValue({ maybeSingle: settingsMaybeSingle });
    const settingsSelect = jest.fn().mockReturnValue({ eq: settingsEq });

    const entriesOrder = jest.fn().mockResolvedValue({
      data: [
        {
          fuel_log_id: 'fuel-log-1',
          fuel_tank_id: 'tank-1',
          amount_litres: '2500.125',
          fuel_tank: { name: 'Forward Starboard' },
        },
        {
          fuel_log_id: 'fuel-log-1',
          fuel_tank_id: 'tank-2',
          amount_litres: 500,
          fuel_tank: [{ name: 'Day Tank' }],
        },
      ],
      error: null,
    });
    const entriesIn = jest.fn().mockReturnValue({ order: entriesOrder });
    const entriesEq = jest.fn().mockReturnValue({ in: entriesIn, order: entriesOrder });
    const entriesSelect = jest.fn().mockReturnValue({ eq: entriesEq });

    mockFrom.mockImplementation((table: string) => {
      if (table === 'vessel_fuel_settings') return { select: settingsSelect };
      if (table === 'fuel_log_tank_entries') return { select: entriesSelect };
      throw new Error(`Unexpected table ${table}`);
    });

    const result = await fuelManagementService.getFuelLogAllocationSnapshot('vessel-1', [
      'fuel-log-1',
      'fuel-log-1',
    ]);

    expect(mockFrom).toHaveBeenCalledTimes(2);
    expect(entriesIn).toHaveBeenCalledWith('fuel_log_id', ['fuel-log-1']);
    expect(entriesOrder).toHaveBeenCalledWith('created_at', { ascending: true });
    expect(result).toEqual({
      displayUnit: 'LITRES',
      allocationsByLogId: {
        'fuel-log-1': [
          {
            fuelLogId: 'fuel-log-1',
            fuelTankId: 'tank-1',
            tankName: 'Forward Starboard',
            amountLitres: 2500.125,
          },
          {
            fuelLogId: 'fuel-log-1',
            fuelTankId: 'tank-2',
            tankName: 'Day Tank',
            amountLitres: 500,
          },
        ],
      },
    });
  });

  it('leaves transfer creator attribution entirely to the server on create and update', async () => {
    const transferRow = {
      id: 'transfer-1',
      vessel_id: 'vessel-1',
      source_tank_id: 'tank-1',
      destination_tank_id: 'tank-2',
      amount_litres: '125',
      transfer_date: '2026-09-18',
      transfer_time: '11:00:00',
      location: 'Engine room',
      notes: 'Balance tanks',
      created_by: 'crew-1',
      created_at: '2026-09-18T11:00:00Z',
      updated_at: '2026-09-18T11:00:00Z',
    };
    const createSingle = jest.fn().mockResolvedValue({ data: transferRow, error: null });
    const createSelect = jest.fn().mockReturnValue({ single: createSingle });
    const insert = jest.fn().mockReturnValue({ select: createSelect });
    const updateSelect = jest.fn().mockResolvedValue({ data: [{ id: 'transfer-1' }], error: null });
    const updateEq = jest.fn().mockReturnValue({ select: updateSelect });
    const update = jest.fn().mockReturnValue({ eq: updateEq });
    mockFrom.mockReturnValueOnce({ insert }).mockReturnValueOnce({ update });

    const input = {
      vesselId: 'vessel-1',
      sourceTankId: 'tank-1',
      destinationTankId: 'tank-2',
      amountLitres: 125,
      transferDate: '2026-09-18',
      transferTime: '11:00',
      location: ' Engine room ',
      notes: ' Balance tanks ',
    };

    const created = await fuelManagementService.createTransfer(input);
    await fuelManagementService.updateTransfer('transfer-1', input);

    expect(insert.mock.calls[0][0]).not.toHaveProperty('created_by');
    expect(update.mock.calls[0][0]).not.toHaveProperty('created_by');
    expect(created.createdBy).toBe('crew-1');
  });
});
