/** @jest-environment node */

const storage = new Map<string, string>();
const mockGetItem = jest.fn(async (key: string) => storage.get(key) ?? null);
const mockSetItem = jest.fn(async (key: string, value: string) => {
  storage.set(key, value);
});
const mockRemoveItem = jest.fn(async (key: string) => {
  storage.delete(key);
});
const mockRandomUuid = jest
  .fn()
  .mockReturnValueOnce('11111111-1111-4111-8111-111111111111')
  .mockReturnValueOnce('22222222-2222-4222-8222-222222222222')
  .mockReturnValue('33333333-3333-4333-8333-333333333333');

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: (...args: [string]) => mockGetItem(...args),
  setItem: (...args: [string, string]) => mockSetItem(...args),
  removeItem: (...args: [string]) => mockRemoveItem(...args),
}));

jest.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digestStringAsync: jest.fn(async (_algorithm: string, value: string) => value),
  randomUUID: () => mockRandomUuid(),
}));

import {
  __fuelRequestTesting,
  acquireFuelRequest,
  completeFuelRequest,
} from '../../src/services/fuelRequestId';

describe('persistent fuel request IDs', () => {
  beforeEach(() => {
    storage.clear();
    mockGetItem.mockClear();
    mockSetItem.mockClear();
    mockRemoveItem.mockClear();
    mockRandomUuid.mockReset();
    mockRandomUuid
      .mockReturnValueOnce('11111111-1111-4111-8111-111111111111')
      .mockReturnValueOnce('22222222-2222-4222-8222-222222222222')
      .mockReturnValue('33333333-3333-4333-8333-333333333333');
    __fuelRequestTesting.reset();
  });

  it('reuses one UUID for the same canonical payload across an app restart', async () => {
    const first = await acquireFuelRequest('receipt:vessel-1', { amount: 10, tank: 'port' });
    __fuelRequestTesting.reset();
    const afterRestart = await acquireFuelRequest('receipt:vessel-1', {
      tank: 'port',
      amount: 10,
    });

    expect(afterRestart.id).toBe(first.id);
    expect(mockRandomUuid).toHaveBeenCalledTimes(1);
  });

  it('rotates the UUID when the user changes the pending payload', async () => {
    const first = await acquireFuelRequest('transfer:vessel-1', { amount: 10 });
    const changed = await acquireFuelRequest('transfer:vessel-1', { amount: 11 });

    expect(changed.id).not.toBe(first.id);
    expect(mockRandomUuid).toHaveBeenCalledTimes(2);
  });

  it('uses distinct UUIDs for create and amend scopes even with identical payloads', async () => {
    const payload = { transferId: 'transfer-1', amount: 10 };
    const created = await acquireFuelRequest('transfer:create:vessel-1', payload);
    const amended = await acquireFuelRequest('transfer:amend:transfer-1', payload);

    expect(amended.id).not.toBe(created.id);
    expect(mockRandomUuid).toHaveBeenCalledTimes(2);
  });

  it('retains an unresolved request when the payload changes and is later restored', async () => {
    const first = await acquireFuelRequest('transfer:vessel-1', { amount: 10 });
    await acquireFuelRequest('transfer:vessel-1', { amount: 11 });
    __fuelRequestTesting.reset();

    const restored = await acquireFuelRequest('transfer:vessel-1', { amount: 10 });

    expect(restored.id).toBe(first.id);
    expect(mockRandomUuid).toHaveBeenCalledTimes(2);
  });

  it('serializes concurrent acquisitions for the same request', async () => {
    const [first, second] = await Promise.all([
      acquireFuelRequest('entry:vessel-1:tank-1', { amount: 4 }),
      acquireFuelRequest('entry:vessel-1:tank-1', { amount: 4 }),
    ]);

    expect(second.id).toBe(first.id);
    expect(mockRandomUuid).toHaveBeenCalledTimes(1);
  });

  it('clears only the server-acknowledged request', async () => {
    const request = await acquireFuelRequest('opening:vessel-1', { tank: 'port', amount: 0 });
    await completeFuelRequest(request);
    __fuelRequestTesting.reset();
    const next = await acquireFuelRequest('opening:vessel-1', { tank: 'port', amount: 0 });

    expect(next.id).not.toBe(request.id);
    expect(mockRemoveItem).toHaveBeenCalledWith(request.storageKey);
  });

  it('fails closed before a network write when the pending UUID cannot be persisted', async () => {
    mockSetItem.mockRejectedValueOnce(new Error('Storage unavailable'));

    await expect(
      acquireFuelRequest('receipt:vessel-1', { amount: 10, tank: 'port' })
    ).rejects.toThrow('No data was sent');

    expect(storage.size).toBe(0);
  });

  it('fails closed when a possibly unresolved pending request cannot be read', async () => {
    mockGetItem.mockRejectedValueOnce(new Error('Storage read unavailable'));

    await expect(
      acquireFuelRequest('receipt:vessel-1', { amount: 10, tank: 'port' })
    ).rejects.toThrow('No data was sent');

    expect(mockSetItem).not.toHaveBeenCalled();
    expect(mockRandomUuid).not.toHaveBeenCalled();
  });

  it('fails closed instead of replacing a malformed pending request', async () => {
    const request = await acquireFuelRequest('receipt:vessel-1', {
      amount: 10,
      tank: 'port',
    });
    storage.set(request.storageKey, '{malformed');
    __fuelRequestTesting.reset();
    mockSetItem.mockClear();
    mockRandomUuid.mockClear();

    await expect(
      acquireFuelRequest('receipt:vessel-1', { tank: 'port', amount: 10 })
    ).rejects.toThrow('No data was sent');

    expect(mockSetItem).not.toHaveBeenCalled();
    expect(mockRandomUuid).not.toHaveBeenCalled();
  });

  it('does not replay an acknowledged UUID when cleanup fails, including after restart', async () => {
    const request = await acquireFuelRequest('receipt:vessel-1', {
      amount: 10,
      tank: 'port',
    });
    mockRemoveItem.mockRejectedValueOnce(new Error('Cleanup unavailable'));

    await completeFuelRequest(request);
    expect(JSON.parse(storage.get(request.storageKey) ?? '{}')).toEqual(
      expect.objectContaining({ id: request.id, acknowledgedAt: expect.any(Number) })
    );

    __fuelRequestTesting.reset();
    const next = await acquireFuelRequest('receipt:vessel-1', {
      amount: 10,
      tank: 'port',
    });

    expect(next.id).not.toBe(request.id);
    expect(mockRandomUuid).toHaveBeenCalledTimes(2);
  });
});
