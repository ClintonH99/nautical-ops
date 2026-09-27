import React from 'react';
import { Alert, FlatList } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';
import { MaintenanceLogScreen } from '../../src/screens/MaintenanceLogScreen';
import service from '../../src/services/maintenanceLogs';
let mockDark = false;
jest.mock('../../src/store', () => ({
  useAuthStore: () => ({ user: { id: 'crew', vesselId: 'vessel', role: 'CREW' } }),
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
  useThemeColors: () => ({ isDark: mockDark }),
}));
jest.mock('../../src/services/maintenanceLogs', () => ({
  __esModule: true,
  default: { getByVessel: jest.fn(), delete: jest.fn() },
}));
jest.mock('../../src/services/vessel', () => ({ __esModule: true, default: {} }));
jest.mock('../../src/utils/standardPdf', () => ({ printStandardPdf: jest.fn() }));
jest.mock('expo-sharing', () => ({}));
jest.mock('expo-file-system/legacy', () => ({}));
jest.mock('../../src/components/QuietRefreshControl', () => ({
  QuietRefreshControl: jest.requireActual('react-native').RefreshControl,
}));
jest.mock('../../src/components', () => {
  const { Pressable, Text, View } = jest.requireActual('react-native');
  return {
    ...jest.requireActual('../../src/components/ButtonTagCard'),
    LabeledDropdown: jest.requireActual('../../src/components/LabeledDropdown').LabeledDropdown,
    ExportBar: jest.requireActual('../../src/components/ExportBar').ExportBar,
    PageHeader: ({ actions }: any) => <View>{actions}</View>,
    ExportButton: ({ onPress }: any) => (
      <Pressable onPress={onPress}>
        <Text>Export</Text>
      </Pressable>
    ),
    Button: ({ title, onPress }: any) => (
      <Pressable onPress={onPress}>
        <Text>{title}</Text>
      </Pressable>
    ),
    LoadingSpinner: () => null,
  };
});
it.each([false, true])(
  'preserves list buttons and selection with batched rendering (night=%s)',
  async (dark) => {
    mockDark = dark;
    jest.clearAllMocks();
    const records = Array.from({ length: 60 }, (_, i) => ({
      id: `log-${i}`,
      equipment: `Pump ${i}`,
      createdAt: '2026-09-27',
      serialNumber: `serial-${i}`,
    }));
    jest.mocked(service.getByVessel).mockResolvedValue(records as any);
    jest.mocked(service.delete).mockResolvedValue(undefined);
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const navigation = { navigate: jest.fn() };
    const ui = render(<MaintenanceLogScreen navigation={navigation} />);
    await act(async () => {});
    const list = ui.UNSAFE_getByType(FlatList);
    expect(list.props.data).toHaveLength(60);
    expect(list.props.initialNumToRender).toBe(8);
    fireEvent.press(ui.getByText('Create Maintenance Log'));
    expect(navigation.navigate).toHaveBeenCalledWith('AddEditMaintenanceLog', {});
    fireEvent.press(ui.getByText('Pump 0'));
    expect(ui.getByText('serial-0')).toBeTruthy();
    fireEvent.press(ui.getByRole('button', { name: 'Edit' }));
    expect(navigation.navigate).toHaveBeenCalledWith('AddEditMaintenanceLog', { logId: 'log-0' });
    fireEvent.press(ui.getByRole('button', { name: 'Delete' }));
    const actions = alert.mock.calls.at(-1)?.[2];
    expect(actions?.map((action) => action.text)).toEqual(['Cancel', 'Delete']);
    await act(async () => {
      await actions?.find((action) => action.text === 'Delete')?.onPress?.();
    });
    expect(service.delete).toHaveBeenCalledWith('log-0');
    expect(ui.queryByText('Pump 0')).toBeNull();
    fireEvent.press(ui.getByText('Export'));
    fireEvent.press(ui.getByText('Select All'));
    expect(ui.getByLabelText('Export 59 selected to PDF')).toBeTruthy();
    fireEvent.press(ui.getByText('Pump 1'));
    expect(ui.getByLabelText('Export 58 selected to PDF')).toBeTruthy();
    alert.mockRestore();
  }
);
