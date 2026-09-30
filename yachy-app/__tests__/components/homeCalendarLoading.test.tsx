import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import type { CalendarProps } from 'react-native-calendars';
import { HomeScreen } from '../../src/screens/HomeScreen';
import tripsService from '../../src/services/trips';
import yardJobsService from '../../src/services/yardJobs';
import crewLeaveService from '../../src/services/crewLeave';
import AsyncStorage from '@react-native-async-storage/async-storage';
let mockUser = { id: 'crew', role: 'CREW', vesselId: 'vessel' };
const mockColorsLoad = jest.fn();
const mockCalendarProps = jest.fn();
beforeEach(() => {
  mockUser = { id: 'crew', role: 'CREW', vesselId: 'vessel' };
});
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (cb: () => void) => jest.requireActual('react').useEffect(cb, [cb]),
}));
jest.mock('../../src/hooks/useScreenState', () => ({
  useScreenState: (_name: string, initial: unknown) =>
    jest.requireActual('react').useState(initial),
}));
jest.mock('../../src/store', () => ({
  useAuthStore: () => ({ user: mockUser }),
  useDepartmentColorStore: (select: any) => select({ overrides: {} }),
  getDepartmentColor: () => '#123456',
}));
jest.mock('../../src/hooks/useThemeColors', () => ({ useThemeColors: () => ({ isDark: false }) }));
jest.mock('../../src/components', () => ({ Button: jest.requireActual('../../src/components/Button').Button }));
jest.mock('react-native-calendars', () => ({
  Calendar: (props: CalendarProps) => {
    mockCalendarProps(props);
    const { Text } = jest.requireActual('react-native');
    return <Text testID="calendar">{Object.keys(props.markedDates ?? {}).join(',')}</Text>;
  },
}));
jest.mock('../../src/services/vessel', () => ({
  __esModule: true,
  default: {
    getVessel: async () => ({ name: 'Vessel' }),
    getBannerVersion: () => 1,
    getBannerPublicUrl: () => null,
  },
}));
jest.mock('../../src/services/trips', () => ({
  __esModule: true,
  default: { getTripsByVessel: jest.fn() },
}));
jest.mock('../../src/services/yardJobs', () => ({
  __esModule: true,
  default: { getByVessel: jest.fn() },
}));
jest.mock('../../src/services/crewLeave', () => ({
  __esModule: true,
  default: { getCalendarInRange: jest.fn() },
}));
jest.mock('../../src/services/tripColors', () => ({ DEFAULT_COLORS: {} }));
jest.mock('../../src/hooks/useVesselTripColors', () => ({
  useVesselTripColors: () => ({ colors: null, load: mockColorsLoad }),
  getTripTypeColorMap: () => ({ GUEST: '#123456' }),
}));
it('shows trips without waiting for yard jobs, leave or colors', async () => {
  mockUser = { id: 'crew', role: 'CREW', vesselId: 'vessel' };
  let finishYard!: (value: any[]) => void;
  let finishLeave!: (value: any[]) => void;
  let finishColors!: () => void;
  jest
    .mocked(tripsService.getTripsByVessel)
    .mockResolvedValue([
      { id: 'trip', type: 'GUEST', startDate: '2026-09-27', endDate: '2026-09-27' },
    ] as any);
  jest.mocked(yardJobsService.getByVessel).mockReturnValue(
    new Promise((resolve) => {
      finishYard = resolve;
    })
  );
  jest.mocked(crewLeaveService.getCalendarInRange).mockReturnValue(
    new Promise((resolve) => {
      finishLeave = resolve;
    })
  );
  mockColorsLoad.mockReturnValue(
    new Promise<void>((resolve) => {
      finishColors = resolve;
    })
  );
  const ui = render(<HomeScreen navigation={{}} />);
  await act(async () => {});
  expect(ui.getByTestId('calendar')).toHaveTextContent('2026-09-27');
  await act(async () => {
    finishYard([]);
    finishLeave([]);
    finishColors();
  });
  expect(ui.getByTestId('calendar')).toHaveTextContent('2026-09-27');
  // Home deliberately retains the original heading/arrows for all three modes.
  for (const mode of ['Trips', 'Yard Period', 'Crew Leave']) {
    fireEvent.press(ui.getByText(mode, { exact: true }));
    const props = mockCalendarProps.mock.calls.at(-1)![0] as CalendarProps;
    expect(props.hideArrows).toBe(false);
    expect(props.customHeader).toBeUndefined();
    expect(props.renderHeader).toBeUndefined();
    expect(props.markingType).toBe('multi-period');
    expect(props.onMonthChange).toEqual(expect.any(Function));
  }
});

it('shows the welcome board per captain/vessel and See Plans opens Vessel Plans', async () => {
  mockUser = { id: 'new-captain', role: 'CAPTAIN_MOV', vesselId: 'new-vessel' };
  jest.mocked(tripsService.getTripsByVessel).mockResolvedValue([]);
  jest.mocked(yardJobsService.getByVessel).mockResolvedValue([]);
  jest.mocked(crewLeaveService.getCalendarInRange).mockResolvedValue([]);
  mockColorsLoad.mockResolvedValue(undefined);
  // An earlier account on this phone must not suppress the new account's board.
  await AsyncStorage.setItem('has_seen_welcome_popup', 'true');
  const navigation = { navigate: jest.fn() };
  const ui = render(<HomeScreen navigation={navigation} />);
  await act(async () => {});
  expect(ui.getByText('Welcome to Nautical Ops!')).toBeTruthy();
  expect(ui.getByRole('button', { name: 'Continue' })).toBeTruthy();
  await act(async () => { fireEvent.press(ui.getByRole('button', { name: 'See Plans' })); });
  expect(navigation.navigate).toHaveBeenCalledWith('VesselPlans');
  expect(await AsyncStorage.getItem('has_seen_welcome_popup:new-captain:new-vessel')).toBe('true');
  expect(ui.queryByText('Welcome to Nautical Ops!')).toBeNull();
});
