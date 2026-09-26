const mockFrom = jest.fn();
jest.mock('../../src/services/supabase', () => ({
  supabase: { from: (...args: unknown[]) => mockFrom(...args) },
}));
import { getVesselLogMonthRows } from '../../src/services/vesselLogMonthQuery';
import fuelLogs from '../../src/services/fuelLogs';
import wasteLogs from '../../src/services/generalWasteLogs';
import dischargeLogs from '../../src/services/pumpOutLogs';

const builder = () => {
  const query: any = {};
  for (const method of ['select', 'eq', 'gte', 'lt', 'is', 'order'])
    query[method] = jest.fn(() => query);
  query.range = jest.fn().mockResolvedValue({ data: [], error: null });
  mockFrom.mockReturnValue(query);
  return query;
};

beforeEach(() => jest.clearAllMocks());

it.each(['general_waste_logs', 'pump_out_logs', 'fuel_logs'] as const)(
  'queries %s by vessel and creation month, not the current crew member or editable event date',
  async (table) => {
    const query = builder();
    await getVesselLogMonthRows(table, 'vessel-1', '2026-09');
    expect(mockFrom).toHaveBeenCalledWith(table);
    expect(query.eq.mock.calls).toEqual([['vessel_id', 'vessel-1']]);
    expect(query.gte).toHaveBeenCalledWith('created_at', '2026-09-01T00:00:00.000Z');
    expect(query.lt).toHaveBeenCalledWith('created_at', '2026-10-01T00:00:00.000Z');
    expect(query.range).toHaveBeenCalledWith(0, 499);
    expect(query.order).toHaveBeenCalledWith('id', { ascending: false });
    if (table === 'fuel_logs') expect(query.is).toHaveBeenCalledWith('voided_at', null);
    else expect(query.is).not.toHaveBeenCalled();
  }
);

it('paginates beyond the backend row limit without truncating a busy month', async () => {
  const query = builder();
  query.range
    .mockResolvedValueOnce({ data: Array.from({ length: 500 }, (_, id) => ({ id })), error: null })
    .mockResolvedValueOnce({
      data: Array.from({ length: 500 }, (_, id) => ({ id: id + 500 })),
      error: null,
    })
    .mockResolvedValueOnce({ data: [{ id: 1000 }], error: null });
  const result = await getVesselLogMonthRows('general_waste_logs', 'vessel-1', '2026-09');
  expect(result).toHaveLength(1001);
  expect(result.at(-1)).toEqual({ id: 1000 });
  expect(query.range.mock.calls).toEqual([
    [0, 499],
    [500, 999],
    [1000, 1499],
  ]);
});

it('does not return a false empty or partial archive when a page fails', async () => {
  const query = builder();
  query.range
    .mockResolvedValueOnce({ data: Array(500).fill({ id: 'row' }), error: null })
    .mockResolvedValueOnce({ data: null, error: new Error('Offline') });
  await expect(getVesselLogMonthRows('fuel_logs', 'vessel-1', '2026-09')).rejects.toThrow(
    'Offline'
  );
});

it.each([fuelLogs, wasteLogs, dischargeLogs])(
  'retains the existing service row mapping',
  async (service) => {
    const query = builder();
    query.range.mockResolvedValue({
      data: [
        {
          id: 'entry',
          vessel_id: 'vessel-1',
          created_at: '2026-09-22T12:00:00Z',
          log_date: '2026-08-15',
          log_time: '12:00',
        },
      ],
      error: null,
    });
    const result = await service.getByVesselMonth('vessel-1', '2026-09');
    expect(result[0]).toMatchObject({
      id: 'entry',
      vesselId: 'vessel-1',
      createdAt: '2026-09-22T12:00:00Z',
      logDate: '2026-08-15',
    });
  }
);
