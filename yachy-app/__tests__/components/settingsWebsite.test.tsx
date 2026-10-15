import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { Alert, Linking, Platform } from 'react-native';
import { SettingsScreen } from '../../src/screens/SettingsScreen';

let mockTheme = 'day';
const mockSignOut = jest.fn();
const mockLogout = jest.fn();
jest.mock('../../src/store', () => ({
  useAuthStore: () => ({ user: { name: 'Crew', role: 'CREW' }, logout: mockLogout }),
  useThemeStore: (selector: any) => selector({ backgroundTheme: mockTheme }),
  BACKGROUND_THEMES: {
    day: { background: '#fff', surface: '#fff', textPrimary: '#111', textSecondary: '#667' },
    night: { background: '#111', surface: '#222', textPrimary: '#fff', textSecondary: '#ccd' },
  },
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@react-navigation/native', () => ({ useFocusEffect: jest.fn() }));
jest.mock('../../src/services/supabase', () => ({ supabase: {} }));
jest.mock('../../src/services/auth', () => ({
  __esModule: true,
  default: { signOut: () => mockSignOut() },
}));
jest.mock('../../src/services/user', () => ({ __esModule: true, default: {} }));
jest.mock('../../src/components', () => ({
  Button: jest.requireActual('../../src/components/Button').Button,
  PageHeader: () => null,
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockSignOut.mockResolvedValue(undefined);
});

it('only clears the account after the sign-out service releases the saved browser', async () => {
  const ui = render(<SettingsScreen navigation={{ navigate: jest.fn() }} />);
  await act(async () => {
    fireEvent.press(ui.getByText('Sign Out'));
  });
  expect(mockSignOut).toHaveBeenCalledTimes(1);
  expect(mockLogout).toHaveBeenCalledTimes(1);
});

it('shows a retryable error and keeps authentication when slot release fails', async () => {
  mockSignOut.mockRejectedValueOnce(new Error('Could not release this browser slot'));
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const ui = render(<SettingsScreen navigation={{ navigate: jest.fn() }} />);
  await act(async () => {
    fireEvent.press(ui.getByText('Sign Out'));
  });
  expect(mockLogout).not.toHaveBeenCalled();
  expect(alert).toHaveBeenCalledWith('Could not sign out', 'Could not release this browser slot');
  await act(async () => {
    fireEvent.press(ui.getByText('Sign Out'));
  });
  expect(mockLogout).toHaveBeenCalledTimes(1);
  alert.mockRestore();
});

describe('Settings website availability', () => {
  const originalPlatform = Platform.OS;
  afterEach(() => {
    Platform.OS = originalPlatform;
    jest.restoreAllMocks();
  });

  it.each(['day', 'night'])('shows Coming Soon and cannot open the website in %s mode', (theme) => {
    Platform.OS = 'ios';
    mockTheme = theme;
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    const navigation = { navigate: jest.fn() };
    const ui = render(<SettingsScreen navigation={navigation} />);
    const website = ui.getByRole('button', { name: 'Link website' });
    expect(website.props.accessibilityState.disabled).toBe(true);
    expect(ui.getByText('Coming Soon')).toBeTruthy();
    fireEvent.press(website);
    expect(openURL).not.toHaveBeenCalled();
    expect(navigation.navigate).not.toHaveBeenCalled();
    fireEvent.press(ui.getByRole('button', { name: 'FAQ & Help' }));
    expect(navigation.navigate).toHaveBeenCalledWith('FAQHelp');
  });

  it('keeps the existing web visibility unchanged', () => {
    Platform.OS = 'web';
    const ui = render(<SettingsScreen navigation={{ navigate: jest.fn() }} />);
    expect(ui.queryByText('Link website')).toBeNull();
  });
});
