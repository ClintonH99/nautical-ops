jest.mock('../../src/services/supabase', () => ({ supabase: {} }));

import { mapRowToYardJob, validateYardJobDateRange } from '../../src/services/yardJobs';

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
