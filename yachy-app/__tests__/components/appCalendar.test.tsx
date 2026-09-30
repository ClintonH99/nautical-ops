import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { AppCalendar } from '../../src/components/AppCalendar';
import { DateOnlyPicker } from '../../src/components/DateOnlyPicker';
import { toYYYYMMDD } from '../../src/utils';

let mockDark = false;
jest.mock('../../src/hooks/useThemeColors', () => ({
  useThemeColors: () => ({
    isDark: mockDark,
    surface: mockDark ? '#1E293B' : '#FFFFFF',
    surfaceElevated: mockDark ? '#223149' : '#FFFFFF',
    control: '#FFFFFF',
    border: '#E5E7EB',
    accent: '#1E3A8A',
    textPrimary: mockDark ? '#FFFFFF' : '#0D0D0D',
    textSecondary: '#64748B',
    textMuted: '#94A3B8',
  }),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

beforeEach(() => {
  mockDark = false;
});

it('opens on the existing date and commits a day without a confirmation button', () => {
  const onChange = jest.fn();
  const ui = render(<DateOnlyPicker label="Date" value="2029-06-15" onChange={onChange} />);
  fireEvent.press(ui.getByRole('button', { name: /^Date:/ }));
  expect(ui.getByLabelText('Choose month, June')).toBeOnTheScreen();
  expect(ui.queryByText('Set Date')).toBeNull();
  fireEvent.press(ui.getByText('16', { exact: true }));
  expect(onChange).toHaveBeenCalledWith('2029-06-16');
  expect(ui.queryByTestId('date-picker-popover')).toBeNull();
});

it('changing month or year never commits; outside dismissal preserves the saved date', () => {
  const onChange = jest.fn();
  const ui = render(<DateOnlyPicker label="Date" value="2029-06-15" onChange={onChange} />);
  fireEvent.press(ui.getByRole('button', { name: /^Date:/ }));
  fireEvent.press(ui.getByLabelText('Choose month, June'));
  fireEvent.press(ui.getByLabelText('Month February'));
  fireEvent.press(ui.getByLabelText('Choose year, 2029'));
  fireEvent.press(ui.getByLabelText('Year 2028'));
  expect(ui.getByText('29', { exact: true })).toBeOnTheScreen();
  expect(onChange).not.toHaveBeenCalled();
  fireEvent.press(ui.getByLabelText('Dismiss date selector'));
  fireEvent.press(ui.getByRole('button', { name: /^Date:/ }));
  expect(ui.getByLabelText('Choose month, June')).toBeOnTheScreen();
  expect(ui.getByLabelText('Choose year, 2029')).toBeOnTheScreen();
});

it('keeps inclusive date bounds and prevents out-of-range month selection', () => {
  const onChange = jest.fn();
  const ui = render(
    <DateOnlyPicker
      label="Date"
      value="2029-06-15"
      minimumDate="2029-06-10"
      maximumDate="2029-06-20"
      onChange={onChange}
    />
  );
  fireEvent.press(ui.getByRole('button', { name: /^Date:/ }));
  fireEvent.press(ui.getByText('9', { exact: true }));
  expect(onChange).not.toHaveBeenCalled();
  fireEvent.press(ui.getByLabelText('Choose month, June'));
  expect(ui.getByLabelText('Month May')).toBeDisabled();
  expect(ui.getByLabelText('Month July')).toBeDisabled();
  fireEvent.press(ui.getByLabelText('Close calendar menu'));
  fireEvent.press(ui.getByText('20', { exact: true }));
  expect(onChange).toHaveBeenCalledWith('2029-06-20');
});

it('keeps range marks and notifies the parent when jumping month or year', () => {
  const onMonthChange = jest.fn();
  const onDayPress = jest.fn();
  const ui = render(
    <AppCalendar
      current="2029-06-15"
      inlineMenus
      hideExtraDays
      markingType="period"
      markedDates={{
        '2029-06-15': { startingDay: true, color: '#00AA99' },
        '2029-06-16': { endingDay: true, color: '#00AA99' },
      }}
      onMonthChange={onMonthChange}
      onDayPress={onDayPress}
    />
  );
  fireEvent.press(ui.getByLabelText('Choose year, 2029'));
  fireEvent.press(ui.getByLabelText('Year 2030'));
  expect(onMonthChange).toHaveBeenLastCalledWith(expect.objectContaining({ year: 2030, month: 6 }));
  expect(onDayPress).not.toHaveBeenCalled();
  fireEvent.press(ui.getByText('15', { exact: true }));
  expect(onDayPress).toHaveBeenCalledWith(expect.objectContaining({ dateString: '2030-06-15' }));
});

it('uses dark-mode dropdown text and distinguishes the selected day', () => {
  mockDark = true;
  const ui = render(
    <AppCalendar
      current="2029-06-15"
      inlineMenus
      hideExtraDays
      markedDates={{ '2029-06-15': { selected: true } }}
    />
  );
  expect(ui.getByText('15', { exact: true })).toHaveStyle({ color: '#10213B' });
  fireEvent.press(ui.getByLabelText('Choose month, June'));
  expect(ui.getByText('January')).toHaveStyle({ color: '#FFFFFF' });
});

it('does not select a value when an empty field opens or is dismissed', () => {
  const onChange = jest.fn();
  const ui = render(<DateOnlyPicker label="Date" value={null} onChange={onChange} />);
  fireEvent.press(ui.getByRole('button', { name: /^Date:/ }));
  fireEvent.press(ui.getByLabelText('Dismiss date selector'));
  expect(onChange).not.toHaveBeenCalled();
});

it('keeps a parent-controlled month stable without duplicate initial or change callbacks', () => {
  const onMonthChange = jest.fn();
  function ControlledCalendar() {
    const [month, setMonth] = React.useState(new Date(2026, 8, 1));
    return (
      <AppCalendar
        current={toYYYYMMDD(month)}
        hideExtraDays
        inlineMenus
        onMonthChange={(date) => {
          onMonthChange(date);
          setMonth(new Date(date.year, date.month - 1, 1));
        }}
      />
    );
  }
  const ui = render(<ControlledCalendar />);
  expect(onMonthChange).not.toHaveBeenCalled();
  fireEvent.press(ui.getByLabelText('Choose month, September'));
  fireEvent.press(ui.getByLabelText('Month February'));
  expect(ui.getByLabelText('Choose month, February')).toBeOnTheScreen();
  expect(ui.getByLabelText('Choose year, 2026')).toBeOnTheScreen();
  expect(onMonthChange).toHaveBeenCalledTimes(1);
});
