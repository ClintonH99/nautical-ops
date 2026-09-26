import React from 'react';
import { act, fireEvent, render, renderHook } from '@testing-library/react-native';
import { AppState } from 'react-native';
import { GeneralWasteLogScreen } from '../../src/screens/GeneralWasteLogScreen';
import { PumpOutLogScreen } from '../../src/screens/PumpOutLogScreen';
import { FuelLogScreen } from '../../src/screens/FuelLogScreen';
import { VesselLogHistoryScreen } from '../../src/screens/VesselLogHistoryScreen';
import { useVesselLogPeriod } from '../../src/hooks/useVesselLogPeriod';
import { useMonthlyVesselLogs } from '../../src/hooks/useMonthlyVesselLogs';
import { setScreenCacheScope } from '../../src/utils/screenCache';
import waste from '../../src/services/generalWasteLogs';
import discharge from '../../src/services/pumpOutLogs';
import fuel from '../../src/services/fuelLogs';
import vesselService from '../../src/services/vessel';
import {
  exportGeneralWasteLogPdf,
  exportPumpOutLogPdf,
  exportFuelLogPdf,
} from '../../src/utils/vesselLogsPdf';

let mockUser = {
  id: 'new-crew',
  vesselId: 'vessel',
  role: 'CAPTAIN_MOV',
  createdAt: '2026-09-25T12:00:00Z',
};
let mockRoute: { name: string; params?: any } = { name: 'GeneralWasteLog' };
let mockDark = false;
let scopeId = 0;
jest.mock('../../src/store', () => ({
  useAuthStore: (selector?: any) => (selector ? selector({ user: mockUser }) : { user: mockUser }),
}));
jest.mock('@react-navigation/native', () => ({
  useRoute: () => mockRoute,
  useFocusEffect: (callback: () => void) =>
    jest.requireActual('react').useEffect(callback, [callback]),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../../src/components/QuietRefreshControl', () => ({
  QuietRefreshControl: jest.requireActual('react-native').RefreshControl,
}));
jest.mock('../../src/hooks/useThemeColors', () => ({
  useThemeColors: () => ({
    isDark: mockDark,
    background: mockDark ? '#111' : '#fff',
    surface: mockDark ? '#222' : '#fff',
    textPrimary: mockDark ? '#fff' : '#111',
    textSecondary: '#777',
    border: '#777',
    accent: '#223c80',
    accentSoft: '#eee',
    controlSelected: '#223c80',
  }),
}));
jest.mock('../../src/utils/optimisticDelete', () => ({ optimisticDelete: jest.fn() }));
jest.mock('../../src/services/generalWasteLogs', () => ({
  __esModule: true,
  default: { getByVesselMonth: jest.fn() },
}));
jest.mock('../../src/services/pumpOutLogs', () => ({
  __esModule: true,
  default: { getByVesselMonth: jest.fn() },
}));
jest.mock('../../src/services/fuelLogs', () => ({
  __esModule: true,
  default: { getByVesselMonth: jest.fn() },
}));
jest.mock('../../src/services/vessel', () => ({
  __esModule: true,
  default: { getVessel: jest.fn() },
}));
jest.mock('../../src/services/fuelManagement', () => ({
  fuelManagementService: {
    getFuelLogAllocationSnapshot: jest.fn(async () => ({
      displayUnit: 'LITRES',
      allocationsByLogId: {},
    })),
  },
}));
jest.mock('../../src/utils/vesselLogsPdf', () => ({
  exportGeneralWasteLogPdf: jest.fn(),
  exportPumpOutLogPdf: jest.fn(),
  exportFuelLogPdf: jest.fn(),
}));
jest.mock('../../src/components', () => {
  const { Text, View, Pressable, TextInput } = jest.requireActual('react-native');
  const Button = ({ title, onPress }: any) => (
    <Pressable onPress={onPress}>
      <Text>{title}</Text>
    </Pressable>
  );
  return {
    Button,
    Input: (props: any) => <TextInput {...props} />,
    PageHeader: ({ title, actions }: any) => (
      <View>
        <Text>{title}</Text>
        {actions}
      </View>
    ),
    ExportButton: ({ onPress }: any) => <Button title="Export" onPress={onPress} />,
    ExportBar: ({ onConfirm, count }: any) => (
      <Button title={`Export ${count}`} onPress={onConfirm} />
    ),
    LoadingSpinner: () => <Text>Loading</Text>,
    ButtonTagRow: () => null,
    ButtonTagCard: ({
      headerTitle,
      headerLeft,
      onToggleSelect,
      onToggleExpand,
      showCheckbox,
      children,
      expanded,
    }: any) => (
      <Pressable onPress={showCheckbox ? onToggleSelect : onToggleExpand}>
        <Text>{headerTitle}</Text>
        {headerLeft}
        {expanded ? children : null}
      </Pressable>
    ),
  };
});

