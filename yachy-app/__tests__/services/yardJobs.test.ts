jest.mock('../../src/services/supabase', () => ({
  supabase: {
    rpc: jest.fn(),
    from: jest.fn(),
    auth: { getUser: jest.fn() },
  },
}));

import { supabase } from '../../src/services/supabase';
import yardJobsService, {
  mapRowToYardJob,
  validateYardJobDateRange,
} from '../../src/services/yardJobs';

const mockRpc = supabase.rpc as jest.Mock;
const mockFrom = supabase.from as jest.Mock;
const mockGetUser = supabase.auth.getUser as jest.Mock;

describe('Shipyard job date ranges', () => {
  it('uses the saved start and end dates', () => {
    const job = mapRowToYardJob({
      id: 'job-1',
      vessel_id: 'vessel-1',
      job_title: 'Hull paint',
      department: 'EXTERIOR',
      priority: 'GREEN',
      status: 'NOT_STARTED',
      start_date: '2026-09-10',
      end_date: '2026-09-24',
      done_by_date: '2026-09-12',
    });

    expect(job.startDate).toBe('2026-09-10');
    expect(job.endDate).toBe('2026-09-24');
  });

  it('keeps an unmigrated legacy deadline readable as a one-day range', () => {
    const job = mapRowToYardJob({
      id: 'job-1',
      vessel_id: 'vessel-1',
      job_title: 'Legacy job',
      department: 'ENGINEERING',
      priority: 'YELLOW',
      status: 'NOT_STARTED',
      done_by_date: '2026-09-18',
    });

    expect(job.startDate).toBe('2026-09-18');
    expect(job.endDate).toBe('2026-09-18');
  });

  it('rejects an end date before the start date', () => {
    expect(() => validateYardJobDateRange('2026-09-24', '2026-09-10')).toThrow(
      'end date cannot be before'
    );
  });
});

describe('Shipyard jobs loading', () => {
  beforeEach(() => mockFrom.mockReset());

  it('propagates a vessel query error instead of presenting a false empty list', async () => {
    const queryError = new Error('Shipyard records are unavailable');
    const order = jest.fn().mockResolvedValue({ data: null, error: queryError });
    const eq = jest.fn().mockReturnValue({ order });
    const select = jest.fn().mockReturnValue({ eq });
    mockFrom.mockReturnValue({ select });
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      await expect(yardJobsService.getByVessel('vessel-1')).rejects.toBe(queryError);
      expect(consoleError).toHaveBeenCalledWith('Get yard jobs error:', queryError);
    } finally {
      consoleError.mockRestore();
    }
  });
});

describe('Shipyard Record completion reversal', () => {
  beforeEach(() => mockRpc.mockReset());

  it('uses the role-protected database function to return a record to Active Jobs', async () => {
    mockRpc.mockResolvedValue({ data: [{ id: 'job-1' }], error: null });

    await yardJobsService.unmarkComplete('job-1');

    expect(mockRpc).toHaveBeenCalledWith('unmark_yard_job_complete', {
      target_job_id: 'job-1',
    });
  });
});

describe('Shipyard Record folders', () => {
  beforeEach(() => {
    mockFrom.mockReset();
    mockGetUser.mockReset();
  });

  it('creates a vessel-wide folder without assigning it to a department', async () => {
    const savedFolder = {
      id: 'folder-1',
      vessel_id: 'vessel-1',
      name: 'Refit 2026',
      created_by: 'user-1',
      created_at: '2026-09-18T00:00:00.000Z',
      updated_at: '2026-09-18T00:00:00.000Z',
    };
    const single = jest.fn().mockResolvedValue({ data: savedFolder, error: null });
    const select = jest.fn().mockReturnValue({ single });
    const insert = jest.fn().mockReturnValue({ select });
    mockFrom.mockReturnValue({ insert });
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });

    await expect(yardJobsService.createRecordFolder('vessel-1', '  Refit 2026  ')).resolves.toEqual(
      {
        id: 'folder-1',
        vesselId: 'vessel-1',
        name: 'Refit 2026',
        createdBy: 'user-1',
        createdAt: '2026-09-18T00:00:00.000Z',
        updatedAt: '2026-09-18T00:00:00.000Z',
      }
    );
    expect(mockFrom).toHaveBeenCalledWith('shipyard_record_folders');
    expect(insert).toHaveBeenCalledWith({
      vessel_id: 'vessel-1',
      name: 'Refit 2026',
      created_by: 'user-1',
    });
  });
});
