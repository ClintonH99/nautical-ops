/** @jest-environment node */
const mockRead = jest.fn();
const mockSave = jest.fn();
const mockDelete = jest.fn();
const mockRefresh = jest.fn();
jest.mock('../../src/offline/runtime.web', () => ({
  webOfflineEnabled: true,
  offlineNotesContext: async () => ({
    scope: { vesselId: 'v1', userId: 'u1' },
    box: { read: mockRead },
  }),
  saveOfflineRecord: (...args: unknown[]) => mockSave(...args),
  deleteSyncedOfflineRecord: (...args: unknown[]) => mockDelete(...args),
  subscribeOfflineNotes: () => () => {},
  refreshOfflineFeature: (...args: unknown[]) => mockRefresh(...args),
}));
import { offlineShopping } from '../../src/offline/shoppingService.web';
import { offlineInventory } from '../../src/offline/inventoryService.web';
import { OfflineError } from '../../src/offline/access';
const base = { title: 'Supplies', items: [{ text: 'Rope', checked: true }] };
beforeEach(() => {
  jest.clearAllMocks();
  mockSave.mockImplementation(async (_f, value, _k, version) => ({
    ...value,
    offlineLocalVersion: version + 1,
  }));
});
it('unticks after an acknowledgement advanced the version without changing contents', async () => {
  mockRead.mockResolvedValue({
    localVersion: 4,
    value: { ...base, items: [{ checked: true, text: 'Rope', amount: '' }] },
  });
  const result = await offlineShopping.update(
    's1',
    { items: [{ text: 'Rope', checked: false }] },
    3,
    base
  );
  expect(result.items).toEqual([{ text: 'Rope', checked: false }]);
  expect(mockSave.mock.calls[0][3]).toBe(4);
});
it('rechecks the base when an acknowledgement races the atomic save', async () => {
  mockRead
    .mockResolvedValueOnce({ localVersion: 3, value: base })
    .mockResolvedValueOnce({ localVersion: 4, value: base });
  mockSave.mockRejectedValueOnce(new OfflineError('LOCAL_CONFLICT'));
  await offlineShopping.update('s1', { items: [] }, 3, base);
  expect(mockSave.mock.calls.map((call) => call[3])).toEqual([3, 4]);
});
it('preserves somebody else’s item edit instead of overwriting it', async () => {
  mockRead.mockResolvedValue({
    localVersion: 4,
    value: { ...base, items: [{ text: 'Fuel', checked: true }] },
  });
  await expect(offlineShopping.update('s1', { items: [] }, 3, base)).rejects.toMatchObject({
    code: 'LOCAL_CONFLICT',
  });
  expect(mockSave).not.toHaveBeenCalled();
});
it('a failed attempt does not block the next legitimate edit', async () => {
  mockRead.mockResolvedValue({ localVersion: 3, value: base });
  mockSave.mockRejectedValueOnce(new Error('Storage unavailable'));
  await expect(offlineShopping.update('s1', { items: [] }, 3, base)).rejects.toThrow(
    'Storage unavailable'
  );
  await expect(offlineShopping.update('s1', { items: [] }, 3, base)).resolves.toMatchObject({
    items: [],
  });
});
it('inventory removes its last line despite an acknowledgement racing the save', async () => {
  const inventory = {
    id: 'i1',
    vessel_id: 'v1',
    title: 'Supplies',
    department: 'BRIDGE',
    description: '',
    location: '',
    items: [{ amount: '1', item: 'Rope' }],
  };
  mockRead.mockResolvedValueOnce({ localVersion: 2, value: inventory }).mockResolvedValueOnce({
    localVersion: 3,
    value: { ...inventory, last_edited_at: 'new timestamp' },
  });
  mockSave.mockRejectedValueOnce(new OfflineError('LOCAL_CONFLICT'));
  const result = await offlineInventory.save('i1', 'v1', { ...inventory, items: [] }, inventory);
  expect(result.items).toEqual([]);
  expect(mockSave.mock.calls.map((call) => call[3])).toEqual([2, 3]);
});
it('inventory rejects a real concurrent edit', async () => {
  const inventory = { title: 'Supplies', items: [] };
  mockRead.mockResolvedValue({ localVersion: 3, value: { ...inventory, title: 'Changed' } });
  await expect(
    offlineInventory.save('i1', 'v1', { ...inventory, title: 'My edit' }, inventory)
  ).rejects.toMatchObject({ name: 'InventoryConflictError' });
  expect(mockSave).not.toHaveBeenCalled();
});

it('refresh requests a fresh server snapshot for the visible feature', async () => {
  await offlineShopping.refresh();
  await offlineInventory.refresh();
  expect(mockRefresh.mock.calls).toEqual([['shoppingLists'], ['inventory']]);
});
it('a failed server refresh is reported without deleting local records', async () => {
  mockRefresh.mockRejectedValueOnce(new Error('Network unavailable'));
  await expect(offlineShopping.refresh()).rejects.toThrow('Network unavailable');
  expect(mockDelete).not.toHaveBeenCalled();
  expect(mockSave).not.toHaveBeenCalled();
});
