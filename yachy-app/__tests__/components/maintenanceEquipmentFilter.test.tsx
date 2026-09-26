import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { RefreshControl } from 'react-native';
import { MaintenanceLogScreen } from '../../src/screens/MaintenanceLogScreen';
import maintenanceLogsService from '../../src/services/maintenanceLogs';
import { printStandardPdf } from '../../src/utils/standardPdf';
import { MaintenanceLog } from '../../src/types';
import { COLORS } from '../../src/constants/theme';

let mockDark = false;
const mockUser = { id: 'crew', vesselId: 'vessel' };
jest.mock('../../src/store', () => ({ useAuthStore: () => ({ user: mockUser }) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (callback: () => void) => {
    const { useEffect } = jest.requireActual('react');
    useEffect(callback, [callback]);
  },
}));
jest.mock('../../src/hooks/useScreenState', () => ({
  useScreenState: (_name: string, initial: unknown) => {
    const { useState } = jest.requireActual('react');
    return useState(initial);
  },
  useScreenLoading: () => {
    const { useState } = jest.requireActual('react');
    return useState(true);
  },
}));
jest.mock('../../src/components/QuietRefreshControl', () => ({
  QuietRefreshControl: jest.requireActual('react-native').RefreshControl,
}));
jest.mock('../../src/utils/optimisticDelete', () => ({ optimisticDelete: jest.fn() }));
jest.mock('../../src/hooks/useThemeColors', () => ({
  useThemeColors: () => ({
    isDark: mockDark,
    background: mockDark ? '#111' : '#fff',
    surface: mockDark ? '#222' : '#fff',
    control: mockDark ? '#222' : '#fff',
    textPrimary: mockDark ? '#fff' : '#111',
    textSecondary: mockDark ? '#eee' : '#555',
    border: '#777',
  }),
}));
jest.mock('../../src/services/maintenanceLogs', () => ({
  __esModule: true,
  default: { getByVessel: jest.fn() },
}));
jest.mock('../../src/services/vessel', () => ({
  __esModule: true,
  default: { getVessel: async () => ({ name: 'Test Vessel' }) },
}));
jest.mock('../../src/utils/standardPdf', () => ({
  printStandardPdf: jest.fn(async () => ({ uri: 'file:///report.pdf' })),
}));
jest.mock('expo-sharing', () => ({ shareAsync: jest.fn(async () => {}) }));
jest.mock('expo-file-system/legacy', () => ({
  cacheDirectory: 'file:///cache/',
  moveAsync: jest.fn(async () => {}),
}));
jest.mock('../../src/components', () => {
  const { Text, View, Pressable } = jest.requireActual('react-native');
  return {
    LabeledDropdown: jest.requireActual('../../src/components/LabeledDropdown').LabeledDropdown,
    ExportBar: jest.requireActual('../../src/components/ExportBar').ExportBar,
    ExportButton: ({ onPress }: { onPress: () => void }) => (
      <Pressable onPress={onPress}>
        <Text>Export</Text>
      </Pressable>
    ),
    PageHeader: ({ actions }: { actions: React.ReactNode }) => <View>{actions}</View>,
    Button: ({ title, onPress }: { title: string; onPress: () => void }) => (
      <Pressable onPress={onPress}>
        <Text>{title}</Text>
      </Pressable>
    ),
    LoadingSpinner: () => null,
    ButtonTagRow: () => null,
    ButtonTagCard: ({
      headerTitle,
      summary,
      onToggleSelect,
    }: {
      headerTitle: string;
      summary: React.ReactNode;
      onToggleSelect: () => void;
    }) => (
      <Pressable testID={`log:${headerTitle}`} onPress={onToggleSelect}>
        <Text>{headerTitle}</Text>
        {summary}
      </Pressable>
    ),
  };
});

const entry = (id: string, equipment: string): MaintenanceLog => ({
  id,
  equipment,
  vesselId: 'vessel',
  portStarboardNa: 'Port',
  serialNumber: `serial-${id}`,
  hoursOfService: '100',
  hoursAtNextService: '200',
  whatServiceDone: 'Oil change',
  notes: '',
  serviceDoneBy: 'Crew',
  createdAt: '2026-09-26',
  updatedAt: '2026-09-26',
});
const records = [
  entry('g1', 'Generators'),
  entry('g2', ' generators '),
  entry('m1', 'Mains'),
  entry('c1', 'Custom Pump'),
];
const setup = async () => {
  const ui = render(<MaintenanceLogScreen navigation={{ navigate: jest.fn() }} />);
  await act(async () => {});
  return ui;
};
type Screen = Awaited<ReturnType<typeof setup>>;
const chooseEquipment = (ui: Screen, current: string, next: string) => {
  fireEvent.press(ui.getByLabelText(`Equipment: ${current}`));
  fireEvent.press(ui.getByRole('menuitem', { name: next }));
};

