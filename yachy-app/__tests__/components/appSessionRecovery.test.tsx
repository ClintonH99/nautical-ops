import React from 'react';
import { Platform } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import App from '../../App';
import { useBrowserSessionLease } from '../../src/services/browserSessionLease';

const mockStart = jest.fn().mockResolvedValue(undefined);
const mockDispose = jest.fn().mockResolvedValue(undefined);
jest.mock('../../src/lib/sentry', () => ({}));
jest.mock('@sentry/react-native', () => ({ wrap: (component: unknown) => component }));
jest.mock('expo-font', () => ({ useFonts: () => [true] }));
jest.mock('expo-status-bar', () => ({ StatusBar: () => null }));
jest.mock('react-native-gesture-handler', () => ({
  GestureHandlerRootView: jest.requireActual('react-native').View,
}));
jest.mock('../../src/utils/installWebViewport', () => ({ installWebViewport: () => undefined }));
jest.mock('../../src/services/supabase', () => ({
  isSupabaseConfigured: () => true,
  supabase: { rpc: jest.fn().mockResolvedValue({ data: [], error: null }) },
  readTransport: { invalidate: jest.fn() },
}));
jest.mock('../../src/services/auth', () => ({ __esModule: true, default: { signOut: jest.fn() } }));
jest.mock('../../src/store', () => ({
  useAuthStore: { getState: () => ({ deferUserUpdate: false }) },
}));
jest.mock('../../src/hooks/useThemeColors', () => ({
  useThemeColors: () => ({ background: '#fff', textPrimary: '#111' }),
}));
jest.mock('../../src/services/deviceManagement', () => ({
  createDeviceRecovery: () => ({ start: mockStart, dispose: mockDispose }),
}));
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ goBack: jest.fn() }) }));
jest.mock('../../src/components/InfoModal', () => ({ InfoModal: () => null }));
jest.mock('../../src/components', () => ({
  // Keep the real header and its safe-area hook: the former mock hid the crash.
  PageHeader: jest.requireActual('../../src/components/PageHeader').PageHeader,
  Button: jest.requireActual('../../src/components/Button').Button,
  Input: ({ label, ...props }: { label: string }) => {
    const { TextInput } = jest.requireActual('react-native');
    return <TextInput accessibilityLabel={label} {...props} />;
  },
}));
jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  // Seed native measurements, but do NOT mock the provider or safe-area hook.
  initialWindowMetrics: {
    frame: { x: 0, y: 0, width: 390, height: 844 },
    insets: { top: 47, bottom: 34, left: 0, right: 0 },
  },
}));
jest.mock('../../src/navigation/RootNavigator', () => ({
  RootNavigator: () => {
    const { BrowserSessionBoundary } = jest.requireActual(
      '../../src/components/BrowserSessionBoundary'
    );
    return (
      <BrowserSessionBoundary userId="user" checkAccess={async () => {}}>
        {null}
      </BrowserSessionBoundary>
    );
  },
}));

it('opens real recovery outside the navigator, validates, sends a code and returns without a blank screen', async () => {
  const previousPlatform = Platform.OS;
  const oldDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'web' });
  const events = { addEventListener: jest.fn(), removeEventListener: jest.fn() };
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      ...events,
      visibilityState: 'visible',
      createElement: () => ({}),
      head: { appendChild: jest.fn(), removeChild: jest.fn() },
    },
  });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: events });
  useBrowserSessionLease.setState({ userId: 'user', status: 'limited', validUntil: 0 });
  const screen = render(<App />);
  try {
    await act(async () => {});
    fireEvent.press(screen.getByText('Verify and end another session'));
    expect(screen.getByText('Recover your access')).toBeTruthy();
    fireEvent.press(screen.getByText('Verify account and send code'));
    await waitFor(() =>
      expect(screen.getByText('Enter your account email and password.')).toBeTruthy()
    );
    expect(mockStart).not.toHaveBeenCalled();
    fireEvent.changeText(screen.getByLabelText('Email'), 'test@example.com');
    fireEvent.changeText(screen.getByLabelText('Password'), 'test-only-password');
    fireEvent.press(screen.getByText('Verify account and send code'));
    await waitFor(() => expect(screen.getByText('Check your email')).toBeTruthy());
    expect(mockStart).toHaveBeenCalledWith('test@example.com', 'test-only-password');
    fireEvent.press(screen.getByLabelText('Go back'));
    await waitFor(() => expect(screen.getByText('Two browsers are already saved')).toBeTruthy());
  } finally {
    screen.unmount();
    Object.defineProperty(Platform, 'OS', { configurable: true, value: previousPlatform });
    if (oldDocument) Object.defineProperty(globalThis, 'document', oldDocument);
    else Reflect.deleteProperty(globalThis, 'document');
    if (oldWindow) Object.defineProperty(globalThis, 'window', oldWindow);
    else Reflect.deleteProperty(globalThis, 'window');
    useBrowserSessionLease.setState({ userId: null, status: 'checking', validUntil: 0 });
  }
});
