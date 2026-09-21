/** Fuel management service tests @jest-environment node */

const mockRpc = jest.fn();
const mockFrom = jest.fn();

jest.mock('expo-crypto', () => ({
  randomUUID: jest.fn().mockReturnValue('11111111-1111-4111-8111-111111111111'),
}));

jest.mock('../../src/services/fuelRequestId', () => ({
  getFuelRequestStorageKey: jest.fn().mockResolvedValue('test:fuel-request'),
  acquireFuelRequest: jest.fn(async (_scope: string, _payload: unknown, preferredId?: string) => ({
    id: preferredId ?? '11111111-1111-4111-8111-111111111111',
    storageKey: 'test:fuel-request',
  })),
  completeFuelRequest: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../src/services/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
    from: (...args: unknown[]) => mockFrom(...args),
    auth: {
      getSession: jest.fn().mockResolvedValue({
        data: { session: { user: { id: 'captain-1' } } },
        error: null,
      }),
    },
  },
}));

import { fuelManagementService } from '../../src/services/fuelManagement';
import {
  acquireFuelRequest,
  completeFuelRequest,
  getFuelRequestStorageKey,
} from '../../src/services/fuelRequestId';

const mockAcquireFuelRequest = jest.mocked(acquireFuelRequest);
const mockCompleteFuelRequest = jest.mocked(completeFuelRequest);
const mockGetFuelRequestStorageKey = jest.mocked(getFuelRequestStorageKey);

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
  setup_revision: 3,
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
      expectedRevision: 3,
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
      p_expected_revision: 3,
      p_client_request_id: '11111111-1111-4111-8111-111111111111',
    });
    expect(result.totalCapacityLitres).toBe(12000);
    expect(result.settings?.volumeUnit).toBe('LITRES');
  });

  it('maps retained fuel records with deleted creator profiles to null creators', async () => {
    mockRpc.mockImplementation(async (name: string) => {
      if (name === 'get_vessel_fuel_setup') {
        return {
          data: {
            settings: { ...settings, created_by: null },
            tanks: [{ ...tank, created_by: null }],
          },
          error: null,
        };
      }
      if (name === 'get_fuel_transfers_with_snapshots') {
        return {
          data: {
            vessel_id: 'vessel-1',
            transfers: [
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
                operation_id: 'operation-1',
                source_tank_name: 'Port Tank at transfer time',
                destination_tank_name: 'Day Tank at transfer time',
                snapshot_source: 'LEDGER',
              },
            ],
          },
          error: null,
        };
      }
      throw new Error(`Unexpected RPC ${name}`);
    });

    const [setup, transfers] = await Promise.all([
      fuelManagementService.getSetup('vessel-1'),
      fuelManagementService.getTransfersByVessel('vessel-1'),
    ]);

    expect(setup.settings?.createdBy).toBeNull();
    expect(setup.settings?.setupRevision).toBe(3);
    expect(setup.tanks[0].createdBy).toBeNull();
    expect(transfers[0].createdBy).toBeNull();
    expect(transfers[0]).toMatchObject({
      sourceTankName: 'Port Tank at transfer time',
      destinationTankName: 'Day Tank at transfer time',
      ledgerOperationId: 'operation-1',
    });
    expect(mockRpc).toHaveBeenCalledWith('get_vessel_fuel_setup', {
      p_vessel_id: 'vessel-1',
    });
    expect(mockRpc).toHaveBeenCalledWith('get_fuel_transfers_with_snapshots', {
      p_vessel_id: 'vessel-1',
    });
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
      effective_at: '2026-09-18T00:30:00.000Z',
      utc_offset_minutes: 600,
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
      'create_fuel_receipt_with_tanks',
      expect.objectContaining({
        p_entries: [{ fuel_tank_id: 'tank-1', amount_litres: 2500 }],
        p_log: expect.objectContaining({
          volume_unit: 'LITRES',
          price_volume_unit: 'LITRES',
          currency_code: 'EUR',
          client_request_id: '11111111-1111-4111-8111-111111111111',
          effective_at: expect.any(String),
          utc_offset_minutes: expect.any(Number),
        }),
      })
    );
    expect(mockRpc.mock.calls[0][1].p_log).not.toHaveProperty('created_by_name');
    expect(created).toMatchObject({
      pricePerVolumeUnit: 1.08,
      currencyCode: 'EUR',
      effectiveAt: '2026-09-18T00:30:00.000Z',
      utcOffsetMinutes: 600,
    });
  });

  it('creates new tanks and their receipt allocations through the same atomic RPC', async () => {
    mockRpc.mockResolvedValue({
      data: {
        id: 'fuel-log-inline-1',
        vessel_id: 'vessel-1',
        location_of_refueling: 'Monaco',
        log_date: '2026-09-18',
        log_time: '10:30',
        amount_of_fuel: '5000',
        price_per_gallon: '5.15',
        price_volume_unit: 'US_GALLONS',
        total_price: '6802.43',
        volume_unit: 'LITRES',
        currency_code: 'USD',
        comment: '',
        created_at: '2026-09-18T10:30:00Z',
      },
      error: null,
    });

    const created = await fuelManagementService.createFuelLogWithTankEntries({
      log: {
        vesselId: 'vessel-1',
        locationOfRefueling: 'Monaco',
        logDate: '2026-09-18',
        logTime: '10:30',
        amountOfFuel: 5000,
        pricePerGallon: 5.15,
        priceVolumeUnit: 'US_GALLONS',
        totalPrice: 6802.43,
        createdByName: 'Captain',
        volumeUnit: 'LITRES',
        currencyCode: 'USD',
        comment: '',
      },
      entries: [
        { fuelTankId: 'tank-1', amountLitres: 1000 },
        { fuelTankId: '22222222-2222-4222-8222-222222222222', amountLitres: 4000 },
      ],
      newTanks: [
        {
          id: '22222222-2222-4222-8222-222222222222',
          name: ' Forward Starboard ',
          location: ' Engine room ',
          description: ' Main bunker ',
          capacityLitres: 12000,
          openingLitres: 250,
        },
      ],
      expectedSetupRevision: 4,
    });

    expect(mockRpc).toHaveBeenCalledWith(
      'create_fuel_receipt_with_tanks',
      expect.objectContaining({
        p_expected_setup_revision: 4,
        p_new_tanks: [
          {
            id: '22222222-2222-4222-8222-222222222222',
            name: 'Forward Starboard',
            location: 'Engine room',
            description: 'Main bunker',
            capacity_litres: 12000,
            opening_litres: 250,
          },
        ],
        p_log: expect.objectContaining({
          price_volume_unit: 'US_GALLONS',
          client_request_id: '11111111-1111-4111-8111-111111111111',
        }),
      })
    );
    expect(created.priceVolumeUnit).toBe('US_GALLONS');
  });

  it('normalizes repeating US-gallon conversions to the three-decimal litre ledger scale', async () => {
    const logRow = {
      id: 'fuel-log-us-1',
      vessel_id: 'vessel-1',
      location_of_refueling: 'Newport',
      log_date: '2026-09-18',
      log_time: '10:30',
      amount_of_fuel: '1',
      price_per_gallon: '5',
      total_price: '5',
      volume_unit: 'US_GALLONS',
      currency_code: 'USD',
      comment: '',
      created_at: '2026-09-18T10:30:00Z',
    };
    mockRpc.mockResolvedValue({ data: logRow, error: null });

    const log = {
      vesselId: 'vessel-1',
      locationOfRefueling: 'Newport',
      logDate: '2026-09-18',
      logTime: '10:30',
      amountOfFuel: 1,
      pricePerGallon: 5,
      totalPrice: 5,
      createdByName: 'Captain',
      volumeUnit: 'US_GALLONS' as const,
      currencyCode: 'USD',
      comment: '',
    };
    const entries = [{ fuelTankId: 'tank-1', amountLitres: 3.785411784 }];

    await fuelManagementService.createFuelLogWithTankEntries({ log, entries });
    await fuelManagementService.updateFuelLogWithTankEntries('fuel-log-us-1', {
      vesselId: 'vessel-1',
      log,
      entries,
      effectiveAt: '2026-09-18T00:30:00.000Z',
      utcOffsetMinutes: 600,
      expectedRevision: 1,
      amendmentReason: 'Corrected delivery ticket',
    });

    expect(mockRpc).toHaveBeenNthCalledWith(
      1,
      'create_fuel_receipt_with_tanks',
      expect.objectContaining({
        p_log: expect.objectContaining({ amount_of_fuel: 1 }),
        p_entries: [{ fuel_tank_id: 'tank-1', amount_litres: 3.785 }],
      })
    );
    expect(mockRpc).toHaveBeenNthCalledWith(
      2,
      'update_fuel_log_with_tank_entries',
      expect.objectContaining({
        p_log_patch: expect.objectContaining({ amount_of_fuel: 1 }),
        p_entries: [{ fuel_tank_id: 'tank-1', amount_litres: 3.785 }],
      })
    );
  });

  it('derives an unlimited multi-tank parent amount from canonical child litres', async () => {
    mockRpc.mockResolvedValue({
      data: {
        id: 'fuel-log-many-tanks',
        vessel_id: 'vessel-1',
        location_of_refueling: 'Newport',
        log_date: '2026-09-18',
        log_time: '10:30',
        amount_of_fuel: '29.997',
        price_per_gallon: '1',
        price_volume_unit: 'US_GALLONS',
        total_price: '30',
        volume_unit: 'US_GALLONS',
        currency_code: 'USD',
        comment: '',
        created_at: '2026-09-18T10:30:00Z',
      },
      error: null,
    });
    const entries = Array.from({ length: 30 }, (_, index) => ({
      fuelTankId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      amountLitres: 3.785411784,
    }));

    await fuelManagementService.createFuelLogWithTankEntries({
      log: {
        vesselId: 'vessel-1',
        locationOfRefueling: 'Newport',
        logDate: '2026-09-18',
        logTime: '10:30',
        amountOfFuel: 30,
        pricePerGallon: 1,
        totalPrice: 30,
        createdByName: 'Captain',
        volumeUnit: 'US_GALLONS',
        currencyCode: 'USD',
      },
      entries,
    });

    expect(mockRpc).toHaveBeenCalledWith(
      'create_fuel_receipt_with_tanks',
      expect.objectContaining({
        p_log: expect.objectContaining({ amount_of_fuel: 29.997, total_price: 30 }),
        p_entries: expect.arrayContaining([expect.objectContaining({ amount_litres: 3.785 })]),
      })
    );
  });

  it('does not call the write RPC when durable request preparation fails', async () => {
    mockAcquireFuelRequest.mockRejectedValueOnce(new Error('No data was sent'));

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
          currencyCode: 'EUR',
        },
        entries: [{ fuelTankId: 'tank-1', amountLitres: 10 }],
      })
    ).rejects.toThrow('No data was sent');

    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('shares one network write and acknowledgement across concurrent identical requests', async () => {
    mockRpc.mockResolvedValue({ data: { settings, tanks: [tank] }, error: null });
    let resolveCompletion!: () => void;
    mockCompleteFuelRequest.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolveCompletion = resolve;
      })
    );
    const input = {
      vesselId: 'vessel-1',
      volumeUnit: 'LITRES' as const,
      expectedRevision: 3,
      tanks: [
        {
          id: 'tank-1',
          name: 'Forward Starboard',
          location: 'Engine room',
          description: '',
          capacityLitres: 12000,
        },
      ],
    };

    const first = fuelManagementService.saveSetup(input);
    for (
      let attempt = 0;
      attempt < 10 && mockCompleteFuelRequest.mock.calls.length === 0;
      attempt += 1
    ) {
      await Promise.resolve();
    }
    const second = fuelManagementService.saveSetup(input);
    for (
      let attempt = 0;
      attempt < 10 && mockGetFuelRequestStorageKey.mock.calls.length < 2;
      attempt += 1
    ) {
      await Promise.resolve();
    }

    expect(mockGetFuelRequestStorageKey).toHaveBeenCalledTimes(2);
    expect(mockAcquireFuelRequest).toHaveBeenCalledTimes(1);
    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(mockCompleteFuelRequest).toHaveBeenCalledTimes(1);

    resolveCompletion();
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(firstResult).toEqual(secondResult);
    expect(mockCompleteFuelRequest).toHaveBeenCalledTimes(1);
  });

  it('keeps concurrent writes with different durable request keys independent', async () => {
    mockGetFuelRequestStorageKey
      .mockResolvedValueOnce('test:fuel-request:vessel-1')
      .mockResolvedValueOnce('test:fuel-request:vessel-2');
    mockAcquireFuelRequest
      .mockResolvedValueOnce({
        id: '12121212-1212-4212-8212-121212121212',
        storageKey: 'test:fuel-request:vessel-1',
      })
      .mockResolvedValueOnce({
        id: '13131313-1313-4313-8313-131313131313',
        storageKey: 'test:fuel-request:vessel-2',
      });
    let resolveRpc!: (value: {
      data: { settings: typeof settings; tanks: (typeof tank)[] };
      error: null;
    }) => void;
    mockRpc.mockReturnValue(
      new Promise((resolve) => {
        resolveRpc = resolve;
      })
    );
    const setupInput = (vesselId: string) => ({
      vesselId,
      volumeUnit: 'LITRES' as const,
      expectedRevision: 3,
      tanks: [
        {
          id: 'tank-1',
          name: 'Forward Starboard',
          location: 'Engine room',
          description: '',
          capacityLitres: 12000,
        },
      ],
    });

    const first = fuelManagementService.saveSetup(setupInput('vessel-1'));
    const second = fuelManagementService.saveSetup(setupInput('vessel-2'));
    for (let attempt = 0; attempt < 10 && mockRpc.mock.calls.length < 2; attempt += 1) {
      await Promise.resolve();
    }

    expect(mockRpc).toHaveBeenCalledTimes(2);
    expect(mockCompleteFuelRequest).not.toHaveBeenCalled();

    resolveRpc({ data: { settings, tanks: [tank] }, error: null });
    await Promise.all([first, second]);

    expect(mockCompleteFuelRequest).toHaveBeenCalledTimes(2);
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

  it('maps immutable ledger allocation names and the vessel display unit', async () => {
    const settingsMaybeSingle = jest.fn().mockResolvedValue({ data: settings, error: null });
    const settingsEq = jest.fn().mockReturnValue({ maybeSingle: settingsMaybeSingle });
    const settingsSelect = jest.fn().mockReturnValue({ eq: settingsEq });

    mockRpc.mockResolvedValue({
      data: {
        vessel_id: 'vessel-1',
        allocations: [
          {
            fuel_log_id: 'fuel-log-1',
            fuel_tank_id: 'tank-1',
            amount_litres: '2500.125',
            tank_name: 'Forward Starboard at receipt time',
            source: 'LEDGER',
          },
          {
            fuel_log_id: 'fuel-log-1',
            fuel_tank_id: 'tank-2',
            amount_litres: 500,
            tank_name: 'Day Tank',
            source: 'LEDGER',
          },
        ],
      },
      error: null,
    });

    mockFrom.mockImplementation((table: string) => {
      if (table === 'vessel_fuel_settings') return { select: settingsSelect };
      throw new Error(`Unexpected table ${table}`);
    });

    const result = await fuelManagementService.getFuelLogAllocationSnapshot('vessel-1', [
      'fuel-log-1',
      'fuel-log-1',
    ]);

    expect(mockFrom).toHaveBeenCalledTimes(1);
    expect(mockRpc).toHaveBeenCalledWith('get_fuel_log_allocation_snapshot', {
      p_vessel_id: 'vessel-1',
      p_fuel_log_ids: ['fuel-log-1'],
    });
    expect(result).toEqual({
      displayUnit: 'LITRES',
      allocationsByLogId: {
        'fuel-log-1': [
          {
            fuelLogId: 'fuel-log-1',
            fuelTankId: 'tank-1',
            tankName: 'Forward Starboard at receipt time',
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

  it('chunks large receipt histories to the allocation RPC limit', async () => {
    const settingsMaybeSingle = jest.fn().mockResolvedValue({ data: settings, error: null });
    const settingsEq = jest.fn().mockReturnValue({ maybeSingle: settingsMaybeSingle });
    const settingsSelect = jest.fn().mockReturnValue({ eq: settingsEq });
    mockFrom.mockImplementation((table: string) => {
      if (table === 'vessel_fuel_settings') return { select: settingsSelect };
      throw new Error(`Unexpected table ${table}`);
    });
    mockRpc.mockResolvedValue({
      data: { vessel_id: 'vessel-1', allocations: [] },
      error: null,
    });
    const ids = Array.from(
      { length: 101 },
      (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`
    );

    await fuelManagementService.getFuelLogAllocationSnapshot('vessel-1', ids);

    expect(mockRpc).toHaveBeenCalledTimes(2);
    expect(mockRpc.mock.calls[0][1].p_fuel_log_ids).toHaveLength(100);
    expect(mockRpc.mock.calls[1][1].p_fuel_log_ids).toEqual([ids[100]]);
  });

  it('keeps uninitialized inventory balances null while the legacy balance adapter stays numeric', async () => {
    const snapshotRow = {
      vessel_id: 'vessel-1',
      as_of: '2026-09-18T12:00:00Z',
      settings: { volume_unit: 'LITRES', inventory_activated_at: null },
      status: { activated: false, fully_initialized: false },
      tanks: [
        {
          ...tank,
          initialized: false,
          balance_litres: null,
          remaining_capacity_litres: null,
          last_verified_at: null,
          last_verified_type: null,
          last_activity_at: null,
        },
      ],
      total_capacity_litres: 12000,
      total_balance_litres: null,
    };
    mockRpc.mockResolvedValue({ data: snapshotRow, error: null });

    const snapshot = await fuelManagementService.getInventorySnapshot('vessel-1');
    const compatibilityBalances = await fuelManagementService.getTankBalances('vessel-1');

    expect(snapshot).toMatchObject({
      status: 'NOT_ACTIVATED',
      totalBalanceLitres: null,
      allTanksInitialized: false,
      uninitializedTankIds: ['tank-1'],
    });
    expect(snapshot.tanks[0].balanceLitres).toBeNull();
    expect(compatibilityBalances[0]).toMatchObject({
      recordedVolumeLitres: 0,
      remainingCapacityLitres: 12000,
      isInitialized: false,
    });
    expect(mockRpc).toHaveBeenNthCalledWith(1, 'get_fuel_inventory_snapshot', {
      p_vessel_id: 'vessel-1',
    });
  });

  it('maps an opening correction as the latest absolute verification without inventing sounding history', async () => {
    mockRpc.mockResolvedValue({
      data: {
        vessel_id: 'vessel-1',
        as_of: '2026-09-18T12:00:00Z',
        settings: {
          volume_unit: 'LITRES',
          inventory_activated_at: '2026-09-17T22:00:00Z',
        },
        status: { activated: true, fully_initialized: true },
        tanks: [
          {
            ...tank,
            initialized: true,
            balance_litres: 378.541,
            remaining_capacity_litres: 0,
            last_verified_at: '2026-09-18T00:00:00Z',
            last_verified_type: 'OPENING',
            last_verified_utc_offset_minutes: 600,
            last_activity_at: '2026-09-18T00:00:00Z',
          },
        ],
        total_capacity_litres: 378.541,
        total_balance_litres: 378.541,
      },
      error: null,
    });

    const snapshot = await fuelManagementService.getInventorySnapshot('vessel-1');

    expect(snapshot.tanks[0]).toMatchObject({
      initialized: true,
      lastVerificationKind: 'OPENING',
      lastVerifiedAt: '2026-09-18T00:00:00Z',
      lastVerifiedUtcOffsetMinutes: 600,
    });
    expect(snapshot.tanks[0]).not.toHaveProperty('lastSoundingAt');
  });

  it('activates inventory atomically and preserves explicit zero opening quantities', async () => {
    const activeSnapshot = {
      vessel_id: 'vessel-1',
      as_of: '2026-09-18T00:00:00Z',
      settings: {
        volume_unit: 'LITRES',
        inventory_activated_at: '2026-09-18T00:00:00Z',
      },
      status: { activated: true, fully_initialized: true },
      tanks: [],
      total_capacity_litres: 0,
      total_balance_litres: 0,
    };
    mockRpc.mockResolvedValue({ data: activeSnapshot, error: null });

    const result = await fuelManagementService.activateInventory({
      vesselId: 'vessel-1',
      occurredAt: '2026-09-18T10:00:00+10:00',
      entries: [{ tankId: 'tank-1', amountLitres: 0 }],
      notes: ' Current soundings ',
      idempotencyKey: '33333333-3333-4333-8333-333333333333',
    });

    expect(mockRpc).toHaveBeenCalledWith('activate_vessel_fuel_inventory', {
      p_vessel_id: 'vessel-1',
      p_effective_at: '2026-09-18T00:00:00.000Z',
      p_utc_offset_minutes: 600,
      p_openings: [{ fuel_tank_id: 'tank-1', amount_litres: 0 }],
      p_notes: 'Current soundings',
      p_client_request_id: '33333333-3333-4333-8333-333333333333',
    });
    expect(result.status).toBe('ACTIVE');
  });

  it('normalizes a manager removal adjustment to a signed ledger amount', async () => {
    mockRpc.mockResolvedValue({
      data: {
        id: 'operation-1',
        logical_operation_id: 'logical-1',
        revision_no: 1,
        vessel_id: 'vessel-1',
        operation_type: 'ADJUSTMENT',
        effective_at: '2026-09-18T00:00:00Z',
        utc_offset_minutes: 600,
        effective_order: 1,
        recorded_sequence: 5,
        metadata: { reason: 'Calibration correction' },
        created_by: 'captain-1',
        created_by_name: 'Captain',
        recorded_at: '2026-09-18T00:01:00Z',
        voided: false,
        postings: [
          {
            fuel_tank_id: 'tank-1',
            tank_name: 'Forward Starboard',
            posting_mode: 'DELTA',
            amount_litres: -12.5,
          },
        ],
      },
      error: null,
    });

    const result = await fuelManagementService.recordInventoryEntry({
      vesselId: 'vessel-1',
      fuelTankId: 'tank-1',
      kind: 'ADJUSTMENT',
      amountLitres: 12.5,
      adjustmentDirection: 'REMOVE',
      occurredAt: '2026-09-18T10:00:00+10:00',
      reason: ' Calibration correction ',
      idempotencyKey: '44444444-4444-4444-8444-444444444444',
    });

    expect(mockRpc).toHaveBeenCalledWith(
      'record_fuel_inventory_entry',
      expect.objectContaining({
        p_entry_type: 'ADJUSTMENT',
        p_amount_litres: -12.5,
        p_location: '',
        p_reason: 'Calibration correction',
      })
    );
    expect(result.postings[0]).toMatchObject({ postingMode: 'DELTA', amountLitres: -12.5 });
  });

  it('keeps operational and audit reasons distinct when correcting an inventory entry', async () => {
    mockRpc.mockResolvedValue({
      data: {
        id: 'operation-2',
        logical_operation_id: 'logical-1',
        revision_no: 2,
        vessel_id: 'vessel-1',
        operation_type: 'ADJUSTMENT',
        effective_at: '2026-09-18T00:00:00Z',
        utc_offset_minutes: 600,
        effective_order: 1,
        recorded_sequence: 6,
        metadata: {
          reason: 'Gauge calibration',
          amendment_reason: 'Corrected transposed quantity',
        },
        created_by: 'captain-1',
        created_by_name: 'Captain',
        recorded_at: '2026-09-18T00:02:00Z',
        voided: false,
        postings: [
          {
            fuel_tank_id: 'tank-1',
            tank_name: 'Forward Starboard',
            posting_mode: 'DELTA',
            amount_litres: -21,
          },
        ],
      },
      error: null,
    });

    await fuelManagementService.amendInventoryEntry({
      operationId: 'operation-1',
      expectedRevision: 1,
      vesselId: 'vessel-1',
      fuelTankId: 'tank-1',
      kind: 'ADJUSTMENT',
      amountLitres: 21,
      adjustmentDirection: 'REMOVE',
      occurredAt: '2026-09-18T10:00:00+10:00',
      reason: ' Gauge calibration ',
      amendmentReason: ' Corrected transposed quantity ',
      idempotencyKey: '88888888-8888-4888-8888-888888888888',
    });

    expect(mockRpc).toHaveBeenCalledWith('amend_fuel_inventory_entry', {
      p_operation_id: 'operation-1',
      p_expected_revision: 1,
      p_effective_at: '2026-09-18T00:00:00.000Z',
      p_utc_offset_minutes: 600,
      p_amount_litres: -21,
      p_location: '',
      p_entry_reason: 'Gauge calibration',
      p_notes: '',
      p_amendment_reason: 'Corrected transposed quantity',
      p_client_request_id: '88888888-8888-4888-8888-888888888888',
    });
  });

  it('canonicalizes a full-capacity US-gallon opening correction before the audited RPC', async () => {
    mockRpc.mockResolvedValue({
      data: {
        id: 'opening-operation-2',
        logical_operation_id: 'opening-logical-1',
        revision_no: 2,
        vessel_id: 'vessel-1',
        operation_type: 'OPENING',
        effective_at: '2026-09-17T22:00:00.000Z',
        utc_offset_minutes: 600,
        effective_order: 1,
        recorded_sequence: 10,
        metadata: { amendment_reason: 'Corrected sounding sheet' },
        created_by: 'captain-1',
        created_by_name: 'Captain',
        recorded_at: '2026-09-18T01:00:00Z',
        voided: false,
        postings: [],
      },
      error: null,
    });

    await fuelManagementService.amendOpeningInventory({
      operationId: 'opening-operation-1',
      expectedRevision: 1,
      occurredAt: '2026-09-18T08:00:00',
      utcOffsetMinutes: 600,
      entries: [
        // 100 US gallons, displayed from a 378.541 L capacity, converts back
        // to a repeating decimal that must not fail the server capacity check.
        { tankId: 'tank-1', amountLitres: 100 * 3.785411784 },
        { tankId: 'tank-2', amountLitres: 250 },
      ],
      notes: ' Physical opening soundings ',
      amendmentReason: ' Corrected sounding sheet ',
      idempotencyKey: '89898989-8989-4989-8989-898989898989',
    });

    expect(mockRpc).toHaveBeenCalledWith('amend_fuel_inventory_opening', {
      p_operation_id: 'opening-operation-1',
      p_expected_revision: 1,
      p_effective_at: '2026-09-17T22:00:00.000Z',
      p_utc_offset_minutes: 600,
      p_openings: [
        { fuel_tank_id: 'tank-1', amount_litres: 378.541 },
        { fuel_tank_id: 'tank-2', amount_litres: 250 },
      ],
      p_notes: 'Physical opening soundings',
      p_amendment_reason: 'Corrected sounding sheet',
      p_client_request_id: '89898989-8989-4989-8989-898989898989',
    });
  });

  it('voids a manual inventory entry with optimistic revision context', async () => {
    mockRpc.mockResolvedValue({
      data: {
        id: 'operation-1',
        logical_operation_id: 'logical-1',
        revision_no: 1,
        vessel_id: 'vessel-1',
        operation_type: 'CONSUMPTION',
        effective_at: '2026-09-18T00:00:00Z',
        utc_offset_minutes: 600,
        effective_order: 1,
        recorded_sequence: 5,
        metadata: {},
        created_by: 'captain-1',
        created_by_name: 'Captain',
        recorded_at: '2026-09-18T00:01:00Z',
        voided: true,
        void_kind: 'ERROR',
        void_reason: 'Entered against the wrong tank',
        void_created_by: 'captain-2',
        void_created_by_name: 'Relief Captain',
        void_recorded_at: '2026-09-18T00:03:00Z',
        postings: [
          {
            fuel_tank_id: 'tank-1',
            tank_name: 'Forward Starboard',
            posting_mode: 'DELTA',
            amount_litres: -12,
          },
        ],
      },
      error: null,
    });

    const result = await fuelManagementService.voidInventoryEntry({
      operationId: 'operation-1',
      expectedRevision: 1,
      reason: ' Entered against the wrong tank ',
      idempotencyKey: '99999999-9999-4999-8999-999999999999',
    });

    expect(mockRpc).toHaveBeenCalledWith('void_fuel_inventory_entry', {
      p_operation_id: 'operation-1',
      p_expected_revision: 1,
      p_reason: 'Entered against the wrong tank',
      p_client_request_id: '99999999-9999-4999-8999-999999999999',
    });
    expect(result).toMatchObject({
      status: 'VOIDED',
      voidedBy: 'captain-2',
      voidedByName: 'Relief Captain',
      voidedAt: '2026-09-18T00:03:00Z',
    });
  });

  it('maps paginated inventory history with deterministic sequence fields', async () => {
    mockRpc.mockResolvedValue({
      data: {
        operations: [
          {
            id: 'operation-1',
            logical_operation_id: 'logical-1',
            revision_no: 1,
            vessel_id: 'vessel-1',
            operation_type: 'SOUNDING',
            effective_at: '2026-09-18T00:00:00Z',
            utc_offset_minutes: 600,
            effective_order: 7,
            recorded_sequence: 42,
            metadata: {},
            created_by: null,
            created_by_name: 'Former Engineer',
            recorded_at: '2026-09-18T00:02:00Z',
            voided: false,
            postings: [
              {
                fuel_tank_id: 'tank-1',
                tank_name: 'Forward Starboard',
                posting_mode: 'ABSOLUTE',
                amount_litres: 800,
              },
            ],
          },
        ],
        next_before_sequence: 41,
      },
      error: null,
    });

    const history = await fuelManagementService.getInventoryHistory('vessel-1', {
      tankId: 'tank-1',
      limit: 25,
      beforeRecordedSequence: 50,
    });

    expect(mockRpc).toHaveBeenCalledWith('get_fuel_inventory_history', {
      p_vessel_id: 'vessel-1',
      p_tank_id: 'tank-1',
      p_limit: 25,
      p_before_recorded_sequence: 50,
    });
    expect(history.operations[0]).toMatchObject({
      kind: 'SOUNDING',
      recordedSequence: 42,
      createdBy: null,
      createdByName: 'Former Engineer',
      voidedBy: null,
      voidedByName: '',
      voidedAt: null,
    });
    expect(history.nextBeforeSequence).toBe(41);
  });

  it('maps and paginates immutable legacy source audit evidence', async () => {
    mockRpc.mockResolvedValue({
      data: {
        vessel_id: 'vessel-1',
        audits: [
          {
            id: 'audit-1',
            vessel_id: 'vessel-1',
            source_type: 'FUEL_LOG',
            source_id: 'fuel-log-1',
            action: 'AMENDMENT',
            revision_before: 0,
            revision_after: 1,
            before_snapshot: {
              location_of_refueling: 'Old berth',
              inventory_revision: 0,
              allocations: [{ fuel_tank_id: 'tank-1', tank_name: 'Port Tank', amount_litres: 100 }],
            },
            after_snapshot: {
              location_of_refueling: 'New berth',
              inventory_revision: 1,
              allocations: [{ fuel_tank_id: 'tank-2', tank_name: 'Day Tank', amount_litres: 100 }],
            },
            reason: 'Corrected delivery allocation',
            client_request_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            created_by: null,
            created_by_name: 'Former Captain',
            recorded_at: '2026-09-18T12:00:00Z',
          },
        ],
        next_cursor: {
          recorded_at: '2026-09-18T12:00:00Z',
          id: 'audit-1',
        },
      },
      error: null,
    });

    const history = await fuelManagementService.getLegacyInventoryAudits('vessel-1', {
      sourceType: 'FUEL_LOG',
      sourceId: 'fuel-log-1',
      limit: 25,
      before: { recordedAt: '2026-09-19T00:00:00Z', id: 'cursor-2' },
    });

    expect(mockRpc).toHaveBeenCalledWith('get_fuel_inventory_legacy_audits', {
      p_vessel_id: 'vessel-1',
      p_source_type: 'FUEL_LOG',
      p_source_id: 'fuel-log-1',
      p_limit: 25,
      p_before_recorded_at: '2026-09-19T00:00:00Z',
      p_before_id: 'cursor-2',
    });
    expect(history.audits[0]).toMatchObject({
      sourceType: 'FUEL_LOG',
      action: 'AMENDMENT',
      revisionBefore: 0,
      revisionAfter: 1,
      createdBy: null,
      createdByName: 'Former Captain',
      reason: 'Corrected delivery allocation',
    });
    expect(history.audits[0].beforeSnapshot.allocations).toEqual([
      { fuel_tank_id: 'tank-1', tank_name: 'Port Tank', amount_litres: 100 },
    ]);
    expect(history.nextCursor).toEqual({
      recordedAt: '2026-09-18T12:00:00Z',
      id: 'audit-1',
    });
  });

  it('loads one authorized inventory operation for correction routes', async () => {
    mockRpc.mockResolvedValue({
      data: {
        id: 'operation-1',
        logical_operation_id: 'logical-1',
        revision_no: 1,
        vessel_id: 'vessel-1',
        operation_type: 'SOUNDING',
        effective_at: '2026-09-18T00:00:00Z',
        utc_offset_minutes: 600,
        effective_order: 7,
        recorded_sequence: 42,
        metadata: {},
        created_by: 'user-1',
        created_by_name: 'Engineer',
        recorded_at: '2026-09-18T00:02:00Z',
        voided: false,
        postings: [],
      },
      error: null,
    });

    const operation = await fuelManagementService.getInventoryOperation('operation-1');

    expect(mockRpc).toHaveBeenCalledWith('get_fuel_inventory_operation', {
      p_operation_id: 'operation-1',
    });
    expect(operation).toMatchObject({ id: 'operation-1', kind: 'SOUNDING', status: 'POSTED' });
  });

  it('records and amends transfers only through ledger-aware RPCs', async () => {
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
      effective_at: '2026-09-18T01:00:00.000Z',
      utc_offset_minutes: 600,
      created_by: 'crew-1',
      created_at: '2026-09-18T11:00:00Z',
      updated_at: '2026-09-18T11:00:00Z',
      inventory_revision: 3,
    };
    mockRpc
      .mockResolvedValueOnce({ data: transferRow, error: null })
      .mockResolvedValueOnce({ data: { ...transferRow, inventory_revision: 4 }, error: null });

    const input = {
      vesselId: 'vessel-1',
      sourceTankId: 'tank-1',
      destinationTankId: 'tank-2',
      amountLitres: 125,
      transferDate: '2026-09-18',
      transferTime: '11:00',
      location: ' Engine room ',
      notes: ' Balance tanks ',
      effectiveAt: '2026-09-18T01:00:00.000Z',
      utcOffsetMinutes: 600,
      expectedRevision: 3,
      amendmentReason: 'Corrected tank selection',
    };

    const created = await fuelManagementService.createTransfer({
      ...input,
      idempotencyKey: '22222222-2222-4222-8222-222222222222',
    });
    await fuelManagementService.updateTransfer('transfer-1', {
      ...input,
      idempotencyKey: '23232323-2323-4323-8323-232323232323',
    });

    expect(mockRpc).toHaveBeenNthCalledWith(1, 'record_fuel_transfer', {
      p_transfer: expect.objectContaining({
        vessel_id: 'vessel-1',
        amount_litres: 125,
        effective_at: '2026-09-18T01:00:00.000Z',
        utc_offset_minutes: 600,
      }),
      p_client_request_id: '22222222-2222-4222-8222-222222222222',
    });
    expect(mockRpc).toHaveBeenNthCalledWith(2, 'amend_fuel_transfer', {
      p_fuel_transfer_id: 'transfer-1',
      p_expected_revision: 3,
      p_transfer: expect.any(Object),
      p_reason: 'Corrected tank selection',
      p_client_request_id: '23232323-2323-4323-8323-232323232323',
    });
    expect(created.createdBy).toBe('crew-1');
  });

  it('accepts revision zero when amending a retained pre-ledger transfer', async () => {
    mockRpc.mockResolvedValue({ data: {}, error: null });

    await fuelManagementService.updateTransfer('legacy-transfer-1', {
      vesselId: 'vessel-1',
      sourceTankId: 'tank-1',
      destinationTankId: 'tank-2',
      amountLitres: 3.785411784,
      transferDate: '2026-09-18',
      transferTime: '11:00',
      effectiveAt: '2026-09-18T01:00:00.000Z',
      utcOffsetMinutes: 600,
      location: 'Engine room',
      notes: 'Retained report row',
      expectedRevision: 0,
      amendmentReason: 'Corrected legacy report',
    });

    expect(mockRpc).toHaveBeenCalledWith(
      'amend_fuel_transfer',
      expect.objectContaining({
        p_expected_revision: 0,
        p_transfer: expect.objectContaining({ amount_litres: 3.785 }),
      })
    );
  });

  it('passes optimistic revision and idempotency context when amending a refuel log', async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });

    await fuelManagementService.updateFuelLogWithTankEntries('fuel-log-1', {
      vesselId: 'vessel-1',
      log: { comment: ' Corrected comment ' },
      entries: [{ fuelTankId: 'tank-1', amountLitres: 2500 }],
      expectedRevision: 2,
      amendmentReason: ' Corrected the delivery note ',
      idempotencyKey: '55555555-5555-4555-8555-555555555555',
    });

    expect(mockRpc).toHaveBeenCalledWith('update_fuel_log_with_tank_entries', {
      p_fuel_log_id: 'fuel-log-1',
      p_vessel_id: 'vessel-1',
      p_log_patch: {
        comment: 'Corrected comment',
        client_request_id: '55555555-5555-4555-8555-555555555555',
        amendment_reason: 'Corrected the delivery note',
        expected_revision: 2,
      },
      p_entries: [{ fuel_tank_id: 'tank-1', amount_litres: 2500 }],
    });
  });

  it('preserves an explicitly unallocated legacy receipt during metadata-only amendment', async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });

    await fuelManagementService.updateFuelLogWithTankEntries('legacy-log-1', {
      vesselId: 'vessel-1',
      log: {
        locationOfRefueling: 'Corrected berth',
        pricePerGallon: 4,
        totalPrice: 2000,
        currencyCode: 'USD',
        comment: 'Metadata only',
      },
      entries: [],
      expectedRevision: 0,
      amendmentReason: 'Corrected paper receipt details',
      idempotencyKey: '45454545-4545-4545-8545-454545454545',
    });

    expect(mockRpc).toHaveBeenCalledWith('update_fuel_log_with_tank_entries', {
      p_fuel_log_id: 'legacy-log-1',
      p_vessel_id: 'vessel-1',
      p_log_patch: {
        location_of_refueling: 'Corrected berth',
        price_per_gallon: 4,
        total_price: 2000,
        currency_code: 'USD',
        comment: 'Metadata only',
        amendment_reason: 'Corrected paper receipt details',
        expected_revision: 0,
        client_request_id: '45454545-4545-4545-8545-454545454545',
      },
      p_entries: [],
    });
  });

  it('rejects partial receipt event context', async () => {
    await expect(
      fuelManagementService.updateFuelLogWithTankEntries('legacy-log-1', {
        vesselId: 'vessel-1',
        log: { logDate: '2026-09-18', logTime: '11:00' },
        entries: [],
        expectedRevision: 0,
        amendmentReason: 'Corrected historical date',
      })
    ).rejects.toThrow('valid recorded event time');

    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('rejects transfer amendments without complete event context', async () => {
    await expect(
      fuelManagementService.updateTransfer('legacy-transfer-1', {
        vesselId: 'vessel-1',
        sourceTankId: 'tank-1',
        destinationTankId: 'tank-2',
        amountLitres: 10,
        transferDate: '2026-09-18',
        transferTime: '11:00',
        expectedRevision: 0,
        amendmentReason: 'Corrected historical transfer',
      })
    ).rejects.toThrow('valid recorded event time');

    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('voids refuels and transfers through append-only ledger RPCs', async () => {
    mockRpc.mockResolvedValue({ data: {}, error: null });

    await fuelManagementService.voidFuelLog('fuel-log-1', {
      expectedRevision: 2,
      reason: ' Duplicate delivery ',
      idempotencyKey: '66666666-6666-4666-8666-666666666666',
    });
    await fuelManagementService.deleteTransfer('transfer-1', {
      expectedRevision: 4,
      reason: ' Entered against wrong tanks ',
      idempotencyKey: '77777777-7777-4777-8777-777777777777',
    });

    expect(mockRpc).toHaveBeenNthCalledWith(1, 'void_fuel_log', {
      p_fuel_log_id: 'fuel-log-1',
      p_expected_revision: 2,
      p_reason: 'Duplicate delivery',
      p_client_request_id: '66666666-6666-4666-8666-666666666666',
    });
    expect(mockRpc).toHaveBeenNthCalledWith(2, 'void_fuel_transfer', {
      p_fuel_transfer_id: 'transfer-1',
      p_expected_revision: 4,
      p_reason: 'Entered against wrong tanks',
      p_client_request_id: '77777777-7777-4777-8777-777777777777',
    });
  });

  it('allows manager voids of report-only revision-zero receipts and transfers', async () => {
    mockRpc.mockResolvedValue({ data: {}, error: null });

    await fuelManagementService.voidFuelLog('legacy-log-1', {
      expectedRevision: 0,
      reason: 'Duplicate paper record',
      idempotencyKey: '88888888-8888-4888-8888-888888888888',
    });
    await fuelManagementService.deleteTransfer('legacy-transfer-1', {
      expectedRevision: 0,
      reason: 'Wrong tanks selected',
      idempotencyKey: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    });

    expect(mockRpc).toHaveBeenNthCalledWith(1, 'void_fuel_log', {
      p_fuel_log_id: 'legacy-log-1',
      p_expected_revision: 0,
      p_reason: 'Duplicate paper record',
      p_client_request_id: '88888888-8888-4888-8888-888888888888',
    });
    expect(mockRpc).toHaveBeenNthCalledWith(2, 'void_fuel_transfer', {
      p_fuel_transfer_id: 'legacy-transfer-1',
      p_expected_revision: 0,
      p_reason: 'Wrong tanks selected',
      p_client_request_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    });
  });
});
