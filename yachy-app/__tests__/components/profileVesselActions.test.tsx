import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { ProfileScreen } from '../../src/screens/ProfileScreen';

let mockNight = false;
let mockEligible = true;
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
      role: 'CREW',
      department: 'BRIDGE',
      position: 'Deckhand',
      vesselId: 'private',
      createdAt: '2026-09-27',
      vesselCreationUnlocked: mockEligible,
    },
    setUser: jest.fn(),
  }),
  useThemeStore: (selector: (value: { backgroundTheme: string }) => unknown) =>
    selector({ backgroundTheme: mockNight ? 'night' : 'day' }),
  get BACKGROUND_THEMES() {
    return mockThemes;
  },
}));
jest.mock('../../src/services/supabase', () => ({ supabase: {} }));
jest.mock('../../src/services/auth', () => ({ __esModule: true, default: {} }));
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
