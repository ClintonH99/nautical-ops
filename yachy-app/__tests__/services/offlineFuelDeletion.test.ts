/** @jest-environment node */
const mockBundle = jest.fn();
const mockDelete = jest.fn();
jest.mock('../../src/offline/runtime.web', () => ({
  webOfflineEnabled: true,
  offlineNotesContext: async () => ({ box: { bundle: mockBundle } }),
  deleteSyncedOfflineRecord: (...args: unknown[]) => mockDelete(...args),
  subscribeOfflineNotes: () => () => {},
}));
import { offlineFuel } from '../../src/offline/fuelService.web';
beforeEach(() => {
  jest.clearAllMocks();
  mockBundle.mockResolvedValue({
    records: {
      fuelLogs: [{ value: { id: 'local-wrapper', source_id: 'server-receipt' }, localVersion: 1 }],
    },
    pendingRecords: [],
  });
});
it('removes the offline wrapper using its local ID even when the receipt exposes a different server ID', async () => {
  const remove = jest.fn();
  await offlineFuel.deleteReceipt('server-receipt', remove);
  expect(mockDelete).toHaveBeenCalledWith('fuelLogs', 'local-wrapper', remove);
});
it('waits for durable cache removal before reporting success', async () => {
  let finish!: () => void;
  mockDelete.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      })
  );
  let done = false;
  const deletion = offlineFuel.deleteReceipt('server-receipt', jest.fn()).then(() => {
    done = true;
  });
  await new Promise((resolve) => setImmediate(resolve));
  expect(done).toBe(false);
  finish();
  await deletion;
  expect(done).toBe(true);
});
it('propagates a rejected deletion rather than claiming success', async () => {
  mockDelete.mockRejectedValueOnce(new Error('Permission denied'));
  await expect(offlineFuel.deleteReceipt('server-receipt', jest.fn())).rejects.toThrow(
    'Permission denied'
  );
});
