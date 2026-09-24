import {
  calculateWatchRotationPlan,
  formatWatchHours,
  getPublishedWatchDurations,
  getWatchSlotDurations,
} from '../../src/utils/watchTimetable';

describe('watch timetable rotation planning', () => {
  it('calculates the watch duration from rest when no maximum is entered', () => {
    expect(calculateWatchRotationPlan(36, 8, 2)).toEqual({
      slotCount: 5,
      watchDurationHours: 8,
      minimumWatchDurationHours: 8,
      hasEnoughCrew: true,
      requiredCrewCount: 2,
    });
  });

  it('flags when the maximum watch duration cannot provide the required rest', () => {
    expect(calculateWatchRotationPlan(36, 8, 2, 4)).toEqual({
      slotCount: 9,
      watchDurationHours: 4,
      minimumWatchDurationHours: 8,
      hasEnoughCrew: false,
      requiredCrewCount: 3,
    });
  });

  it('accepts the same maximum when enough crew are selected', () => {
    expect(calculateWatchRotationPlan(36, 8, 3, 4)).toEqual({
      slotCount: 9,
      watchDurationHours: 4,
      minimumWatchDurationHours: 4,
      hasEnoughCrew: true,
      requiredCrewCount: 3,
    });
  });

  it('skips rest enforcement when hours of rest are not provided', () => {
    expect(calculateWatchRotationPlan(13, null, 2, 4)).toEqual({
      slotCount: 4,
      watchDurationHours: 4,
      minimumWatchDurationHours: null,
      hasEnoughCrew: true,
      requiredCrewCount: 1,
    });
  });

  it('divides the running time evenly when both optional fields are blank', () => {
    expect(calculateWatchRotationPlan(12, null, 3)).toEqual({
      slotCount: 3,
      watchDurationHours: 4,
      minimumWatchDurationHours: null,
      hasEnoughCrew: true,
      requiredCrewCount: 1,
    });
  });

  it('keeps full watches and leaves only the final watch shorter', () => {
    expect(getWatchSlotDurations(13, 4)).toEqual([4, 4, 4, 1]);
  });

  it('summarises watch and rest durations from published round-robin slots', () => {
    expect(
      getPublishedWatchDurations([
        { crewId: 'a', durationHours: 4 },
        { crewId: 'b', durationHours: 4 },
        { crewId: 'c', durationHours: 4 },
        { crewId: 'a', durationHours: 1 },
      ])
    ).toEqual({ watchDurationHours: 4, restDurationHours: 8 });
  });

  it('returns empty published durations when a schedule has no valid slots', () => {
    expect(getPublishedWatchDurations([])).toEqual({
      watchDurationHours: null,
      restDurationHours: null,
    });
  });

  it('rejects an invalid watch duration instead of attempting to build slots', () => {
    expect(() => getWatchSlotDurations(13, 0)).toThrow('Watch duration must be greater than zero.');
  });

  it('formats fractional watch lengths without floating point noise', () => {
    expect(formatWatchHours(8 / 3)).toBe('2.67');
  });
});
