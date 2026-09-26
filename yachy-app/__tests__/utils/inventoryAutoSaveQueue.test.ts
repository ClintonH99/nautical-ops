/** @jest-environment node */
import { InventoryAutoSaveQueue, InventoryValues } from '../../src/utils/inventoryAutoSaveQueue';
import type { InventoryItem } from '../../src/services/inventory';

const values: InventoryValues = {
  title: 'Deck Supplies',
  department: 'EXTERIOR',
  location: 'Locker',
  description: '',
  items: [{ amount: '12', item: 'Brushes' }],
};
const record = (fields = values): InventoryItem => ({
  ...fields,
  id: 'one',
  vesselId: 'vessel',
  createdAt: '2026-09-25',
  lastEditedAt: '2026-09-25T00:00:00Z',
});
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
function setup(initial: string | null = null) {
  let disk = initial;
  const read = jest.fn(async () => disk);
  const write = jest.fn(async (value: string) => {
    disk = value;
  });
  const canSync = jest.fn(() => true);
  const save = jest.fn(async (_entry, attempt) => record(attempt.values));
  const queue = new InventoryAutoSaveQueue({ read, write, canSync, save });
  return { queue, read, write, canSync, save, disk: () => disk };
}
const settle = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve();
};

describe('Inventory Auto Save queue', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('defaults on, stores each edit locally immediately, then quietly saves after typing pauses', async () => {
    const h = setup();
    await h.queue.load();
    expect(h.queue.getSnapshot().enabled).toBe(true);
    h.queue.open('one', values, null, true);
    h.queue.change('one', { ...values, items: [{ amount: '13', item: 'Brushes' }] });
    await settle();
    expect(JSON.parse(h.disk()!).entries.one.values.items[0].amount).toBe('13');
    expect(h.save).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(650);
    expect(h.save).toHaveBeenCalledTimes(1);
    expect(h.queue.getSnapshot().entries.one.savedVersion).toBe(1);
  });

  it('serializes requests and saves typing that arrives during the first save', async () => {
    const h = setup();
    await h.queue.load();
    const first = deferred<InventoryItem>();
    h.save.mockReturnValueOnce(first.promise);
    h.queue.open('one', values, record());
    h.queue.change('one', { ...values, title: 'First' });
    const saving = h.queue.save('one');
    await settle();
    h.queue.change('one', { ...values, title: 'Latest' });
    await settle();
    expect(h.save).toHaveBeenCalledTimes(1);
    first.resolve(record({ ...values, title: 'First' }));
    await saving;
    expect(h.save).toHaveBeenCalledTimes(2);
    expect(h.save.mock.calls[1][1].values.title).toBe('Latest');
    expect(h.queue.getSnapshot().entries.one.savedVersion).toBe(2);
  });

  it('remembers Disable Auto Save and allows explicit manual saving', async () => {
    const h = setup();
    await h.queue.load();
    await h.queue.setEnabled(false);
    h.queue.open('one', values, null, true);
    h.queue.change('one', values);
    await jest.advanceTimersByTimeAsync(1000);
    expect(h.save).not.toHaveBeenCalled();
    const restored = setup(h.disk());
    await restored.queue.load();
    expect(restored.queue.getSnapshot().enabled).toBe(false);
    await restored.queue.save('one', true);
    expect(restored.save).toHaveBeenCalledTimes(1);
  });

  it('recovers an uncertain create using the same ID and exact first payload before newer edits', async () => {
    const h = setup();
    await h.queue.load();
    h.queue.open('one', values, null, true);
    h.queue.change('one', values);
    h.save.mockRejectedValueOnce(new Error('lost response'));
    await expect(h.queue.save('one')).rejects.toThrow('lost response');
    h.queue.change('one', { ...values, title: 'Newer text' });
    await settle();
    const restored = setup(h.disk());
    await restored.queue.load();
    await restored.queue.flush();
    expect(restored.save.mock.calls.map(([entry]) => entry.id)).toEqual(['one', 'one']);
    expect(restored.save.mock.calls.map(([, attempt]) => attempt.values.title)).toEqual([
      'Deck Supplies',
      'Newer text',
    ]);
    expect(restored.save.mock.calls[1][1].base).not.toBeNull();
  });

  it('keeps untitled input locally without publishing an invalid empty item', async () => {
    const h = setup();
    await h.queue.load();
    h.queue.open('one', { ...values, title: '' }, null, true);
    h.queue.change('one', { ...values, title: '', description: 'Do not lose this' });
    await h.queue.leave('one');
    expect(h.save).not.toHaveBeenCalled();
    const restored = setup(h.disk());
    await restored.queue.load();
    expect(restored.queue.getSnapshot().newItemId).toBe('one');
    expect(restored.queue.getSnapshot().entries.one.values.description).toBe('Do not lose this');
  });

  it('continues saving when leaving the screen without waiting for the typing timer', async () => {
    const h = setup();
    await h.queue.load();
    h.queue.open('one', values, null, true);
    h.queue.change('one', values);
    await h.queue.leave('one');
    expect(h.save).toHaveBeenCalledTimes(1);
    expect(h.queue.getSnapshot().newItemId).toBeUndefined();
  });

  it('never syncs another account or vessel queue', async () => {
    const h = setup();
    await h.queue.load();
    h.queue.open('one', values, record());
    h.queue.change('one', values);
    h.canSync.mockReturnValue(false);
    await h.queue.flush();
    await jest.advanceTimersByTimeAsync(1000);
    expect(h.save).not.toHaveBeenCalled();
  });

  it('blocks conflicts instead of repeatedly overwriting another edit', async () => {
    const h = setup();
    await h.queue.load();
    h.queue.open('one', values, record());
    h.queue.change('one', values);
    const conflict = new Error('conflict');
    conflict.name = 'InventoryConflictError';
    h.save.mockRejectedValueOnce(conflict);
    await h.queue.flush();
    await h.queue.flush();
    expect(h.save).toHaveBeenCalledTimes(1);
    expect(h.queue.getSnapshot().entries.one.blocked).toBe(true);
    await h.queue.resolve('one', record({ ...values, title: 'Other edit' }), false);
    expect(h.queue.getSnapshot().entries.one.values.title).toBe('Other edit');
    expect(h.queue.getSnapshot().entries.one.blocked).toBe(false);
  });

  it('does not send a create until its stable identity is safely stored', async () => {
    const h = setup();
    await h.queue.load();
    h.queue.open('one', values, null, true);
    h.write.mockRejectedValue(new Error('disk full'));
    h.queue.change('one', values);
    await h.queue.flush();
    expect(h.save).not.toHaveBeenCalled();
    expect(h.queue.getSnapshot().storageError).toBeDefined();
  });

  it('waits for a running save before deleting and never recreates it afterward', async () => {
    const h = setup();
    await h.queue.load();
    h.queue.open('one', values, null, true);
    h.queue.change('one', values);
    const first = deferred<InventoryItem>();
    h.save.mockReturnValueOnce(first.promise);
    const saving = h.queue.save('one');
    await settle();
    const remove = jest.fn(async () => {});
    const deleting = h.queue.delete('one', remove);
    await settle();
    expect(remove).not.toHaveBeenCalled();
    first.resolve(record());
    await saving;
    await deleting;
    await jest.advanceTimersByTimeAsync(1000);
    await h.queue.flush();
    expect(remove).toHaveBeenCalledWith(true);
    expect(h.save).toHaveBeenCalledTimes(1);
    expect(h.queue.getSnapshot().entries.one).toBeUndefined();
  });

  it('does not replay a deletion interrupted by closing the app', async () => {
    const h = setup();
    await h.queue.load();
    h.queue.open('one', values, null, true);
    h.queue.change('one', values);
    const deleting = deferred<void>();
    const operation = h.queue.delete('one', () => deleting.promise);
    await settle();
    const restored = setup(h.disk());
    await restored.queue.load();
    await restored.queue.flush();
    expect(restored.save).not.toHaveBeenCalled();
    deleting.resolve();
    await operation;
  });
});
