import type { CrewLeave } from '../../src/types';
import {
  getCrewLeaveMonthRange,
  getCrewLeaveStatus,
  getCrewLeaveStatusLabel,
  sortCrewLeave,
} from '../../src/utils/crewLeave';

const makeLeave = (overrides: Partial<CrewLeave> = {}): CrewLeave => ({
  id: 'leave-1',
  vesselId: 'vessel-1',
  crewMemberId: 'crew-1',
  crewMemberName: 'Rachel Adams',
  crewMemberPosition: 'Chief Stewardess',
  crewMemberDepartments: ['INTERIOR'],
  leaveType: 'ANNUAL',
  startDate: '2026-09-20',
  endDate: '2026-09-22',
  notes: '',
  createdBy: 'captain-1',
  createdAt: '2026-09-10T12:00:00Z',
  updatedAt: '2026-09-10T12:00:00Z',
  ...overrides,
});

describe('crew leave presentation helpers', () => {
  const today = '2026-09-21';

  it('uses inclusive boundaries for currently-on-leave records', () => {
    expect(getCrewLeaveStatus(makeLeave({ startDate: today, endDate: today }), today)).toBe(
      'CURRENT'
    );
    expect(getCrewLeaveStatusLabel('CURRENT')).toBe('Currently on leave');
  });

  it('distinguishes upcoming and completed leave', () => {
    expect(
      getCrewLeaveStatus(makeLeave({ startDate: '2026-09-22', endDate: '2026-09-23' }), today)
    ).toBe('UPCOMING');
    expect(
      getCrewLeaveStatus(makeLeave({ startDate: '2025-09-20', endDate: '2025-09-22' }), today)
    ).toBe('COMPLETED');
  });

  it('sorts current, upcoming and completed records operationally without mutating input', () => {
    const input = [
      makeLeave({
        id: 'old',
        crewMemberName: 'Old',
        startDate: '2025-01-01',
        endDate: '2025-01-02',
      }),
      makeLeave({
        id: 'future-2',
        crewMemberName: 'Future 2',
        startDate: '2026-10-02',
        endDate: '2026-10-03',
      }),
      makeLeave({
        id: 'current-2',
        crewMemberName: 'Current 2',
        startDate: '2026-09-10',
        endDate: '2026-09-25',
      }),
      makeLeave({
        id: 'future-1',
        crewMemberName: 'Future 1',
        startDate: '2026-10-01',
        endDate: '2026-10-03',
      }),
      makeLeave({
        id: 'current-1',
        crewMemberName: 'Current 1',
        startDate: '2026-09-20',
        endDate: '2026-09-22',
      }),
      makeLeave({
        id: 'recent',
        crewMemberName: 'Recent',
        startDate: '2026-09-01',
        endDate: '2026-09-19',
      }),
    ];

    expect(sortCrewLeave(input, today).map((leave) => leave.id)).toEqual([
      'current-1',
      'current-2',
      'future-1',
      'future-2',
      'recent',
      'old',
    ]);
    expect(input.map((leave) => leave.id)).toEqual([
      'old',
      'future-2',
      'current-2',
      'future-1',
      'current-1',
      'recent',
    ]);
  });

  it('returns exact month boundaries, including leap years', () => {
    expect(getCrewLeaveMonthRange(2028, 2)).toEqual({
      startDate: '2028-02-01',
      endDate: '2028-02-29',
    });
    expect(getCrewLeaveMonthRange(2026, 9)).toEqual({
      startDate: '2026-09-01',
      endDate: '2026-09-30',
    });
  });
});