beforeEach(() => {
  jest.clearAllMocks();
  mockDark = false;
  jest.mocked(maintenanceLogsService.getByVessel).mockResolvedValue(records);
});

it.each([false, true])(
  'filters instantly and exports only selected visible equipment (night=%s)',
  async (dark) => {
    mockDark = dark;
    const ui = await setup();
    expect(ui.getByText('All Equipment')).toHaveStyle({
      color: dark ? COLORS.white : COLORS.primary,
    });
    chooseEquipment(ui, 'All Equipment', 'Generators');
    expect(ui.queryByText('Filter Equipment')).toBeNull();
    expect(ui.getByTestId('log:Generators')).toBeTruthy();
    expect(ui.getByTestId('log: generators ')).toBeTruthy();
    expect(ui.queryByTestId('log:Mains')).toBeNull();
    expect(ui.queryByTestId('log:Custom Pump')).toBeNull();
    expect(maintenanceLogsService.getByVessel).toHaveBeenCalledTimes(1);
    fireEvent.press(ui.getByText('Export'));
    fireEvent.press(ui.getByText('Select All'));
    expect(ui.getByLabelText('Export 2 selected to PDF')).toBeTruthy();
    await act(async () => {
      fireEvent.press(ui.getByLabelText('Export 2 selected to PDF'));
    });
    const { html } = jest.mocked(printStandardPdf).mock.calls[0][0];
    expect(html).toContain('serial-g1');
    expect(html).toContain('serial-g2');
    expect(html).not.toContain('serial-m1');
    expect(html).not.toContain('serial-c1');
  }
);

it('clears old selections on filter change, supports custom equipment and restores all records', async () => {
  const ui = await setup();
  fireEvent.press(ui.getByText('Export'));
  fireEvent.press(ui.getByText('Select All'));
  expect(ui.getByLabelText('Export 4 selected to PDF')).toBeTruthy();
  chooseEquipment(ui, 'All Equipment', 'Custom Pump');
  expect(ui.getByLabelText('Export 0 selected to PDF')).toBeDisabled();
  fireEvent.press(ui.getByTestId('log:Custom Pump'));
  await act(async () => {
    fireEvent.press(ui.getByLabelText('Export 1 selected to PDF'));
  });
  const { html } = jest.mocked(printStandardPdf).mock.calls[0][0];
  expect(html).toContain('serial-c1');
  expect(html).not.toContain('serial-g1');
  expect(html).not.toContain('serial-m1');
  chooseEquipment(ui, 'Custom Pump', 'All Equipment');
  expect(ui.getByTestId('log:Mains')).toBeTruthy();
  expect(ui.getByTestId('log:Generators')).toBeTruthy();
  expect(ui.getByLabelText('Export 0 selected to PDF')).toBeDisabled();
});

it('removes refreshed-out selections from the export count and shows a filtered empty state', async () => {
  const ui = await setup();
  chooseEquipment(ui, 'All Equipment', 'Generators');
  fireEvent.press(ui.getByText('Export'));
  fireEvent.press(ui.getByText('Select All'));
  jest.mocked(maintenanceLogsService.getByVessel).mockResolvedValue([records[2]]);
  await act(async () => {
    fireEvent(ui.UNSAFE_getByType(RefreshControl), 'refresh');
  });
  expect(ui.getByText('No maintenance logs for Generators')).toBeTruthy();
  expect(ui.getByLabelText('Export 0 selected to PDF')).toBeDisabled();
  expect(ui.queryByText('Select All')).toBeNull();
  chooseEquipment(ui, 'Generators', 'All Equipment');
  expect(ui.getByTestId('log:Mains')).toBeTruthy();
});

it('deduplicates equipment names and closes the filter without changing selection', async () => {
  const ui = await setup();
  fireEvent.press(ui.getByLabelText('Equipment: All Equipment'));
  expect(ui.getAllByRole('menuitem')).toHaveLength(4);
  fireEvent.press(ui.getByLabelText('Close equipment filter'));
  expect(ui.getByLabelText('Equipment: All Equipment')).toBeTruthy();
  expect(ui.queryByText('Filter Equipment')).toBeNull();
});
