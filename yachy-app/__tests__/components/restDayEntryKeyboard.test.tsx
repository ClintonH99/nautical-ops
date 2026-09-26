import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { Keyboard, KeyboardAvoidingView, ScrollView, TextInput } from 'react-native';
import { RestDayEntryScreen } from '../../src/screens/RestDayEntryScreen';
import { getWeekEntries, saveEntry } from '../../src/services/restEntries';

const mockUser = { id: 'crew', vesselId: 'vessel', role: 'CREW' };
jest.mock('../../src/store', () => ({ useAuthStore: () => ({ user: mockUser }) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (callback: () => void) => {
    const { useEffect } = require('react');
    useEffect(callback, [callback]);
  },
}));
jest.mock('../../src/hooks/useThemeColors', () => ({
  useThemeColors: () => ({
    background: '#fff',
    surface: '#fff',
    control: '#fff',
    textPrimary: '#111',
    textSecondary: '#555',
    border: '#ddd',
  }),
}));
jest.mock('../../src/components', () => {
  const { Text, Pressable } = require('react-native');
  return {
    PageHeader: ({ title }: { title: string }) => <Text>{title}</Text>,
    TimePickerField: () => null,
    Button: ({ title, onPress }: { title: string; onPress: () => void }) => (
      <Pressable onPress={onPress}>
        <Text>{title}</Text>
      </Pressable>
    ),
  };
});
jest.mock('../../src/services/restEntries', () => ({
  getWeekEntries: jest.fn(async () => []),
  canManageRestFor: jest.fn(async () => false),
  checkCompliance: () => ({ compliant: true, totalRestHours: 10, violations: [] }),
  saveEntry: jest.fn(async () => undefined),
}));
jest.mock('../../src/services/signatures', () => ({
  getSignatureForUser: async () => ({ id: 'signature' }),
}));
jest.mock('../../src/services/watchKeeping', () => ({
  __esModule: true,
  default: { getWorkPeriodsForUser: async () => [] },
  getRestWatchConflicts: () => [],
}));

describe('Create Rest Entry keyboard', () => {
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => jest.restoreAllMocks());

  it('displays the saved comment when reopening an entry', async () => {
    jest.mocked(getWeekEntries).mockResolvedValueOnce([
      {
        user_id: 'crew',
        vessel_id: 'vessel',
        date: '2026-09-26',
        rest_periods: [{ start: '22:00', end: '08:00' }],
        work_start: '08:00',
        work_end: '17:00',
        lunch_start: '12:00',
        lunch_end: '13:00',
        comment: 'Night watch',
        status: 'draft',
      },
    ]);
    const ui = render(
      <RestDayEntryScreen
        navigation={{ goBack: jest.fn() }}
        route={{ params: { date: '2026-09-26' } }}
      />
    );
    await act(async () => {});
    expect(ui.getByLabelText('Hours of Rest comment').props.value).toBe('Night watch');
    expect(ui.getByText('11/20')).toBeTruthy();
  });

  it('keeps entered text visible in state and the counter live, including deletion at the cap', async () => {
    const ui = render(
      <RestDayEntryScreen
        navigation={{ goBack: jest.fn() }}
        route={{ params: { date: '2026-09-26' } }}
      />
    );
    await act(async () => {});
    const input = () => ui.getByLabelText('Hours of Rest comment');
    fireEvent.changeText(input(), 'Night watch');
    expect(input().props.value).toBe('Night watch');
    expect(ui.getByText('11/20')).toBeTruthy();
    fireEvent.changeText(input(), 'W'.repeat(20));
    expect(ui.getByText('20/20')).toBeTruthy();
    fireEvent.changeText(input(), 'W'.repeat(19));
    expect(input().props.value).toHaveLength(19);
    expect(ui.getByText('19/20')).toBeTruthy();
    await act(async () => {
      fireEvent.press(ui.getByText('Save Draft'));
    });
    expect(saveEntry).toHaveBeenCalledWith(expect.objectContaining({ comment: 'W'.repeat(19) }));
  });

  it('resizes the form and allows taps and scrolling while the keyboard is open', async () => {
    const dismiss = jest.spyOn(Keyboard, 'dismiss');
    const ui = render(
      <RestDayEntryScreen
        navigation={{ goBack: jest.fn() }}
        route={{ params: { date: '2026-09-26' } }}
      />
    );
    await act(async () => {});
    expect(ui.UNSAFE_getByType(KeyboardAvoidingView).props.behavior).toBeTruthy();
    const scroll = ui.UNSAFE_getByType(ScrollView);
    expect(scroll.props.keyboardShouldPersistTaps).toBe('handled');
    expect(['interactive', 'on-drag']).toContain(scroll.props.keyboardDismissMode);
    const input = ui.UNSAFE_getByType(TextInput);
    expect(input.props.submitBehavior).toBe('blurAndSubmit');
    expect(input.props.returnKeyType).toBe('done');
    fireEvent(input, 'submitEditing');
    expect(dismiss).toHaveBeenCalled();
  });
});
