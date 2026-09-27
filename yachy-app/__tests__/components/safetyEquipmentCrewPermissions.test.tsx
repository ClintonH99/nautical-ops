import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { SafetyEquipmentScreen } from '../../src/screens/SafetyEquipmentScreen';
import { CreateSafetyEquipmentScreen } from '../../src/screens/CreateSafetyEquipmentScreen';
import service from '../../src/services/safetyEquipment';

let mockRole = 'CREW';
let mockDark = false;
jest.mock('../../src/store', () => ({
  useAuthStore: () => ({ user: { id: 'crew', vesselId: 'vessel', role: mockRole } }),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (cb: () => void) => jest.requireActual('react').useEffect(cb, [cb]),
}));
jest.mock('../../src/hooks/useScreenState', () => ({
  useScreenState: (_name: string, initial: unknown) =>
    jest.requireActual('react').useState(initial),
  useScreenLoading: () => jest.requireActual('react').useState(true),
}));
jest.mock('../../src/hooks/useThemeColors', () => ({
  useThemeColors: () => ({ isDark: mockDark, surface: mockDark ? '#111' : '#fff' }),
}));
jest.mock('../../src/components/QuietRefreshControl', () => ({
  QuietRefreshControl: jest.requireActual('react-native').RefreshControl,
}));
jest.mock('../../src/components/ScreenLoading', () => ({ ScreenLoading: () => null }));
jest.mock('../../src/utils/optimisticDelete', () => ({ optimisticDelete: jest.fn() }));
jest.mock('../../src/services/supabase', () => ({ supabase: {} }));
jest.mock('../../src/services/safetyEquipment', () => ({
  ...jest.requireActual('../../src/services/safetyEquipment'),
  __esModule: true,
  default: { getByVessel: jest.fn(), getById: jest.fn(), create: jest.fn(), update: jest.fn() },
}));
jest.mock('../../src/services/vessel', () => ({
  __esModule: true,
  default: { getVessel: async () => ({ name: 'Test Vessel' }) },
}));
jest.mock('../../src/utils/safetyEquipmentPdf', () => ({
  generateSafetyEquipmentPdf: jest.fn(),
  generateSafetyEquipmentListPdf: jest.fn(),
}));
jest.mock('../../src/components', () => {
  const { Pressable, Text } = jest.requireActual('react-native');
  return {
    ButtonTagCard: jest.requireActual('../../src/components/ButtonTagCard').ButtonTagCard,
    Button: ({ title, onPress }: any) => (
      <Pressable onPress={onPress}>
        <Text>{title}</Text>
      </Pressable>
    ),
    DateOnlyPicker: () => null,
    PageHeader: () => null,
    LoadingSpinner: () => null,
    ExportButton: () => null,
    ExportBar: () => null,
  };
});

const plan = {
  id: 'plan',
  vesselId: 'vessel',
  title: 'Safety plan',
  data: { categoryOrder: [] },
  createdAt: '2026-09-27',
};
beforeEach(() => {
  jest.clearAllMocks();
  mockRole = 'CREW';
  jest.mocked(service.getByVessel).mockResolvedValue([plan]);
  jest.mocked(service.getById).mockResolvedValue(plan);
  jest.mocked(service.create).mockResolvedValue(plan);
  jest.mocked(service.update).mockResolvedValue(plan);
});

describe.each([false, true])('Safety Equipment permissions (night=%s)', (dark) => {
  beforeEach(() => {
    mockDark = dark;
  });
  it.each(['CREW', 'HOD', 'CAPTAIN_MOV', 'MANAGEMENT'])('list actions for %s', async (role) => {
    mockRole = role;
    const navigation = { navigate: jest.fn() };
    const ui = render(<SafetyEquipmentScreen navigation={navigation} />);
    await act(async () => {});
    fireEvent.press(ui.getByText('Safety plan'));
    if (role === 'MANAGEMENT') {
      expect(ui.queryByText('Create Safety Equipment')).toBeNull();
      expect(ui.queryByRole('button', { name: 'Edit' })).toBeNull();
    } else {
      fireEvent.press(ui.getByText('Create Safety Equipment'));
      expect(navigation.navigate).toHaveBeenCalledWith('CreateSafetyEquipment');
      fireEvent.press(ui.getByRole('button', { name: 'Edit' }));
      expect(navigation.navigate).toHaveBeenCalledWith('CreateSafetyEquipment', {
        equipmentId: 'plan',
      });
    }
    expect(!!ui.queryByRole('button', { name: 'Delete' })).toBe(
      role === 'HOD' || role === 'CAPTAIN_MOV'
    );
  });
  it.each([false, true])('Crew can publish a form (edit=%s)', async (edit) => {
    const navigation = { setOptions: jest.fn(), goBack: jest.fn() };
    const ui = render(
      <CreateSafetyEquipmentScreen
        navigation={navigation}
        route={{ params: edit ? { equipmentId: 'plan' } : {} }}
      />
    );
    await act(async () => {});
    fireEvent.changeText(ui.getByPlaceholderText('Safety Equipment Locations'), 'Updated plan');
    await act(async () => {
      fireEvent.press(ui.getByText(edit ? 'Save Changes' : 'Publish Safety Equipment'));
    });
    if (edit)
      expect(service.update).toHaveBeenCalledWith('plan', 'Updated plan', expect.any(Object));
    else
      expect(service.create).toHaveBeenCalledWith(
        'vessel',
        'Updated plan',
        expect.any(Object),
        'crew'
      );
    expect(navigation.goBack).toHaveBeenCalled();
  });
  it('Management cannot enter the create form', async () => {
    mockRole = 'MANAGEMENT';
    const ui = render(
      <CreateSafetyEquipmentScreen navigation={{ setOptions: jest.fn() }} route={{}} />
    );
    await act(async () => {});
    expect(ui.queryByText('Publish Safety Equipment')).toBeNull();
    expect(service.create).not.toHaveBeenCalled();
  });
});
