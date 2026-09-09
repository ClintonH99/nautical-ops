jest.mock('../../src/services/supabase', () => ({ supabase: {} }));

import vesselTasksService from '../../src/services/vesselTasks';
import { VesselTask } from '../../src/types';

const baseTask: VesselTask = {
  id: 'task-1',
  vesselId: 'vessel-1',
  category: 'WEEKLY',
  department: 'BRIDGE',
  title: 'Vacuum',
  notes: '',
  doneByDate: '2026-09-05',
  status: 'NOT_STARTED',
  recurring: '7_DAYS',
  createdAt: '2026-09-01T12:00:00.000Z',
  updatedAt: '2026-09-01T12:00:00.000Z',
};

describe('vessel task completion', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-09-04T12:00:00.000Z'));
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('reschedules a recurring task from its completion date', async () => {
    jest.spyOn(vesselTasksService, 'getById').mockResolvedValue(baseTask);
    const update = jest.spyOn(vesselTasksService, 'update').mockResolvedValue();

    await vesselTasksService.markComplete('task-1', 'user-1', 'Captain');

    expect(update).toHaveBeenCalledWith('task-1', {
      status: 'NOT_STARTED',
      doneByDate: '2026-09-11',
      recurring: '7_DAYS',
      completedBy: null,
      completedAt: null,
      completedByName: null,
    });
  });

  it('moves a Daily one-off task to completed tasks', async () => {
    jest.spyOn(vesselTasksService, 'getById').mockResolvedValue({
      ...baseTask,
      category: 'DAILY',
      recurring: null,
    });
    const update = jest.spyOn(vesselTasksService, 'update').mockResolvedValue();

    await vesselTasksService.markComplete('task-1', 'user-1', 'Captain');

    expect(update).toHaveBeenCalledWith(
      'task-1',
      expect.objectContaining({
        status: 'COMPLETED',
        completedBy: 'user-1',
        completedByName: 'Captain',
      })
    );
  });
});