const record = (id: string, createdAt: string, vesselId = 'vessel') => ({
  id,
  vesselId,
  createdAt,
  logDate: '2024-01-01',
  logTime: '12:00',
  positionLocation: id,
  location: id,
  locationOfRefueling: id,
  dischargeType: 'DIRECT_DISCHARGE',
  amountOfFuel: 10,
  pricePerVolumeUnit: 2,
  totalPrice: 20,
  currencyCode: 'USD',
  volumeUnit: 'LITRES',
});
const records = [
  record('Current entry', '2026-09-27T12:00:00Z'),
  record('Old entry', '2026-08-12T12:00:00Z'),
  record('Other vessel', '2026-09-27T12:00:00Z', 'other'),
];
const cases = [
  [
    'GeneralWasteLog',
    GeneralWasteLogScreen,
    waste,
    exportGeneralWasteLogPdf,
    'waste',
    'Create Waste Log Entry',
  ],
  [
    'PumpOutLog',
    PumpOutLogScreen,
    discharge,
    exportPumpOutLogPdf,
    'discharge',
    'Create Discharge Entry',
  ],
  ['FuelLog', FuelLogScreen, fuel, exportFuelLogPdf, 'fuel', 'Add Receipt'],
] as const;

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-09-27T12:00:00Z'));
  jest.spyOn(AppState, 'addEventListener').mockReturnValue({ remove: jest.fn() });
  setScreenCacheScope(`test-${++scopeId}`);
  mockUser = {
    id: 'new-crew',
    vesselId: 'vessel',
    role: 'CAPTAIN_MOV',
    createdAt: '2026-09-25T12:00:00Z',
  };
  mockRoute = { name: 'GeneralWasteLog' };
  mockDark = false;
  for (const service of [waste, discharge, fuel])
    (service.getByVesselMonth as jest.Mock).mockResolvedValue(records);
  (vesselService.getVessel as jest.Mock).mockResolvedValue({
    id: 'vessel',
    name: 'Shared Vessel',
    createdAt: '2025-11-20T12:00:00Z',
  });
});
afterEach(() => jest.useRealTimers());

it.each(cases)(
  '%s shows and exports only the current creation month and opens shared history',
  async (name, Screen, service, exportPdf, kind) => {
    mockRoute = { name };
    const navigation = { navigate: jest.fn(), push: jest.fn() };
    const ui = render(<Screen navigation={navigation} route={mockRoute} />);
    await act(async () => {});
    expect(service.getByVesselMonth).toHaveBeenCalledWith('vessel', '2026-09');
    expect(ui.getByText('Current entry')).toBeTruthy();
    expect(ui.queryByText('Old entry')).toBeNull();
    expect(ui.queryByText('Other vessel')).toBeNull();
    fireEvent.press(ui.getByText('History'));
    expect(navigation.push).toHaveBeenCalledWith('VesselLogHistory', { kind, vesselId: 'vessel' });
    fireEvent.press(ui.getByText('Export'));
    fireEvent.press(ui.getByText('Select All'));
    await act(async () => fireEvent.press(ui.getByText('Export 1')));
    expect(exportPdf).toHaveBeenCalledWith([records[0]], 'Shared Vessel');
  }
);

it.each(cases)(
  '%s opens the historical month with its existing export and expandable records',
  async (name, Screen, service, exportPdf, _kind, createLabel) => {
    mockDark = true;
    mockRoute = { name, params: { historyMonth: '2026-08', historyVesselId: 'vessel' } };
    const ui = render(
      <Screen navigation={{ navigate: jest.fn(), push: jest.fn() }} route={mockRoute} />
    );
    await act(async () => {});
    expect(service.getByVesselMonth).toHaveBeenCalledWith('vessel', '2026-08');
    expect(ui.getByText('August 2026')).toBeTruthy();
    expect(ui.getByText('Old entry')).toBeTruthy();
    expect(ui.queryByText('Current entry')).toBeNull();
    expect(ui.queryByText(createLabel)).toBeNull();
    fireEvent.press(ui.getByText('Old entry'));
    fireEvent.press(ui.getByText('Export'));
    fireEvent.press(ui.getByText('Select All'));
    await act(async () => fireEvent.press(ui.getByText('Export 1')));
    expect(exportPdf).toHaveBeenCalledWith([records[1]], 'Shared Vessel');
  }
);

