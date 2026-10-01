import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { VesselAccessScreen } from '../../src/screens/VesselAccessScreen';

const mockUser = { id: 'crew', vesselId: 'vessel', role: 'CREW' };
const mockStore = {
  user: mockUser,
  deferUserUpdate: false,
  setUser: jest.fn(),
  setCrewPaymentRequired: jest.fn(),
  setCaptainPaymentRequired: jest.fn(),
  logout: jest.fn(),
};
const mockAccess = jest.fn();
const mockLeave = jest.fn().mockResolvedValue({});
const mockSignOut = jest.fn().mockResolvedValue({});
jest.mock('../../src/store', () => ({
  useAuthStore: Object.assign((selector: any) => selector(mockStore), {
    getState: () => mockStore,
  }),
}));
jest.mock('../../src/services/accountAccess', () => ({
  evaluateAccountAccess: (...args: any[]) => mockAccess(...args),
}));
jest.mock('../../src/services/auth', () => ({
  __esModule: true,
  default: { getUserProfile: () => Promise.resolve(mockUser) },
}));
jest.mock('../../src/services/supabase', () => ({
  supabase: { auth: { signOut: (...args: any[]) => mockSignOut(...args) } },
}));
jest.mock('../../src/services/vesselDeparture', () => ({
  leaveVesselForAccount: (...args: any[]) => mockLeave(...args),
  isOnlyCaptainError: () => false,
}));
jest.mock('../../src/hooks/useThemeColors', () => ({
  useThemeColors: () => ({
    background: '#fff',
    surface: '#fff',
    textPrimary: '#111',
    textSecondary: '#666',
    accent: '#123',
    border: '#ddd',
  }),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../../src/components', () => ({
  Button: jest.requireActual('../../src/components/Button').Button,
  PageHeader: () => null,
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockUser.role = 'CREW';
  mockAccess.mockResolvedValue({ state: 'crew_payment_required' });
});

it('requires confirmation but not credentials from an authenticated locked-out crew user', async () => {
  const ui = render(<VesselAccessScreen />);
  expect(ui.getByText('Vessel access temporarily unavailable')).toBeTruthy();
  expect(ui.queryByText('See Plans')).toBeNull();
  fireEvent.press(ui.getByText('Leave Vessel'));
  expect(mockLeave).not.toHaveBeenCalled();
  expect(ui.queryByLabelText('Account password')).toBeNull();
  fireEvent.press(ui.getByText('Cancel'));
  expect(mockLeave).not.toHaveBeenCalled();
  fireEvent.press(ui.getByText('Leave Vessel'));
  await act(async () => {
    fireEvent.press(ui.getByText('Confirm and Leave Vessel'));
  });
  expect(mockLeave).toHaveBeenCalledWith(undefined);
});

it('keeps the restriction on outage and clears it only after confirmed access', async () => {
  const ui = render(<VesselAccessScreen />);
  mockAccess.mockResolvedValue({ state: 'unavailable' });
  await act(async () => {
    fireEvent.press(ui.getByText('Check Access Again'));
  });
  expect(mockStore.setCrewPaymentRequired).not.toHaveBeenCalled();
  mockAccess.mockResolvedValue({ state: 'allowed' });
  await act(async () => {
    fireEvent.press(ui.getByText('Check Access Again'));
  });
  expect(mockStore.setCrewPaymentRequired).toHaveBeenCalledWith(false);
});

it('does not offer departure to captain accounts', () => {
  mockUser.role = 'CAPTAIN_MOV';
  const ui = render(<VesselAccessScreen />);
  expect(ui.queryByText('Leave Vessel')).toBeNull();
});

it('signs out without removing vessel membership', async () => {
  const ui = render(<VesselAccessScreen />);
  await act(async () => {
    fireEvent.press(ui.getByText('Sign Out'));
  });
  expect(mockSignOut).toHaveBeenCalledWith({ scope: 'local' });
  expect(mockStore.logout).toHaveBeenCalled();
  expect(mockLeave).not.toHaveBeenCalled();
});
