import { Department } from '../types';

export const DEPARTMENT_OPTIONS = Object.freeze([
  'BRIDGE',
  'ENGINEERING',
  'EXTERIOR',
  'INTERIOR',
  'GALLEY',
] satisfies Department[]);

export const formatDepartmentLabel = (department: Department) =>
  department.charAt(0) + department.slice(1).toLowerCase();

export const getSelectedDepartments = (value: readonly Department[]) =>
  DEPARTMENT_OPTIONS.filter((department) => value.includes(department));

export const areAllDepartmentsSelected = (selected: readonly Department[]) =>
  DEPARTMENT_OPTIONS.every((department) => selected.includes(department));

export const getDepartmentSelectionLimits = (minSelections = 0, maxSelections?: number) => {
  const maximum = Math.max(
    0,
    Math.min(maxSelections ?? DEPARTMENT_OPTIONS.length, DEPARTMENT_OPTIONS.length)
  );
  const minimum = Math.min(Math.max(0, minSelections), maximum);

  return { minimum, maximum };
};

export const canSelectAllDepartments = (maxSelections?: number) =>
  getDepartmentSelectionLimits(0, maxSelections).maximum === DEPARTMENT_OPTIONS.length;

export const toggleDepartmentSelection = (
  value: readonly Department[],
  department: Department,
  minSelections = 0,
  maxSelections?: number
) => {
  const selected = getSelectedDepartments(value);
  const { minimum, maximum } = getDepartmentSelectionLimits(minSelections, maxSelections);

  if (selected.includes(department)) {
    return selected.length <= minimum ? selected : selected.filter((item) => item !== department);
  }

  return selected.length >= maximum ? selected : [...selected, department];
};

/**
 * Individual rows look unselected while the aggregate row owns the visual
 * state. Activating one therefore focuses the selection on that department,
 * while retaining enough additional departments to satisfy a future minimum.
 */
export const selectDepartmentFromAggregate = (
  department: Department,
  minSelections = 0,
  maxSelections?: number
) => {
  const { minimum, maximum } = getDepartmentSelectionLimits(minSelections, maxSelections);
  if (maximum === 0) return [];

  const requiredCount = Math.max(1, minimum);
  return [department, ...DEPARTMENT_OPTIONS.filter((option) => option !== department)].slice(
    0,
    requiredCount
  );
};

/**
 * In the multi-select list, the aggregate "All Departments" option owns the
 * selected state when every department is active. This avoids highlighting
 * that row and all five individual rows at the same time.
 */
export const isIndividualDepartmentSelected = (
  department: Department,
  selected: readonly Department[],
  aggregateSelected: boolean
) => !aggregateSelected && selected.includes(department);
