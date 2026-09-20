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
  crew_member_name_snapshot: 'Rachel Adams',
  crew_member_position_snapshot: 'Chief Stewardess',
  crew_member_departments_snapshot: ['INTERIOR', 'EXTERIOR'],
  crew_member: {
    id: 'crew-1',
    name: 'Rachel Current Name',
    position: 'Purser',
    department: 'BRIDGE',
    department_2: null,
  },
};

type QueryMethod = jest.Mock<MockQueryBuilder, unknown[]>;
interface MockQueryBuilder {
  data: Array<Record<string, unknown>>;
  error: unknown;
  select: QueryMethod;
  eq: QueryMethod;
  overlaps: QueryMethod;
  gte: QueryMethod;
  lte: QueryMethod;
  gt: QueryMethod;
  lt: QueryMethod;
  order: QueryMethod;
  range: QueryMethod;
}

function createQueryBuilder(data: Array<Record<string, unknown>> = [databaseRow]) {
  const builder = { data, error: null } as MockQueryBuilder;
  const methods: Array<keyof Omit<MockQueryBuilder, 'data' | 'error'>> = [
    'select',
    'eq',
    'overlaps',
    'gte',
    'lte',
    'gt',
    'lt',
    'order',
    'range',
  ];
  for (const method of methods) {
    builder[method] = jest.fn(() => builder);
  }
  return builder;
}

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
    expect(created.crewMemberPosition).toBe('Chief Stewardess');
    expect(created.crewMemberDepartments).toEqual(['INTERIOR', 'EXTERIOR']);
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

  it('combines current-status, leave-type and dual-department filters on the server', async () => {
    const builder = createQueryBuilder();
    mockFrom.mockReturnValue(builder);

    const page = await crewLeaveService.getPage(
      'vessel-1',
      {
        status: 'CURRENT',
        leaveType: 'SICK',
        departments: ['EXTERIOR'],
        asOfDate: '2026-09-21',
      },
      0,
      40
    );

    expect(builder.eq).toHaveBeenCalledWith('vessel_id', 'vessel-1');
    expect(builder.eq).toHaveBeenCalledWith('leave_type', 'SICK');
    expect(builder.overlaps).toHaveBeenCalledWith('crew_member_departments_snapshot', ['EXTERIOR']);
    expect(builder.lte).toHaveBeenCalledWith('start_date', '2026-09-21');
    expect(builder.gte).toHaveBeenCalledWith('end_date', '2026-09-21');
    expect(builder.range).toHaveBeenCalledWith(0, 40);
    expect(page.items[0].crewMemberDepartments).toEqual(['INTERIOR', 'EXTERIOR']);
    expect(page.hasMore).toBe(false);
  });

  it('keeps department filtering working while the snapshot migration is rolling out', async () => {
    const missingSnapshotQuery = createQueryBuilder([]);
    missingSnapshotQuery.error = {
      code: '42703',
      message: 'column crew_member_departments_snapshot does not exist',
    };
    const legacyQuery = createQueryBuilder([
      {
        ...databaseRow,
        crew_member_departments_snapshot: undefined,
        crew_member: {
          ...databaseRow.crew_member,
          department: 'INTERIOR',
          department_2: 'EXTERIOR',
        },
      },
    ]);
    mockFrom.mockReturnValueOnce(missingSnapshotQuery).mockReturnValueOnce(legacyQuery);

    const page = await crewLeaveService.getPage('vessel-1', {
      status: 'ACTIVE',
      departments: ['EXTERIOR'],
      asOfDate: '2026-09-21',
    });

    expect(mockFrom).toHaveBeenCalledTimes(2);
    expect(legacyQuery.overlaps).not.toHaveBeenCalled();
    expect(page.items.map((item) => item.crewMemberName)).toEqual(['Rachel Adams']);
  });

  it.each([
    ['ACTIVE', 'gte', 'end_date'],
    ['UPCOMING', 'gt', 'start_date'],
    ['COMPLETED', 'lt', 'end_date'],
  ] as const)('uses the correct %s date predicate', async (status, method, column) => {
    const builder = createQueryBuilder();
    mockFrom.mockReturnValue(builder);

    await crewLeaveService.getPage('vessel-1', { status, asOfDate: '2026-09-21' });

    expect(builder[method]).toHaveBeenCalledWith(column, '2026-09-21');
  });

  it('clamps oversized pages and fetches one extra row to detect more history', async () => {
    const rows = Array.from({ length: 51 }, (_, index) => ({
      ...databaseRow,
      id: `leave-${String(index).padStart(2, '0')}`,
    }));
    const builder = createQueryBuilder(rows);
    mockFrom.mockReturnValue(builder);

    const page = await crewLeaveService.getPage(
      'vessel-1',
      { status: 'COMPLETED', asOfDate: '2026-09-21' },
      5,
      500
    );

    expect(builder.range).toHaveBeenCalledWith(5, 55);
    expect(page.items).toHaveLength(50);
    expect(page.hasMore).toBe(true);
  });

  it('loads only records overlapping the visible calendar range', async () => {
    const builder = createQueryBuilder([
      {
        id: 'leave-1',
        leave_type: 'ANNUAL',
        start_date: '2026-09-20',
        end_date: '2026-10-02',
      },
    ]);
    mockFrom.mockReturnValue(builder);

    const entries = await crewLeaveService.getCalendarInRange(
      'vessel-1',
      '2026-09-01',
      '2026-09-30'
    );

    expect(builder.lte).toHaveBeenCalledWith('start_date', '2026-09-30');
    expect(builder.gte).toHaveBeenCalledWith('end_date', '2026-09-01');
    expect(entries).toEqual([
      {
        id: 'leave-1',
        leaveType: 'ANNUAL',
        startDate: '2026-09-20',
        endDate: '2026-10-02',
      },
    ]);
  });
});
