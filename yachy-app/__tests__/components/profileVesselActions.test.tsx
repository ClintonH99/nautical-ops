import React from 'react';
import { render, fireEvent, act } from '@testing-library/react-native';
import { Alert, StyleSheet } from 'react-native';
import { ProfileScreen } from '../../src/screens/ProfileScreen';

let mockNight = false;
let mockEligible = true;
let mockRole = 'CREW';
const mockInvoke = jest.fn();
const mockGetSession = jest.fn();
const mockGetUserProfile = jest.fn();
const mockSetUser = jest.fn();
const mockThemes = {
  day: {
    isDark: false,
    background: '#f6f7f9',
    surfaceElevated: '#fff',
    border: '#ddd',
    textPrimary: '#111',
    textSecondary: '#64748b',
    accentSoft: '#e4e8f2',
  },
  night: {
    isDark: true,
    background: '#101722',
    surfaceElevated: '#182334',
    border: '#344155',
    textPrimary: '#fff',
    textSecondary: '#a5b1c2',
    accentSoft: '#25334a',
  },
};
jest.mock('../../src/store', () => ({
  useAuthStore: () => ({
    user: {
      id: 'u',
      name: 'Crew',
      role: mockRole,
      department: 'BRIDGE',
      position: 'Deckhand',
      vesselId: 'private',
      createdAt: '2026-09-27',
      vesselCreationUnlocked: mockEligible,
    },
    setUser: mockSetUser,
  }),
  useThemeStore: (selector: (value: { backgroundTheme: string }) => unknown) =>
    selector({ backgroundTheme: mockNight ? 'night' : 'day' }),
  get BACKGROUND_THEMES() {
    return mockThemes;
  },
}));
jest.mock('../../src/services/supabase', () => ({
  supabase: {
    auth: { getSession: (...args: unknown[]) => mockGetSession(...args) },
    functions: { invoke: (...args: unknown[]) => mockInvoke(...args) },
  },
}));
jest.mock('../../src/services/auth', () => ({
  __esModule: true,
  default: { getUserProfile: (...args: unknown[]) => mockGetUserProfile(...args) },
}));
jest.mock('../../src/services/user', () => ({
  __esModule: true,
  default: { getProfilePhotoUrl: () => null },
}));
jest.mock('expo-image-picker', () => ({}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../../src/components', () => {
  const { Text, Pressable } = jest.requireActual('react-native');
  return {
    PageHeader: () => null,
    DepartmentSelector: () => null,
    LoadingSpinner: () => null,
    Button: ({ title, onPress }: { title: string; onPress: () => void }) => (
      <Pressable onPress={onPress}>
        <Text>{title}</Text>
      </Pressable>
    ),
  };
});

describe('Profile vessel action layout', () => {
  beforeEach(() => {
    mockEligible = true;
    mockRole = 'CREW';
  });
  it.each([false, true])('uses aligned settings rows in night mode=%s', (night) => {
    mockNight = night;
    const navigation = { navigate: jest.fn() };
    const screen = render(<ProfileScreen navigation={navigation} />);
    const create = screen.getByRole('button', { name: 'Create a New Vessel' });
    const join = screen.getByRole('button', { name: 'Join a Different Vessel' });
    const leave = screen.getByRole('button', { name: 'Leave Vessel' });
    const createStyle = StyleSheet.flatten(create.props.style);
    const joinStyle = StyleSheet.flatten(join.props.style);
    const leaveStyle = StyleSheet.flatten(leave.props.style);
    expect(createStyle.minHeight).toBe(joinStyle.minHeight);
    expect(createStyle.paddingHorizontal).toBe(joinStyle.paddingHorizontal);
    expect(createStyle.backgroundColor).toBeUndefined();
    expect(createStyle.borderBottomWidth).toBe(1);
    expect(joinStyle.borderBottomWidth).toBe(1);
    expect(leaveStyle.borderBottomWidth).toBe(0);
    expect(StyleSheet.flatten(screen.getByText('Create a New Vessel').props.style).color).toBe(
      night ? '#fff' : '#111'
    );
    fireEvent.press(create);
    expect(navigation.navigate).toHaveBeenCalledWith('CreateVessel');
  });
  it('keeps creation hidden for an ineligible Crew account', () => {
    mockEligible = false;
    const screen = render(<ProfileScreen navigation={{ navigate: jest.fn() }} />);
    expect(screen.queryByText('Create a New Vessel')).toBeNull();
    expect(screen.getByRole('button', { name: 'Leave Vessel' })).toBeTruthy();
  });
});

