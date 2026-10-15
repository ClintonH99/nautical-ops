import React, { useState } from 'react';
import { Platform, TextInput } from 'react-native';
import { render, act, fireEvent } from '@testing-library/react-native';
import { BrowserSessionBoundary } from '../../src/components/BrowserSessionBoundary';
import {
  useBrowserSessionLease,
  recordBrowserSessionResult,
  SESSION_LEASE_MS,
} from '../../src/services/browserSessionLease';

const mockSignOut = jest.fn();
const mockRpc = jest.fn().mockResolvedValue({ data: [], error: null });
jest.mock('../../src/services/supabase', () => ({
  supabase: { rpc: (...args: unknown[]) => mockRpc(...args) },
  readTransport: { invalidate: jest.fn() },
}));
jest.mock('../../src/services/auth', () => ({
  __esModule: true,
  default: { signOut: () => mockSignOut() },
}));
jest.mock('../../src/store', () => ({
  useAuthStore: { getState: () => ({ deferUserUpdate: false, logout: jest.fn() }) },
}));
jest.mock('../../src/hooks/useThemeColors', () => ({
  useThemeColors: () => ({ background: '#fff', textPrimary: '#111' }),
}));
jest.mock('../../src/screens/LostDeviceScreen', () => ({ LostDeviceScreen: () => null }));
jest.mock('../../src/components/Button', () => {
  const { Text, Pressable } = jest.requireActual('react-native');
  return {
    Button: ({ title, onPress }: { title: string; onPress: () => void }) => (
      <Pressable onPress={onPress}>
        <Text>{title}</Text>
      </Pressable>
    ),
  };
});

const previousPlatform = Platform.OS;
const oldDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
const oldWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
const events: Record<string, () => void> = {};
const mockDocument = {
  visibilityState: 'visible',
  addEventListener: (name: string, fn: () => void) => {
    events[name] = fn;
  },
  removeEventListener: jest.fn(),
};
const mockWindow = {
  addEventListener: (name: string, fn: () => void) => {
    events[name] = fn;
  },
  removeEventListener: jest.fn(),
};
const grant = () =>
  recordBrowserSessionResult({
    mode: 'active_sessions',
    user_id: 'user',
    allowed: true,
    server_time: new Date(Date.now()).toISOString(),
    lease_expires_at: new Date(Date.now() + SESSION_LEASE_MS).toISOString(),
  });
beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'web' });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: mockDocument });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: mockWindow });
  mockDocument.visibilityState = 'visible';
  useBrowserSessionLease.setState({ userId: null, status: 'checking', validUntil: 0 });
});
afterEach(() => {
  jest.useRealTimers();
  Object.defineProperty(Platform, 'OS', { configurable: true, value: previousPlatform });
  if (oldDocument) Object.defineProperty(globalThis, 'document', oldDocument);
  else Reflect.deleteProperty(globalThis, 'document');
  if (oldWindow) Object.defineProperty(globalThis, 'window', oldWindow);
  else Reflect.deleteProperty(globalThis, 'window');
});

it('expires after an hour without logging out and preserves the mounted draft', async () => {
  grant();
  function Draft() {
    const [text, setText] = useState('');
    return <TextInput testID="draft" value={text} onChangeText={setText} />;
  }
  const check = jest.fn().mockResolvedValue(undefined);
  const screen = render(
    <BrowserSessionBoundary userId="user" checkAccess={check}>
      <Draft />
    </BrowserSessionBoundary>
  );
  await act(async () => {});
  fireEvent.changeText(screen.getByTestId('draft'), 'Keep my unsaved work');
  mockDocument.visibilityState = 'hidden';
  await act(async () => {
    jest.advanceTimersByTime(SESSION_LEASE_MS - 1);
  });
  expect(screen.queryByText('Reconnecting your session')).toBeNull();
  await act(async () => {
    jest.advanceTimersByTime(1);
  });
  expect(screen.getByText('Reconnecting your session')).toBeTruthy();
  expect(mockSignOut).not.toHaveBeenCalled();
  expect(check).toHaveBeenCalledTimes(1); // No hidden heartbeats
  check.mockImplementation(async () => grant());
  mockDocument.visibilityState = 'visible';
  await act(async () => {
    events.visibilitychange();
  });
  expect(screen.queryByText('Reconnecting your session')).toBeNull();
  expect(screen.getByTestId('draft').props.value).toBe('Keep my unsaved work');
});

it('keeps a visible reading session active without clicks', async () => {
  grant();
  const check = jest.fn().mockImplementation(async () => grant());
  const screen = render(
    <BrowserSessionBoundary userId="user" checkAccess={check}>
      <TextInput />
    </BrowserSessionBoundary>
  );
  await act(async () => {});
  for (let i = 0; i < 121; i++)
    await act(async () => {
      jest.advanceTimersByTime(30_000);
    });
  expect(useBrowserSessionLease.getState().status).toBe('allowed');
  expect(screen.queryByText('Reconnecting your session')).toBeNull();
  expect(mockSignOut).not.toHaveBeenCalled();
});

it('shows a waiting screen, not login, when the returning browser cannot claim a slot', async () => {
  recordBrowserSessionResult({
    mode: 'active_sessions',
    user_id: 'user',
    allowed: false,
    reason: 'active_session_limit',
  });
  const screen = render(
    <BrowserSessionBoundary userId="user" checkAccess={async () => {}}>
      <TextInput />
    </BrowserSessionBoundary>
  );
  await act(async () => {});
  expect(screen.getByText('Two browsers are already saved')).toBeTruthy();
  expect(screen.getByText('Verify and end another session')).toBeTruthy();
  expect(mockSignOut).not.toHaveBeenCalled();
});

it('never releases a saved slot or blocks it merely because the browser is inactive', async () => {
  recordBrowserSessionResult({ mode: 'saved_browsers', user_id: 'user', allowed: true });
  const check = jest.fn().mockResolvedValue(undefined);
  const screen = render(
    <BrowserSessionBoundary userId="user" checkAccess={check}>
      <TextInput testID="saved-draft" />
    </BrowserSessionBoundary>
  );
  await act(async () => {});
  mockDocument.visibilityState = 'hidden';
  await act(async () => {
    jest.advanceTimersByTime(2 * SESSION_LEASE_MS);
  });
  expect(screen.queryByText('Reconnecting your session')).toBeNull();
  expect(useBrowserSessionLease.getState().status).toBe('allowed');
  expect(check).toHaveBeenCalledTimes(1);
  expect(mockSignOut).not.toHaveBeenCalled();
});
