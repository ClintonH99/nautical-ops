/** Crew Leave service tests @jest-environment node */

const mockGetUser = jest.fn();
const mockInvoke = jest.fn();
const mockFrom = jest.fn();

jest.mock('../../src/services/supabase', () => ({
  supabase: {
    auth: { getUser: (...args: unknown[]) => mockGetUser(...args) },
    functions: { invoke: (...args: unknown[]) => mockInvoke(...args) },
    from: (...args: unknown[]) => mockFrom(...args),
  },
}));

import crewLeaveService from '../../src/services/crewLeave';

const databaseRow = {
  id: 'leave-1',
  vessel_id: 'vessel-1',
  crew_member_id: 'crew-1',
  leave_type: 'ANNUAL',
  start_date: '2026-09-14',
  end_date: '2026-09-21',
  notes: 'Family holiday',
  created_by: 'captain-1',
  created_at: '2026-09-10T12:00:00Z',
  updated_at: '2026-09-10T12:00:00Z',
  crew_member: {
    id: 'crew-1',
    name: 'Rachel Adams',
    position: 'Chief Stewardess',
    department: 'INTERIOR',
  },
};

describe('CrewLeaveService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetUser.mockResolvedValue({ data: { user: { id: 'captain-1' } } });
    mockInvoke.mockResolvedValue({ data: { sent: 1 }, error: null });
  });

  it('publishes leave for the selected crew member and requests their notification', async () => {
    const single = jest.fn().mockResolvedValue({ data: databaseRow, error: null });
    const select = jest.fn().mockReturnValue({ single });
    const insert = jest.fn().mockReturnValue({ select });
    mockFrom.mockReturnValue({ insert });

    const created = await crewLeaveService.create({
      vesselId: 'vessel-1',
      crewMemberId: 'crew-1',
      leaveType: 'ANNUAL',
      startDate: '2026-09-14',
      endDate: '2026-09-21',
      notes: ' Family holiday ',
    });

    expect(mockFrom).toHaveBeenCalledWith('crew_leave');
    expect(insert).toHaveBeenCalledWith({
      vessel_id: 'vessel-1',
      crew_member_id: 'crew-1',
      leave_type: 'ANNUAL',
      start_date: '2026-09-14',
      end_date: '2026-09-21',
      notes: 'Family holiday',
      created_by: 'captain-1',
    });
    expect(created.crewMemberName).toBe('Rachel Adams');
    expect(mockInvoke).toHaveBeenCalledWith('send-trip-push', {
      body: { type: 'crew_leave', crewLeaveId: 'leave-1', event: 'created' },
    });
  });

  it('rejects publishing leave without an authenticated manager', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });

    await expect(
      crewLeaveService.create({
        vesselId: 'vessel-1',
        crewMemberId: 'crew-1',
        leaveType: 'SICK',
        startDate: '2026-09-14',
        endDate: '2026-09-14',
      })
    ).rejects.toThrow('signed in');
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('does not report success when an update affects no permitted record', async () => {
    const select = jest.fn().mockResolvedValue({ data: [], error: null });
    const eq = jest.fn().mockReturnValue({ select });
    const update = jest.fn().mockReturnValue({ eq });
    mockFrom.mockReturnValue({ update });

    await expect(crewLeaveService.update('missing-leave', { leaveType: 'OTHER' })).rejects.toThrow(
      'record was not found or access was denied'
    );
    expect(mockInvoke).not.toHaveBeenCalled();
  });
});