describe('Leave vessel guard messages', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRole = 'CAPTAIN_MOV';
    mockEligible = false;
    mockGetSession.mockResolvedValue({ data: { session: { access_token: 'test-token' } } });
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  async function confirmLeave() {
    const navigation = { navigate: jest.fn() };
    const screen = render(<ProfileScreen navigation={navigation} />);
    fireEvent.press(screen.getByRole('button', { name: 'Leave Vessel' }));
    const buttons = (Alert.alert as jest.Mock).mock.calls[0][2];
    await act(async () => {
      await buttons.find((b: { text: string }) => b.text === 'Leave Vessel').onPress();
    });
    return navigation;
  }

  it.each([false, true])(
    'shows the sole-captain guard for HTTP errors (clone=%s)',
    async (clone) => {
      const response = {
        json: jest
          .fn()
          .mockResolvedValue({
            error:
              'You are the only Captain/MOV on this vessel. Promote another crew member before leaving.',
          }),
      };
      mockInvoke.mockResolvedValue({
        data: null,
        error: {
          name: 'FunctionsHttpError',
          context: clone ? { ...response, clone: () => response } : response,
        },
      });
      const navigation = await confirmLeave();
      expect(Alert.alert).toHaveBeenLastCalledWith(
        'Appoint Another Captain/MOV',
        expect.stringContaining('promote another crew member to Captain/MOV'),
        expect.any(Array)
      );
      const buttons = (Alert.alert as jest.Mock).mock.calls.at(-1)[2];
      buttons.find((b: { text: string }) => b.text === 'Go to Crew Management').onPress();
      expect(navigation.navigate).toHaveBeenCalledWith('CrewManagement');
      expect(mockGetUserProfile).not.toHaveBeenCalled();
      expect(mockSetUser).not.toHaveBeenCalled();
      expect(mockInvoke).toHaveBeenCalledWith('leave-vessel', {
        headers: { Authorization: 'Bearer test-token' },
      });
    }
  );

  it('also handles the existing data.error response', async () => {
    mockInvoke.mockResolvedValue({
      data: { error: 'You are the only Captain/MOV on this vessel.' },
      error: null,
    });
    await confirmLeave();
    expect(Alert.alert).toHaveBeenLastCalledWith(
      'Appoint Another Captain/MOV',
      expect.any(String),
      expect.any(Array)
    );
  });

  it('does not label an unrelated server failure as a sole-captain restriction', async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: {
        context: {
          json: async () => {
            throw new Error('Invalid JSON');
          },
        },
      },
    });
    await confirmLeave();
    expect(Alert.alert).toHaveBeenLastCalledWith(
      'Error',
      expect.stringContaining('support@nautical-ops.com')
    );
    expect(mockSetUser).not.toHaveBeenCalled();
  });

  it('handles a rejected network request without changing the user', async () => {
    mockInvoke.mockRejectedValue(new Error('Offline'));
    await confirmLeave();
    expect(Alert.alert).toHaveBeenLastCalledWith('Unable to Complete Request', expect.any(String));
    expect(mockSetUser).not.toHaveBeenCalled();
  });

  it('keeps the successful departure flow intact', async () => {
    const freshUser = { id: 'u', role: 'CREW', vesselId: 'new-private' };
    mockInvoke.mockResolvedValue({ data: { success: true }, error: null });
    mockGetUserProfile.mockResolvedValue(freshUser);
    await confirmLeave();
    expect(mockSetUser).toHaveBeenCalledWith(freshUser);
    expect(Alert.alert).toHaveBeenLastCalledWith(
      'Done',
      expect.stringContaining("You've left the vessel")
    );
  });
});
