import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { WatchKeepingScreen } from '../../src/screens/WatchKeepingScreen';
import { CreateWatchTimetableScreen } from '../../src/screens/CreateWatchTimetableScreen';
import vesselService from '../../src/services/vessel';
import watchService from '../../src/services/watchKeeping';
import { Alert } from 'react-native';
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn(() => 'publish-request-uuid') }));
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

let mockRole = 'CREW';
let mockDark = false;
let mockFocus: (() => void) | undefined;
const mockUser = {
  id: 'crew',
  name: 'Test Crew',
  vesselId: 'workspace',
  firstName: 'Test',
  lastName: 'Crew',
  position: 'Deckhand',
};
jest.mock('../../src/store', () => ({
  useAuthStore: () => ({ user: { ...mockUser, role: mockRole } }),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (cb: () => void) => {
    mockFocus = cb;
    jest.requireActual('react').useEffect(cb, [cb]);
  },
}));
jest.mock('../../src/hooks/useScreenState', () => ({
  useScreenState: (_name: string, initial: unknown) =>
    jest.requireActual('react').useState(initial),
}));
jest.mock('../../src/hooks/useThemeColors', () => ({
  useThemeColors: () => ({ isDark: mockDark }),
}));
jest.mock('../../src/services/vessel', () => ({
  __esModule: true,
  default: { getVessel: jest.fn() },
}));
jest.mock('../../src/services/user', () => ({
  __esModule: true,
  default: { getVesselCrew: async () => [mockUser] },
}));
jest.mock('../../src/services/supabase', () => ({ supabase: {} }));
jest.mock('../../src/services/watchKeeping', () => ({
  ...jest.requireActual('../../src/services/watchKeeping'),
  __esModule: true,
  default: { getRules: jest.fn(), publish: jest.fn(), update: jest.fn() },
}));
jest.mock('../../src/components', () => {
  const { Text, Pressable, TextInput } = jest.requireActual('react-native');
  return {
    PageHeader: () => null,
    LoadingSpinner: () => null,
    PreviewActionButtons: () => null,
    DateOnlyPicker: () => null,
    TimePickerField: () => null,
    Input: ({ label, ...props }: any) => <TextInput accessibilityLabel={label} {...props} />,
    Button: ({ title, onPress }: any) => (
      <Pressable onPress={onPress}>
        <Text>{title}</Text>
      </Pressable>
    ),
  };
});

