import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { VesselPlansScreen } from '../../src/screens/VesselPlansScreen.web';

let mockUser: any = { role: 'CAPTAIN_MOV', vesselId: 'vessel' };
jest.mock('../../src/store', () => ({
  useAuthStore: (selector: any) => selector({ user: mockUser }),
}));
jest.mock('../../src/hooks/useThemeColors', () => ({
  useThemeColors: () => ({
    background: '#fff',
    surface: '#fff',
    textPrimary: '#111',
    textSecondary: '#444',
    border: '#ccc',
    controlSelected: '#123456',
    textOnAccent: '#fff',
  }),
}));
jest.mock('../../src/components', () => {
  const { Text, View } = require('react-native');
  return {
    PageHeader: ({ title }: any) => <Text>{title}</Text>,
    Button: ({ title, disabled }: any) => (
      <View accessible accessibilityRole="button" accessibilityState={{ disabled }}>
        <Text>{title}</Text>
      </View>
    ),
  };
});
beforeEach(() => {
  mockUser = { role: 'CAPTAIN_MOV', vesselId: 'vessel' };
});

test('shows full billing totals for all crew tiers without discount percentage labels or Apple checkout', () => {
  const screen = render(<VesselPlansScreen />);
  expect(screen.getByText('11–15 Crew Members')).toBeTruthy();
  fireEvent.press(screen.getByText('Yearly'));
  expect(screen.getByText('$1295.89 / year')).toBeTruthy();
  expect(screen.getByText('$2699.89 / year')).toBeTruthy();
  expect(screen.queryByText(/%|OFF|Apple|iPhone/)).toBeNull();
  expect(screen.getByRole('button').props.accessibilityState.disabled).toBe(true);
});
test('does not expose the vessel billing controls to ordinary crew', () => {
  mockUser = { role: 'CREW', vesselId: 'vessel' };
  const screen = render(<VesselPlansScreen />);
  expect(screen.getByText(/Only the vessel/)).toBeTruthy();
  expect(screen.queryByText('Yearly')).toBeNull();
});
