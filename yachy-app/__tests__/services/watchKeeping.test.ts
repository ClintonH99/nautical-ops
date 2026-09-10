jest.mock('../../src/services/supabase', () => ({ supabase: {} }));

import {
  getRestWatchConflicts,
  getWatchDateTime,
  getWatchPeriodsFromTimetables,
  PublishedWatchTimetable,
} from '../../src/services/watchKeeping';

const overnightTimetable: PublishedWatchTimetable = {
  id: 'watch-1',
  vesselId: 'vessel-1',
  watchTitle: 'Delivery Watch',
  startTime: '22:00',
  forDate: '2026-04-03',
  createdAt: '2026-04-03T12:00:00.000Z',
  slots: [
    {
      crewId: 'rachel',
      crewName: 'Rachel',
      startTimeStr: '22:00',
      endTimeStr: '02:00',
      durationHours: 4,
      startDate: '2026-04-03',
      endDate: '2026-04-04',
    },
  ],
};

describe('Watch Keeping and Hours of Rest integration', () => {
  it('assigns exact dates when a voyage runs through midnight', () => {
    expect(getWatchDateTime('2026-04-03', '22:00', 4)).toEqual({
      date: '2026-04-04',
      time: '02:00',
    });
  });

  it('splits an overnight watch across the two correct rest-entry dates', () => {
    expect(
      getWatchPeriodsFromTimetables([overnightTimetable], 'rachel', '2026-04-03', '2026-04-04')
    ).toEqual([
      {
        timetableId: 'watch-1',
        watchTitle: 'Delivery Watch',
        date: '2026-04-03',
        startTime: '22:00',
        endTime: '24:00',
      },
      {
        timetableId: 'watch-1',
        watchTitle: 'Delivery Watch',
        date: '2026-04-04',
        startTime: '00:00',
        endTime: '02:00',
      },
    ]);
  });

  it('only imports periods belonging to the selected crew member', () => {
    expect(
      getWatchPeriodsFromTimetables([overnightTimetable], 'john', '2026-04-03', '2026-04-04')
    ).toEqual([]);
  });

  it('detects a rest period that contradicts an imported watch', () => {
    const periods = getWatchPeriodsFromTimetables(
      [overnightTimetable],
      'rachel',
      '2026-04-03',
      '2026-04-03'
    );

    expect(getRestWatchConflicts([{ start: '21:00', end: '23:00' }], periods)).toEqual(periods);
    expect(getRestWatchConflicts([{ start: '18:00', end: '21:00' }], periods)).toEqual([]);
  });

  it('supports older dated schedules by inferring dates from ordered slots', () => {
    const legacy: PublishedWatchTimetable = {
      ...overnightTimetable,
      slots: [
        {
          crewId: 'rachel',
          crewName: 'Rachel',
          startTimeStr: '22:00',
          endTimeStr: '02:00',
          durationHours: 4,
        },
        {
          crewId: 'john',
          crewName: 'John',
          startTimeStr: '02:00',
          endTimeStr: '06:00',
          durationHours: 4,
        },
      ],
    };

    expect(getWatchPeriodsFromTimetables([legacy], 'john', '2026-04-04', '2026-04-04')).toEqual([
      {
        timetableId: 'watch-1',
        watchTitle: 'Delivery Watch',
        date: '2026-04-04',
        startTime: '02:00',
        endTime: '06:00',
      },
    ]);
  });
});
