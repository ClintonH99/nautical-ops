const mockRpc = jest.fn();
const mockFrom = jest.fn();
jest.mock('../../src/services/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
    from: (...args: unknown[]) => mockFrom(...args),
  },
}));
import service from '../../src/services/watchKeeping';

const input = {
  vesselId: 'vessel',
  watchTitle: ' Watch ',
  startTime: '08:00',
  forDate: '2026-09-30',
  slots: [],
  createdBy: 'untrusted-client-id',
};
const saved = {
  id: 'request',
  vessel_id: 'vessel',
  watch_title: 'Watch',
  start_time: '08:00',
  for_date: '2026-09-30',
  slots: [],
  created_by: 'server-user',
  created_at: '2026-09-30',
};
beforeEach(() => {
  jest.clearAllMocks();
});

it('publishes via the atomic RPC with an explicit retry ID and server-owned identity', async () => {
  mockRpc.mockResolvedValue({ data: saved, error: null });
  await expect(service.publish(input, 'request')).resolves.toMatchObject({
    id: 'request',
    createdBy: 'server-user',
  });
  expect(mockRpc).toHaveBeenCalledWith('publish_watch_schedule', {
    p_request_id: 'request',
    p_data: {
      vessel_id: 'vessel',
      watch_title: 'Watch',
      start_time: '08:00',
      for_date: '2026-09-30',
      slots: [],
      start_location: null,
      destination: null,
      notes: null,
    },
  });
  expect(mockFrom).not.toHaveBeenCalled();
});
it('surfaces a publish failure without inserting a fallback duplicate', async () => {
  const error = new Error('Network request failed');
  mockRpc.mockResolvedValue({ data: null, error });
  await expect(service.publish(input, 'request')).rejects.toBe(error);
  expect(mockRpc).toHaveBeenCalledTimes(1);
  expect(mockFrom).not.toHaveBeenCalled();
});
it('updates once and leaves rest reconfirmation to the transaction', async () => {
  const query = {
    update: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue({ data: saved, error: null }),
  };
  mockFrom.mockReturnValue(query);
  await expect(service.update('request', input)).resolves.toMatchObject({ id: 'request' });
  expect(mockFrom).toHaveBeenCalledTimes(1);
  expect(mockFrom).toHaveBeenCalledWith('watch_keeping_timetables');
  expect(query.update).toHaveBeenCalledTimes(1);
});
it('does not report a zero-row delete as successful', async () => {
  mockFrom.mockReturnValue({
    delete: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    select: jest.fn().mockResolvedValue({ data: [], error: null }),
  });
  await expect(service.delete('missing')).rejects.toThrow();
  expect(mockFrom).toHaveBeenCalledTimes(1);
});
