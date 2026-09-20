import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { DepartmentMultiSelector } from '../../src/components/DepartmentMultiSelector';
import { DepartmentSelector } from '../../src/components/DepartmentSelector';
import { COLORS } from '../../src/constants/theme';
import { DEPARTMENT_OPTIONS } from '../../src/utils/departmentSelection';

let mockThemeColors = {
  isDark: false,
  textPrimary: '#0D0D0D',
  textSecondary: '#64748B',
  surfaceElevated: '#FFFFFF',
  control: '#FFFFFF',
  border: '#E5E7EB',
  borderStrong: '#D1D5DB',
  accent: '#3B82F6',
};

jest.mock('../../src/hooks/useThemeColors', () => ({
  useThemeColors: () => mockThemeColors,
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: () => null,
}));

describe('department selectors', () => {
  beforeEach(() => {
    mockThemeColors = {
      isDark: false,
      textPrimary: '#0D0D0D',
      textSecondary: '#64748B',
      surfaceElevated: '#FFFFFF',
      control: '#FFFFFF',
      border: '#E5E7EB',
      borderStrong: '#D1D5DB',
      accent: '#3B82F6',
    };
  });

  it('closes the single selector immediately after choosing a department', () => {
    const onChange = jest.fn();
    const screen = render(<DepartmentSelector value="BRIDGE" onChange={onChange} />);

    fireEvent.press(screen.getByLabelText('Department: Bridge'));
    fireEvent.press(screen.getByLabelText('Engineering'));

    expect(onChange).toHaveBeenCalledWith('ENGINEERING');
    expect(screen.queryByText('Select department')).toBeNull();
  });

  it('uses navy for the Day trigger and the selected row', () => {
    const screen = render(<DepartmentSelector value="BRIDGE" onChange={jest.fn()} />);

    expect(screen.getByText('Bridge')).toHaveStyle({ color: COLORS.primary });
    fireEvent.press(screen.getByLabelText('Department: Bridge'));
    expect(screen.getByLabelText('Bridge')).toHaveStyle({ backgroundColor: COLORS.primary });
  });

  it('uses white for the Night trigger', () => {
    mockThemeColors = {
      ...mockThemeColors,
      isDark: true,
      textPrimary: COLORS.white,
      surfaceElevated: '#182335',
      control: '#111827',
      border: '#374151',
      borderStrong: '#94A3B8',
    };
    const screen = render(<DepartmentSelector value="BRIDGE" onChange={jest.fn()} />);

    expect(screen.getByText('Bridge')).toHaveStyle({ color: COLORS.white });
  });

  it('shows only the aggregate row as selected when all departments are active', () => {
    const onChange = jest.fn();
    const screen = render(
      <DepartmentMultiSelector
        value={[...DEPARTMENT_OPTIONS]}
        onChange={onChange}
        includeAll
        minSelections={1}
      />
    );

    fireEvent.press(screen.getByLabelText('Department: All Departments'));

    expect(screen.getByLabelText('All Departments').props.accessibilityState).toEqual({
      selected: true,
    });
    expect(screen.getByLabelText('Bridge').props.accessibilityState).toEqual({
      selected: false,
      disabled: false,
    });
    fireEvent.press(screen.getByLabelText('Bridge'));
    expect(onChange).toHaveBeenCalledWith(['BRIDGE']);
  });

  it('disables additions at the maximum and does not offer an invalid Select All action', () => {
    const onChange = jest.fn();
    const screen = render(
      <DepartmentMultiSelector
        value={['BRIDGE', 'ENGINEERING']}
        onChange={onChange}
        maxSelections={2}
      />
    );

    fireEvent.press(screen.getByLabelText('Department: Bridge, Engineering'));

    expect(screen.queryByLabelText('All Departments')).toBeNull();
    expect(screen.getByLabelText('Galley')).toBeDisabled();
    fireEvent.press(screen.getByLabelText('Galley'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('renders inline instead of stacking a native modal when requested', () => {
    const screen = render(
      <DepartmentSelector value="BRIDGE" onChange={jest.fn()} presentation="inline" />
    );

    fireEvent.press(screen.getByLabelText('Department: Bridge'));

    expect(screen.getByText('Select department')).toBeOnTheScreen();
    expect(screen.getByLabelText('Close department selector')).toBeOnTheScreen();
  });
});