beforeEach(() => {
  jest.clearAllMocks();
  mockRole = 'CREW';
  jest.mocked(watchService.getRules).mockResolvedValue(null);
});
describe.each([false, true])('watch schedule access (night=%s)', (dark) => {
  beforeEach(() => {
    mockDark = dark;
  });
  it('keeps expanded rules open when the background refresh finishes', async () => {
    jest
      .mocked(vesselService.getVessel)
      .mockResolvedValue({ id: 'workspace', isSolo: false } as any);
    const content = Array.from({ length: 12 }, (_, i) => `Watch rule ${i + 1}`).join('\n');
    jest.mocked(watchService.getRules).mockResolvedValue({ content } as any);
    const ui = render(<WatchKeepingScreen navigation={{}} />);
    await act(async () => {});
    fireEvent(ui.getByText(content), 'textLayout', { nativeEvent: { lines: Array(12).fill({}) } });
    fireEvent.press(ui.getByText('See More'));
    expect(ui.getByText('See Less')).toBeTruthy();
    await act(async () => {
      mockFocus?.();
    });
    expect(ui.getByText('See Less')).toBeTruthy();
    expect(ui.queryByText('See More')).toBeNull();
    fireEvent.press(ui.getByText('See Less'));
    expect(ui.getByText('See More')).toBeTruthy();
  });
  it.each([
    ['CREW', false, false],
    ['CREW', true, true],
    ['HOD', false, true],
    ['CAPTAIN_MOV', false, true],
    ['MANAGEMENT', false, false],
  ] as const)('%s with personal=%s sees create=%s', async (role, solo, expected) => {
    mockRole = role;
    jest
      .mocked(vesselService.getVessel)
      .mockResolvedValue({ id: 'workspace', isSolo: solo } as any);
    const navigation = { navigate: jest.fn() };
    const ui = render(<WatchKeepingScreen navigation={navigation} />);
    await act(async () => {});
    expect(!!ui.queryByText('Create Watch Schedule')).toBe(expected);
    expect(ui.getByText('Watch Schedule')).toBeTruthy();
    if (expected) {
      fireEvent.press(ui.getByText('Create Watch Schedule'));
      expect(navigation.navigate).toHaveBeenCalledWith('CreateWatchTimetable');
    }
  });
  it('does not grant Crew access while membership is unknown', async () => {
    jest.mocked(vesselService.getVessel).mockResolvedValue(null);
    const ui = render(<WatchKeepingScreen navigation={{}} />);
    await act(async () => {});
    expect(ui.queryByText('Create Watch Schedule')).toBeNull();
  });
  it.each([false, true])('creation form enforces personal=%s for Crew', async (solo) => {
    jest
      .mocked(vesselService.getVessel)
      .mockResolvedValue({ id: 'workspace', isSolo: solo } as any);
    const ui = render(<CreateWatchTimetableScreen navigation={{}} route={{}} />);
    await act(async () => {});
    expect(!!ui.queryByText('Only HODs and Captain have access.')).toBe(!solo);
    expect(watchService.publish).not.toHaveBeenCalled();
  });
  it('personal Crew can generate and publish a schedule', async () => {
    jest
      .mocked(vesselService.getVessel)
      .mockResolvedValue({ id: 'workspace', isSolo: true } as any);
    jest.mocked(watchService.publish).mockResolvedValue({ id: 'new-schedule' } as any);
    const navigation = { replace: jest.fn() };
    const ui = render(<CreateWatchTimetableScreen navigation={navigation} route={{}} />);
    await act(async () => {});
    fireEvent.changeText(ui.getByLabelText('Watch Title'), 'Personal watch');
    fireEvent.changeText(ui.getByLabelText('Total Running Time'), '4');
    fireEvent.press(ui.getByText('Select crew...'));
    fireEvent.press(ui.getByText('Test Crew'));
    fireEvent.press(ui.getByText('Continue'));
    await act(async () => {
      fireEvent.press(ui.getByText('Publish Watch Schedule'));
    });
    expect(watchService.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        vesselId: 'workspace',
        createdBy: 'crew',
        watchTitle: 'Personal watch',
      }),
      'publish-request-uuid'
    );
    expect(navigation.replace).toHaveBeenCalledWith('WatchSchedule', {
      timetableId: 'new-schedule',
    });
  });
  it('retains the form and the same request ID when a publish fails and is retried', async () => {
    jest
      .mocked(vesselService.getVessel)
      .mockResolvedValue({ id: 'workspace', isSolo: true } as NonNullable<
        Awaited<ReturnType<typeof vesselService.getVessel>>
      >);
    jest
      .mocked(watchService.publish)
      .mockRejectedValueOnce(new Error('Network request failed'))
      .mockResolvedValueOnce({ id: 'saved-once' } as Awaited<
        ReturnType<typeof watchService.publish>
      >);
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const log = jest.spyOn(console, 'error').mockImplementation(() => {});
    const navigation = { replace: jest.fn() };
    const ui = render(<CreateWatchTimetableScreen navigation={navigation} route={{}} />);
    await act(async () => {});
    fireEvent.changeText(ui.getByLabelText('Watch Title'), 'Retry watch');
    fireEvent.changeText(ui.getByLabelText('Total Running Time'), '4');
    fireEvent.press(ui.getByText('Select crew...'));
    fireEvent.press(ui.getByText('Test Crew'));
    fireEvent.press(ui.getByText('Continue'));
    await act(async () => {
      fireEvent.press(ui.getByText('Publish Watch Schedule'));
    });
    expect(navigation.replace).not.toHaveBeenCalled();
    expect(alert).toHaveBeenCalledWith('Error', 'Network request failed');
    await act(async () => {
      fireEvent.press(ui.getByText('Publish Watch Schedule'));
    });
    const calls = jest.mocked(watchService.publish).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[1]).toEqual(calls[0]);
    expect(calls[1][1]).toBe('publish-request-uuid');
    expect(navigation.replace).toHaveBeenCalledWith('WatchSchedule', { timetableId: 'saved-once' });
    alert.mockRestore();
    log.mockRestore();
  });
});
