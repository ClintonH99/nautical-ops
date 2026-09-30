import React from 'react';
import { act, render } from '@testing-library/react-native';
import { HomeScreen } from '../../src/screens/HomeScreen';
import tripsService from '../../src/services/trips';
import yardJobsService from '../../src/services/yardJobs';
import crewLeaveService from '../../src/services/crewLeave';
const mockColorsLoad = jest.fn();
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
  useAuthStore: () => ({ user: { id: 'crew', role: 'CREW', vesselId: 'vessel' } }),
  useDepartmentColorStore: (select: any) => select({ overrides: {} }),
  getDepartmentColor: () => '#123456',
}));
jest.mock('../../src/hooks/useThemeColors', () => ({ useThemeColors: () => ({ isDark: false }) }));
jest.mock('../../src/components', () => ({ Button: () => null }));
jest.mock('react-native-calendars', () => ({
  Calendar: ({ markedDates }: any) => {
    const { Text } = jest.requireActual('react-native');
    return <Text testID="calendar">{Object.keys(markedDates).join(',')}</Text>;
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
});