it('a newly joined crew member can browse years/months back to vessel creation', async () => {
  mockRoute = { name: 'VesselLogHistory', params: { kind: 'waste', vesselId: 'vessel' } };
  const navigation = { push: jest.fn() };
  const ui = render(<VesselLogHistoryScreen navigation={navigation} route={mockRoute} />);
  await act(async () => {});
  fireEvent.press(ui.getByText('2025'));
  expect(navigation.push).toHaveBeenCalledWith('VesselLogHistory', {
    kind: 'waste',
    vesselId: 'vessel',
    year: '2025',
  });
  mockRoute = { ...mockRoute, params: { ...mockRoute.params, year: '2025' } };
  ui.rerender(<VesselLogHistoryScreen navigation={navigation} route={mockRoute} />);
  await act(async () => {});
  expect(ui.getByText('November')).toBeTruthy();
  expect(ui.getByText('December')).toBeTruthy();
  expect(ui.queryByText('October')).toBeNull();
  fireEvent.press(ui.getByText('November'));
  expect(navigation.push).toHaveBeenLastCalledWith('GeneralWasteLog', {
    historyMonth: '2025-11',
    historyVesselId: 'vessel',
  });
});

it('does not show another vessel history after switching vessels', async () => {
  mockRoute = { name: 'VesselLogHistory', params: { kind: 'fuel', vesselId: 'vessel' } };
  const ui = render(<VesselLogHistoryScreen navigation={{ push: jest.fn() }} route={mockRoute} />);
  await act(async () => {});
  expect(ui.getByText('2025')).toBeTruthy();
  mockUser = { ...mockUser, vesselId: 'other' };
  ui.rerender(<VesselLogHistoryScreen navigation={{ push: jest.fn() }} route={mockRoute} />);
  expect(ui.queryByText('2025')).toBeNull();
  expect(ui.getByText("Open History from your current vessel's log.")).toBeTruthy();
});

it('rolls the current month forward while open and on resume after a long absence', () => {
  jest.setSystemTime(new Date('2026-12-31T23:59:59Z'));
  let onState: any;
  const listener = jest
    .spyOn(AppState, 'addEventListener')
    .mockImplementation((_event, callback) => {
      onState = callback;
      return { remove: jest.fn() };
    });
  const hook = renderHook(() => useVesselLogPeriod('vessel'));
  expect(hook.result.current.month).toBe('2026-12');
  act(() => jest.advanceTimersByTime(1100));
  expect(hook.result.current.month).toBe('2027-01');
  act(() => {
    jest.setSystemTime(new Date('2027-04-08T12:00:00Z'));
    onState('active');
  });
  expect(hook.result.current.month).toBe('2027-04');
  hook.unmount();
  listener.mockRestore();
});

it('does not let a late previous-month response overwrite the new month or export stale selections', async () => {
  let resolveOld: any;
  const fetchLogs = jest
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve;
        })
    )
    .mockResolvedValue([records[0]]);
  const hook = renderHook(
    ({ month }: { month: string }) => useMonthlyVesselLogs('vessel', month, fetchLogs),
    {
      initialProps: { month: '2026-08' },
    }
  );
  hook.rerender({ month: '2026-09' });
  await act(async () => {});
  await act(async () => resolveOld([records[1]]));
  expect(hook.result.current.logs).toEqual([records[0]]);
  hook.unmount();
});

it('shows a retry state rather than pretending a failed month is empty', async () => {
  (waste.getByVesselMonth as jest.Mock).mockRejectedValue(new Error('Offline'));
  const ui = render(<GeneralWasteLogScreen navigation={{}} route={mockRoute} />);
  await act(async () => {});
  expect(ui.getByText('Entries unavailable')).toBeTruthy();
  expect(ui.queryByText('No entries this month')).toBeNull();
  (waste.getByVesselMonth as jest.Mock).mockResolvedValue([records[0]]);
  await act(async () => fireEvent.press(ui.getByText('Retry')));
  expect(ui.getByText('Current entry')).toBeTruthy();
});
