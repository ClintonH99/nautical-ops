import {
  areAllDepartmentsSelected,
  canSelectAllDepartments,
  DEPARTMENT_OPTIONS,
  formatDepartmentLabel,
  getSelectedDepartments,
  isIndividualDepartmentSelected,
  selectDepartmentFromAggregate,
  toggleDepartmentSelection,
} from '../../src/utils/departmentSelection';

describe('department selection presentation', () => {
  it('keeps the supported departments in their standard display order', () => {
    expect(DEPARTMENT_OPTIONS).toEqual(['BRIDGE', 'ENGINEERING', 'EXTERIOR', 'INTERIOR', 'GALLEY']);
  });

  it('normalizes selection order and removes duplicates', () => {
    expect(getSelectedDepartments(['GALLEY', 'BRIDGE', 'BRIDGE'])).toEqual(['BRIDGE', 'GALLEY']);
  });

  it('uses only the aggregate row when all departments are selected', () => {
    const selected = getSelectedDepartments(DEPARTMENT_OPTIONS);
    const allSelected = areAllDepartmentsSelected(selected);

    expect(allSelected).toBe(true);
    expect(
      DEPARTMENT_OPTIONS.some((department) =>
        isIndividualDepartmentSelected(department, selected, allSelected)
      )
    ).toBe(false);
  });

  it('does not treat duplicate entries as every department', () => {
    expect(areAllDepartmentsSelected(['BRIDGE', 'BRIDGE', 'BRIDGE', 'BRIDGE', 'BRIDGE'])).toBe(
      false
    );
  });

  it('marks individual rows during a partial selection', () => {
    const selected = getSelectedDepartments(['BRIDGE', 'GALLEY']);

    expect(isIndividualDepartmentSelected('BRIDGE', selected, false)).toBe(true);
    expect(isIndividualDepartmentSelected('ENGINEERING', selected, false)).toBe(false);
  });

  it('keeps individual rows selected when no aggregate option is shown', () => {
    const selected = getSelectedDepartments(DEPARTMENT_OPTIONS);

    expect(isIndividualDepartmentSelected('BRIDGE', selected, false)).toBe(true);
  });

  it('focuses an aggregate selection on the tapped row without breaking the minimum', () => {
    expect(selectDepartmentFromAggregate('BRIDGE', 1)).toEqual(['BRIDGE']);
    expect(selectDepartmentFromAggregate('GALLEY', 2)).toEqual(['GALLEY', 'BRIDGE']);
  });

  it('enforces maximum selections, including zero', () => {
    expect(toggleDepartmentSelection(['BRIDGE', 'GALLEY'], 'ENGINEERING', 0, 2)).toEqual([
      'BRIDGE',
      'GALLEY',
    ]);
    expect(toggleDepartmentSelection([], 'BRIDGE', 0, 0)).toEqual([]);
  });

  it('only offers the aggregate option when selecting all is permitted', () => {
    expect(canSelectAllDepartments()).toBe(true);
    expect(canSelectAllDepartments(5)).toBe(true);
    expect(canSelectAllDepartments(2)).toBe(false);
    expect(canSelectAllDepartments(0)).toBe(false);
  });

  it('formats enum values for display', () => {
    expect(formatDepartmentLabel('ENGINEERING')).toBe('Engineering');
  });
});
