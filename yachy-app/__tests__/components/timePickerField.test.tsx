import React from 'react';
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
    const onChange = jest.fn();
    const value = createTime(14, 30);
    const screen = render(
      <TimePickerField label="Time" title="Select Time" value={value} onChange={onChange} />
    );

    fireEvent.press(screen.getByLabelText('Time, 14:30'));
    expect(screen.getByText('Select Time')).toBeOnTheScreen();

    fireEvent.press(screen.getByText('Cancel'));
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.press(screen.getByLabelText('Time, 14:30'));
    fireEvent.press(screen.getByText('Done'));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(formatTimePickerValue(onChange.mock.calls[0][0])).toBe('14:30');
  });
});
