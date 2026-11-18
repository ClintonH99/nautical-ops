import React from 'react';
import { Keyboard } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import { TimePickerField, formatTimePickerValue } from '../../src/components/TimePickerField';

jest.mock('../../src/hooks/useThemeColors', () => ({
  useThemeColors: () => ({
    isDark: false,
    surfaceAlt: '#F1F3F5',
    surfaceElevated: '#FFFFFF',
    control: '#FFFFFF',
    controlSelected: '#1E3A8A',
    border: '#E5E7EB',
    borderStrong: '#94A3B8',
    textPrimary: '#0D0D0D',
    textSecondary: '#64748B',
    textMuted: '#94A3B8',
    textOnAccent: '#FFFFFF',
  }),
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: () => null,
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

function createTime(hour: number, minute: number): Date {
  const value = new Date(2026, 8, 25, hour, minute, 0, 0);
  return value;
}

describe('TimePickerField', () => {
  it('formats every time as 24-hour HH:mm', () => {
    expect(formatTimePickerValue(createTime(0, 5))).toBe('00:05');
    expect(formatTimePickerValue(createTime(23, 59))).toBe('23:59');
  });

  it('opens the standard selector and applies the draft only when Done is pressed', () => {
    const dismiss = jest.spyOn(Keyboard, 'dismiss');
    const onChange = jest.fn();
    const value = createTime(14, 30);
    const screen = render(
      <TimePickerField label="Time" title="Select Time" value={value} onChange={onChange} />
    );

    fireEvent.press(screen.getByLabelText('Time, 14:30'));
    expect(dismiss).toHaveBeenCalled();
    expect(screen.getByText('Select Time')).toBeOnTheScreen();

    fireEvent.press(screen.getByText('Cancel'));
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.press(screen.getByLabelText('Time, 14:30'));
    fireEvent.press(screen.getByText('Done'));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(formatTimePickerValue(onChange.mock.calls[0][0])).toBe('14:30');
    dismiss.mockRestore();
  });
});

it.each([
  [0, 0],
  [0, 59],
  [23, 59],
  [9, 7],
  [15, 39],
])('saves the manually entered time %s:%s without changing the selected day', (hour, minute) => {
  const onChange = jest.fn();
  const original = createTime(14, 30);
  const ui = render(<TimePickerField label="Time" value={original} onChange={onChange} />);
  fireEvent.press(ui.getByLabelText('Time, 14:30'));
  expect(ui.getByLabelText('Hour (00–23)').props.value).toBe('14');
  expect(ui.getByLabelText('Minute (00–59)').props.value).toBe('30');
  fireEvent.changeText(ui.getByLabelText('Hour (00–23)'), String(hour));
  fireEvent.changeText(ui.getByLabelText('Minute (00–59)'), String(minute));
  expect(onChange).not.toHaveBeenCalled();
  fireEvent.press(ui.getByText('Done'));
  const result: Date = onChange.mock.calls[0][0];
  expect([result.getHours(), result.getMinutes()]).toEqual([hour, minute]);
  expect([result.getFullYear(), result.getMonth(), result.getDate()]).toEqual([2026, 8, 25]);
  expect(formatTimePickerValue(original)).toBe('14:30');
});

it.each([
  ['24', '00'],
  ['12', '60'],
  ['', '30'],
  ['no', '30'],
])('rejects invalid input %s:%s instead of silently changing it', (hour, minute) => {
  const onChange = jest.fn();
  const ui = render(
    <TimePickerField label="Time" value={createTime(14, 30)} onChange={onChange} />
  );
  fireEvent.press(ui.getByLabelText('Time, 14:30'));
  fireEvent.changeText(ui.getByLabelText('Hour (00–23)'), hour);
  fireEvent.changeText(ui.getByLabelText('Minute (00–59)'), minute);
  fireEvent.press(ui.getByText('Done'));
  expect(onChange).not.toHaveBeenCalled();
  expect(ui.getByRole('alert')).toBeTruthy();
});

it('cancels typed edits and reopens with the actual saved time', () => {
  const onChange = jest.fn();
  const ui = render(
    <TimePickerField label="Time" value={createTime(15, 39)} onChange={onChange} />
  );
  fireEvent.press(ui.getByLabelText('Time, 15:39'));
  fireEvent.changeText(ui.getByLabelText('Hour (00–23)'), '3');
  fireEvent.press(ui.getByText('Cancel'));
  fireEvent.press(ui.getByLabelText('Time, 15:39'));
  expect(ui.getByLabelText('Hour (00–23)').props.value).toBe('15');
  expect(onChange).not.toHaveBeenCalled();
});
