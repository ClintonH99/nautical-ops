/** @jest-environment jsdom */
import { act, renderHook, cleanup } from '@testing-library/react-native/pure';
import { Platform } from 'react-native';
import { useHomeVesselName } from '../../src/hooks/useHomeVesselName';
import vesselService from '../../src/services/vessel';

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (callback: () => void) =>
    jest.requireActual('react').useEffect(callback, [callback]),
}));
jest.mock('../../src/services/vessel', () => ({
  __esModule: true,
  default: { getVessel: jest.fn() },
}));

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
});
afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

it('recovers a missing name automatically after a null startup response', async () => {
  jest
    .mocked(vesselService.getVessel)
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce({ name: 'Test yacht' } as any);
  const onName = jest.fn();
  const ui = renderHook(() => useHomeVesselName('vessel', onName));
  await act(async () => {});
  expect(ui.result.current.unavailable).toBe(true);
  await act(async () => {
    jest.advanceTimersByTime(1000);
  });
  expect(onName).toHaveBeenCalledWith('Test yacht');
  expect(ui.result.current.unavailable).toBe(false);
});

it('preserves a loaded name through failures and bounds retries', async () => {
  jest
    .mocked(vesselService.getVessel)
    .mockResolvedValueOnce({ name: 'Test yacht' } as any)
    .mockResolvedValue(null);
  const onName = jest.fn();
  const ui = renderHook(() => useHomeVesselName('vessel', onName));
  await act(async () => {});
  await act(async () => {
    ui.result.current.refresh();
  });
  for (const delay of [1000, 3000, 8000, 60000]) {
    await act(async () => {
      jest.advanceTimersByTime(delay);
    });
  }
  expect(vesselService.getVessel).toHaveBeenCalledTimes(5);
  expect(onName.mock.calls).toEqual([['Test yacht']]);
});

it('ignores an old vessel response after switching vessels', async () => {
  let finish!: (value: any) => void;
  jest
    .mocked(vesselService.getVessel)
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    )
    .mockResolvedValue({ name: 'New yacht' } as any);
  const onName = jest.fn();
  const ui = renderHook<ReturnType<typeof useHomeVesselName>, { id: string }>(
    ({ id }) => useHomeVesselName(id, onName),
    { initialProps: { id: 'old' } }
  );
  ui.rerender({ id: 'new' });
  await act(async () => {});
  await act(async () => {
    finish({ name: 'Old yacht' });
  });
  expect(onName.mock.calls).toEqual([['New yacht']]);
});

it('does not write or retry after unmount', async () => {
  let finish!: (value: any) => void;
  jest.mocked(vesselService.getVessel).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  const onName = jest.fn();
  const ui = renderHook(() => useHomeVesselName('vessel', onName));
  ui.unmount();
  await act(async () => {
    finish(null);
    jest.advanceTimersByTime(60000);
  });
  expect(onName).not.toHaveBeenCalled();
  expect(vesselService.getVessel).toHaveBeenCalledTimes(1);
});

it('does not request vessel details without a vessel', async () => {
  renderHook(() => useHomeVesselName(null, jest.fn()));
  await act(async () => {});
  expect(vesselService.getVessel).not.toHaveBeenCalled();
});

it('refreshes on web reconnect/resume and removes listeners on unmount', async () => {
  const original = Platform.OS;
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'web' });
  Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  jest.mocked(vesselService.getVessel).mockResolvedValue({ name: 'Test yacht' } as any);
  const onName = jest.fn();
  try {
    const ui = renderHook(() => useHomeVesselName('vessel', onName));
    await act(async () => {});
    await act(async () => {
      window.dispatchEvent(new Event('online'));
    });
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(onName).toHaveBeenCalledTimes(3);
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(onName).toHaveBeenCalledTimes(3);
    ui.unmount();
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    await act(async () => {
      window.dispatchEvent(new Event('online'));
    });
    expect(onName).toHaveBeenCalledTimes(3);
  } finally {
    Object.defineProperty(Platform, 'OS', { configurable: true, value: original });
  }
});
