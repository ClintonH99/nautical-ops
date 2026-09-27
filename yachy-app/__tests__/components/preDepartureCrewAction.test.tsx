import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { Text } from 'react-native';
import { PreDepartureChecklistScreen } from '../../src/screens/PreDepartureChecklistScreen';
import { ButtonTagCard } from '../../src/components/ButtonTagCard';

let mockRole = 'CREW';
let mockDark = false;
jest.mock('../../src/store', () => ({
  useAuthStore: () => ({ user: { id: 'user', vesselId: 'vessel', role: mockRole } }),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (callback: () => void) => {
    const { useEffect } = jest.requireActual('react');
    useEffect(callback, [callback]);
  },
}));
jest.mock('../../src/hooks/useScreenState', () => ({
  useScreenState: (_name: string, initial: unknown) =>
    jest.requireActual('react').useState(initial),
  useScreenLoading: () => jest.requireActual('react').useState(true),
}));
jest.mock('../../src/hooks/useThemeColors', () => ({
  useThemeColors: () => ({
    isDark: mockDark,
    surface: mockDark ? '#222' : '#fff',
    textPrimary: mockDark ? '#fff' : '#111',
    textSecondary: '#777',
    border: '#777',
  }),
}));
jest.mock('../../src/components/QuietRefreshControl', () => ({
  QuietRefreshControl: jest.requireActual('react-native').RefreshControl,
}));
jest.mock('../../src/components/ScreenLoading', () => ({ ScreenLoading: () => null }));
jest.mock('../../src/utils/optimisticDelete', () => ({ optimisticDelete: jest.fn() }));
jest.mock('../../src/services/preDepartureChecklists', () => ({
  __esModule: true,
  default: {
    getByVessel: async () => [
      { id: 'captain', title: 'All crew', department: null, items: [], createdAt: '2026-09-27' },
      { id: 'bridge', title: 'Bridge', department: 'BRIDGE', items: [], createdAt: '2026-09-27' },
    ],
  },
}));
jest.mock('../../src/services/vessel', () => ({ __esModule: true, default: {} }));
jest.mock('../../src/utils/preDepartureChecklistPdf', () => ({
  generatePreDepartureChecklistPdf: jest.fn(),
}));
jest.mock('../../src/components', () => ({
  ButtonTagCard: jest.requireActual('../../src/components/ButtonTagCard').ButtonTagCard,
  ButtonTagRow: () => null,
  Button: () => null,
  DepartmentSelector: () => null,
  LoadingSpinner: () => null,
  PageHeader: () => null,
  ExportButton: () => null,
  ExportBar: () => null,
}));

describe.each([false, true])('checklist action (night=%s)', (dark) => {
  beforeEach(() => {
    mockDark = dark;
  });

  it.each(['CREW', 'HOD', 'CAPTAIN_MOV', 'MANAGEMENT'])(
    'keeps the existing navigation and scopes Enter to CREW (%s)',
    async (role) => {
      mockRole = role;
      const navigation = { navigate: jest.fn() };
      const ui = render(<PreDepartureChecklistScreen navigation={navigation} />);
      await act(async () => {});
      const label = role === 'CREW' ? 'Enter' : 'Edit';
      const buttons = ui.getAllByRole('button', { name: label });
      expect(buttons).toHaveLength(2);
      expect(ui.queryByText(role === 'CREW' ? 'Edit' : 'Enter')).toBeNull();
      buttons.forEach((button) => fireEvent.press(button));
      const route =
        role === 'HOD' || role === 'CAPTAIN_MOV'
          ? 'AddEditPreDepartureChecklist'
          : 'ViewPreDepartureChecklist';
      expect(navigation.navigate.mock.calls).toEqual([
        [route, { checklistId: 'captain' }],
        [route, { checklistId: 'bridge' }],
      ]);
    }
  );

  it('retains Edit as the shared card default', () => {
    const ui = render(
      <ButtonTagCard onEdit={jest.fn()} onPress={jest.fn()}>
        <Text>Item</Text>
      </ButtonTagCard>
    );
    expect(ui.getByRole('button', { name: 'Edit' })).toBeTruthy();
  });
});
