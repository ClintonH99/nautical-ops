import React, { useState } from 'react';
import { Text, TextInput } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';
import { create } from 'zustand';
import type { OfflineStatus } from '../../src/offline/runtime';
const mockRetry = jest.fn().mockResolvedValue(undefined);
const mockAuth = create(() => ({
  user: { id: 'u1', vesselId: 'v1' },
  captainPaymentRequired: false,
  crewPaymentRequired: false,
}));
const mockStatus = create<OfflineStatus>(() => ({
  enabled: true,
  ready: false,
  saving: 0,
  shellState: 'ready',
  disconnected: true,
  pending: 2,
  issue: null,
  expiresAt: null,
  conflicts: [],
  recoverable: 0,
}));
const mockRoute = create(() => ({ name: 'Home' }));
const mockLease = create(() => ({ userId: null as string | null, status: 'allowed' }));
jest.mock('../../src/store', () => ({
  get useAuthStore() {
    return mockAuth;
  },
}));
jest.mock('../../src/services/browserSessionLease', () => ({
  get useBrowserSessionLease() {
    return mockLease;
  },
}));
jest.mock('../../src/offline/runtime.web', () => ({
  webOfflineEnabled: true,
  get useOfflineStatus() {
    return mockStatus;
  },
  get useOfflineRoute() {
    return mockRoute;
  },
  prepareOffline: jest.fn(),
  checkOfflineAccess: jest.fn(),
  retryOfflineAccess: () => mockRetry(),
}));
jest.mock('../../src/offline/registerShell.web', () => ({
  registerOfflineShell: async () => true,
}));
jest.mock('../../src/hooks/useThemeColors', () => ({
  useThemeColors: () => ({ background: '#fff', textPrimary: '#111', textSecondary: '#555' }),
}));
import { OfflineBoundary } from '../../src/offline/OfflineBoundary.web';
const old = Object.fromEntries(
  ['window', 'document', 'location', 'navigator'].map((k) => [
    k,
    Object.getOwnPropertyDescriptor(globalThis, k),
  ])
);
function Draft() {
  const [text, setText] = useState('Unsynced vessel note');
  return (
    <>
      <Text>Vessel page</Text>
      <TextInput testID="draft" value={text} onChangeText={setText} />
    </>
  );
}
beforeEach(() => {
  jest.useFakeTimers();
  mockRetry.mockReset().mockResolvedValue(undefined);
  mockAuth.setState({
    user: { id: 'u1', vesselId: 'v1' },
    captainPaymentRequired: false,
    crewPaymentRequired: false,
  });
  mockStatus.setState({
    disconnected: true,
    ready: false,
    conflicts: [],
    recoverable: 0,
    pending: 2,
    saving: 0,
    issue: 'Reconnect to verify offline access.',
  });
  mockLease.setState({ userId: null, status: 'allowed' });
  mockRoute.setState({ name: 'Home' });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: true } });
  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    value: { pathname: '/app' },
  });
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { addEventListener: jest.fn(), removeEventListener: jest.fn() },
  });
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      visibilityState: 'visible',
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    },
  });
});
afterEach(() => {
  jest.useRealTimers();
  for (const key of Object.keys(old)) {
    if (old[key]) Object.defineProperty(globalThis, key, old[key]!);
    else Reflect.deleteProperty(globalThis, key);
  }
});
it.each(['captainPaymentRequired', 'crewPaymentRequired'])(
  'never masks the online %s recovery page',
  async (flag) => {
    mockAuth.setState({ [flag]: true });
    const ui = render(
      <OfflineBoundary>
        <Draft />
      </OfflineBoundary>
    );
    await act(async () => {});
    expect(ui.queryByText('Reconnect to continue')).toBeNull();
    expect(ui.getByText('Vessel page')).toBeTruthy();
  }
);
it('does not hide browser-session recovery behind the offline gate', async () => {
  mockLease.setState({ userId: 'u1', status: 'limited' });
  const ui = render(
    <OfflineBoundary>
      <Draft />
    </OfflineBoundary>
  );
  await act(async () => {});
  expect(ui.queryByText('Reconnect to continue')).toBeNull();
});
it('makes online Vessel Plans reachable before an offline permit exists', async () => {
  mockRoute.setState({ name: 'VesselPlans' });
  const ui = render(
    <OfflineBoundary>
      <Draft />
    </OfflineBoundary>
  );
  await act(async () => {});
  expect(ui.queryByText('Reconnect to continue')).toBeNull();
});
it('keeps expired offline access locked in airplane mode', async () => {
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: false } });
  mockAuth.setState({ captainPaymentRequired: true });
  const ui = render(
    <OfflineBoundary>
      <Draft />
    </OfflineBoundary>
  );
  await act(async () => {});
  expect(ui.getByText('Reconnect to continue')).toBeTruthy();
  expect(ui.getByText('Retry connection')).toBeTruthy();
});
it('retry keeps open form contents and pending edits intact', async () => {
  mockStatus.setState({ disconnected: false });
  const ui = render(
    <OfflineBoundary>
      <Draft />
    </OfflineBoundary>
  );
  await act(async () => {});
  fireEvent.changeText(ui.getByTestId('draft'), 'Still unsynced');
  act(() => mockStatus.setState({ disconnected: true }));
  await act(async () => {
    fireEvent.press(ui.getByText('Retry connection'));
  });
  expect(mockRetry).toHaveBeenCalledTimes(1);
  act(() => mockStatus.setState({ disconnected: false }));
  expect(ui.getByTestId('draft').props.value).toBe('Still unsynced');
  expect(mockStatus.getState().pending).toBe(2);
});
