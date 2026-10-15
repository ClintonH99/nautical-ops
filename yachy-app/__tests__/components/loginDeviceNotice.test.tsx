import React from 'react';
import { Alert } from 'react-native';
import { render, fireEvent, waitFor } from '@testing-library/react-native';

const mockSignIn = jest.fn();
const mockAccess = jest.fn();
const mockSignOut = jest.fn();
const mockStore = {
  loginNotice: 'Saved device warning',
  deferUserUpdate: false,
  setLoginNotice: jest.fn(),
  setUser: jest.fn(),
  setCaptainPaymentRequired: jest.fn(),
  setCrewPaymentRequired: jest.fn(),
};
jest.mock('../../src/store', () => ({
  useAuthStore: Object.assign(() => mockStore, { getState: () => mockStore }),
}));
jest.mock('../../src/services/auth', () => ({
  __esModule: true,
  default: { signIn: (...args: unknown[]) => mockSignIn(...args) },
}));
jest.mock('../../src/services/accountAccess', () => ({
  evaluateAccountAccess: (...args: unknown[]) => mockAccess(...args),
}));
jest.mock('../../src/services/supabase', () => ({
  supabase: { auth: { signOut: (...args: unknown[]) => mockSignOut(...args) } },
}));
jest.mock('../../src/services/deviceAccess', () => ({
  DEVICE_LIMIT_MESSAGE: 'Two device limit',
  DEVICE_SESSION_REVOKED_MESSAGE: 'Device session revoked',
}));
jest.mock('posthog-react-native', () => ({
  usePostHog: () => ({ identify: jest.fn(), capture: jest.fn() }),
}));
jest.mock('../../src/hooks/useThemeColors', () => ({
  useThemeColors: () => ({ background: '#fff', surface: '#fff', textPrimary: '#111' }),
}));
jest.mock('../../src/components', () => {
  const { TextInput, Pressable, Text } = jest.requireActual('react-native');
  return {
    Input: ({ label, ...props }: { label: string }) => (
      <TextInput accessibilityLabel={label} {...props} />
    ),
    Button: ({ title, onPress }: { title: string; onPress: () => void }) => (
      <Pressable accessibilityLabel={title} onPress={onPress}>
        <Text>{title}</Text>
      </Pressable>
    ),
  };
});
import { LoginScreen } from '../../src/screens/LoginScreen';

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  mockSignIn.mockResolvedValue({ user: { id: 'user', email: 'test@example.com' } });
  mockAccess.mockResolvedValue({ state: 'allowed' });
  mockSignOut.mockResolvedValue({});
});
afterEach(() => jest.restoreAllMocks());

const fillDetails = (screen: ReturnType<typeof render>) => {
  fireEvent.changeText(screen.getByLabelText('Email'), 'test@example.com');
  fireEvent.changeText(screen.getByLabelText('Password'), 'password123');
};

it('hides a restored notice on arrival, while typing and on an empty submission', () => {
  const screen = render(<LoginScreen navigation={{}} />);
  expect(screen.queryByText(mockStore.loginNotice)).toBeNull();
  fireEvent.press(screen.getByLabelText('Sign in'));
  expect(mockSignIn).not.toHaveBeenCalled();
  fillDetails(screen);
  expect(screen.queryByText(mockStore.loginNotice)).toBeNull();
  expect(mockAccess).not.toHaveBeenCalled();
});

it.each([
  ['device_limit_reached', 'Two device limit'],
  ['device_session_revoked', 'Device session revoked'],
])('shows %s only after sign-in and clears it when details change', async (state, message) => {
  mockAccess.mockResolvedValue({ state });
  const screen = render(<LoginScreen navigation={{}} />);
  fillDetails(screen);
  expect(screen.queryByText(message)).toBeNull();
  fireEvent.press(screen.getByLabelText('Sign in'));
  await waitFor(() => expect(screen.getByText(message)).toBeTruthy());
  await waitFor(() => expect(mockSignOut).toHaveBeenCalledWith({ scope: 'local' }));
  expect(mockStore.setUser).toHaveBeenCalledWith(null);
  fireEvent.changeText(screen.getByLabelText('Email'), 'another@example.com');
  expect(screen.queryByText(message)).toBeNull();
  fireEvent.press(screen.getByLabelText('Sign in'));
  await waitFor(() => expect(screen.getByText(message)).toBeTruthy());
  fireEvent.changeText(screen.getByLabelText('Password'), 'anotherPassword');
  expect(screen.queryByText(message)).toBeNull();
});

it('does not show the previous notice after a successful sign-in', async () => {
  const screen = render(<LoginScreen navigation={{}} />);
  fillDetails(screen);
  fireEvent.press(screen.getByLabelText('Sign in'));
  await waitFor(() =>
    expect(mockStore.setUser).toHaveBeenCalledWith(expect.objectContaining({ id: 'user' }))
  );
  expect(screen.queryByText(mockStore.loginNotice)).toBeNull();
});

it('does not show a device warning when credentials are rejected', async () => {
  mockSignIn.mockResolvedValue({ user: null });
  const screen = render(<LoginScreen navigation={{}} />);
  fillDetails(screen);
  fireEvent.press(screen.getByLabelText('Sign in'));
  await waitFor(() =>
    expect(screen.getByText('Email Address or Password is Incorrect, Try Again.')).toBeTruthy()
  );
  expect(mockAccess).not.toHaveBeenCalled();
  expect(screen.queryByText(mockStore.loginNotice)).toBeNull();
});

it('keeps authentication when both temporary browser slots are occupied', async () => {
  mockAccess.mockResolvedValue({ state: 'active_session_limit_reached' });
  const screen = render(<LoginScreen navigation={{}} />);
  fillDetails(screen);
  fireEvent.press(screen.getByLabelText('Sign in'));
  await waitFor(() => expect(mockStore.setUser).toHaveBeenCalledWith(expect.objectContaining({ id: 'user' })));
  expect(mockSignOut).not.toHaveBeenCalled();
  expect(screen.queryByText('Two device limit')).toBeNull();
});
