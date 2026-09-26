/** @jest-environment node */
const mockFrom = jest.fn();
const mockInvalidate = jest.fn();
jest.mock('../../src/services/supabase', () => ({
  supabase: { from: (...args: unknown[]) => mockFrom(...args) },
  readTransport: { invalidate: () => mockInvalidate() },
}));
import inventoryService from '../../src/services/inventory';
const input = {
  vesselId: 'v1',
  title: 'Supplies',
  location: 'Locker',
  description: '',
  department: 'EXTERIOR' as const,
  items: [{ amount: '12', item: 'Brushes' }],
};
const row = {
  id: 'stable-id',
  vessel_id: 'v1',
  title: 'Supplies',
  location: 'Locker',
  description: '',
  department: 'EXTERIOR',
  items: input.items,
  created_at: '2026-09-25',
  last_edited_at: '2026-09-25T00:00:00Z',
};
function chain(result: unknown) {
  const q: Record<string, jest.Mock> = {};
  for (const method of ['insert', 'update', 'select', 'eq', 'is', 'abortSignal'])
    q[method] = jest.fn(() => q);
  q.single = jest.fn(async () => result);
  q.maybeSingle = jest.fn(async () => result);
  return q;
}
beforeEach(() => jest.clearAllMocks());
it('cancels a stalled write so the durable queue can retry it', async () => {
  jest.useFakeTimers();
  const q = chain({ data: null, error: null });
  let signal!: AbortSignal;
  q.abortSignal.mockImplementation((value) => {
    signal = value;
    return q;
  });
  q.single.mockImplementation(
    () =>
      new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('Timed out')));
      })
  );
  mockFrom.mockReturnValue(q);
  const result = expect(inventoryService.autoSave('stable-id', input, null)).rejects.toThrow(
    'Timed out'
  );
  await jest.advanceTimersByTimeAsync(15_001);
  await result;
  jest.useRealTimers();
});
it('creates with the client-generated stable ID', async () => {
  const q = chain({ data: row, error: null });
  mockFrom.mockReturnValue(q);
  expect((await inventoryService.autoSave('stable-id', input, null)).id).toBe('stable-id');
  expect(q.insert).toHaveBeenCalledWith(
    expect.objectContaining({ id: 'stable-id', vessel_id: 'v1' })
  );
});
it('treats a repeated identical create as success instead of inserting a duplicate', async () => {
  mockFrom
    .mockReturnValueOnce(chain({ error: { code: '23505' } }))
    .mockReturnValueOnce(chain({ data: row, error: null }));
  expect((await inventoryService.autoSave('stable-id', input, null)).id).toBe('stable-id');
  expect(mockInvalidate).toHaveBeenCalledTimes(1);
});
it('conditions edits on the last-read revision and vessel', async () => {
  const q = chain({ data: row, error: null });
  mockFrom.mockReturnValue(q);
  await inventoryService.autoSave('stable-id', input, {
    ...input,
    id: 'stable-id',
    createdAt: '',
    lastEditedAt: row.last_edited_at,
  });
  expect(q.eq.mock.calls).toContainEqual(['vessel_id', 'v1']);
  expect(q.eq.mock.calls).toContainEqual(['last_edited_at', row.last_edited_at]);
});
it('stops when another client changed a record', async () => {
  mockFrom
    .mockReturnValueOnce(chain({ data: null, error: null }))
    .mockReturnValueOnce(chain({ data: { ...row, title: 'Changed elsewhere' }, error: null }));
  await expect(
    inventoryService.autoSave('stable-id', input, {
      ...input,
      id: 'stable-id',
      createdAt: '',
      lastEditedAt: row.last_edited_at,
    })
  ).rejects.toMatchObject({ name: 'InventoryConflictError' });
});
it('does not recreate a deleted item during an update retry', async () => {
  const q = chain({ data: null, error: null });
  mockFrom.mockReturnValue(q);
  await expect(
    inventoryService.autoSave('stable-id', input, {
      ...input,
      id: 'stable-id',
      createdAt: '',
      lastEditedAt: row.last_edited_at,
    })
  ).rejects.toMatchObject({ name: 'InventoryConflictError' });
  expect(q.insert).not.toHaveBeenCalled();
});
