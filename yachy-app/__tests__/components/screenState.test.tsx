import { act, renderHook } from '@testing-library/react-native';
import { useScreenState, useScreenLoading } from '../../src/hooks/useScreenState';
import { setScreenCacheScope, withoutPendingRemovals } from '../../src/utils/screenCache';
import { optimisticDelete } from '../../src/utils/optimisticDelete';

let mockUser = { id: 'one', vesselId: 'vessel-one', role: 'CREW', department: 'INTERIOR' };
let mockRoute = { name: 'ContractorDatabase', params: {} };
jest.mock('@react-navigation/native', () => ({ useRoute: () => mockRoute }));
jest.mock('../../src/store', () => ({
  useAuthStore: (selector: (state: unknown) => unknown) => selector({ user: mockUser }),
}));
const useList = () => {
  const [items, setItems] = useScreenState<{ id: string }[]>('items', []);
  const [loading, setLoading] = useScreenLoading();
  return { items, setItems, loading, setLoading };
};

beforeEach(() => {
  setScreenCacheScope('reset');
  setScreenCacheScope('one');
  mockUser = { id: 'one', vesselId: 'vessel-one', role: 'CREW', department: 'INTERIOR' };
  mockRoute = { name: 'ContractorDatabase', params: {} };
});

it('restores records on re-entry and never hides them for a focus refresh', () => {
  const first = renderHook(useList);
  act(() => {
    first.result.current.setItems([{ id: 'a' }]);
    first.result.current.setLoading(false);
  });
  first.unmount();
  const second = renderHook(useList);
  expect(second.result.current.items).toEqual([{ id: 'a' }]);
  expect(second.result.current.loading).toBe(false);
  act(() => second.result.current.setLoading(true));
  expect(second.result.current.loading).toBe(false);
});

it('clears the displayed data on account/vessel switch and ignores the old request callback', () => {
  const screen = renderHook(useList);
  const stale = screen.result.current.setItems;
  act(() => screen.result.current.setItems([{ id: 'private' }]));
  mockUser = { ...mockUser, id: 'two', vesselId: 'vessel-two' };
  setScreenCacheScope('two');
  screen.rerender({});
  expect(screen.result.current.items).toEqual([]);
  act(() => stale([{ id: 'old-network-response' }]));
  expect(screen.result.current.items).toEqual([]);
  expect(screen.result.current.loading).toBe(true);
});

it('separates different categories on the same screen', () => {
  mockRoute = { name: 'TasksList', params: { type: 'WEEKLY' } };
  const screen = renderHook(useList);
  act(() => screen.result.current.setItems([{ id: 'weekly' }]));
  mockRoute = { name: 'TasksList', params: { type: 'MONTHLY' } };
  screen.rerender({});
  expect(screen.result.current.items).toEqual([]);
});

it('rolls back only a failed deletion without discarding another change', async () => {
  const screen = renderHook(useList);
  act(() => screen.result.current.setItems([{ id: 'a' }, { id: 'b' }]));
  let reject!: (reason: Error) => void;
  let operation!: Promise<void>;
  act(() => {
    operation = optimisticDelete(
      { id: 'a' },
      screen.result.current.setItems,
      () =>
        new Promise((_resolve, fail) => {
          reject = fail;
        })
    );
  });
  expect(screen.result.current.items).toEqual([{ id: 'b' }]);
  expect(withoutPendingRemovals([{ id: 'a' }, { id: 'b' }])).toEqual([{ id: 'b' }]);
  act(() => screen.result.current.setItems((current) => [...current, { id: 'c' }]));
  await act(async () => {
    reject(new Error('offline'));
    await expect(operation).rejects.toThrow('offline');
  });
  expect(screen.result.current.items).toEqual([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
});

it('does not restore a failed old-account deletion into a new account', async () => {
  const screen = renderHook(useList);
  act(() => screen.result.current.setItems([{ id: 'private' }]));
  let reject!: (reason: Error) => void;
  let operation!: Promise<void>;
  act(() => {
    operation = optimisticDelete(
      { id: 'private' },
      screen.result.current.setItems,
      () =>
        new Promise((_resolve, fail) => {
          reject = fail;
        })
    );
  });
  setScreenCacheScope('two');
  mockUser = { ...mockUser, id: 'two' };
  screen.rerender({});
  await act(async () => {
    reject(new Error('offline'));
    await expect(operation).rejects.toThrow('offline');
  });
  expect(screen.result.current.items).toEqual([]);
});
