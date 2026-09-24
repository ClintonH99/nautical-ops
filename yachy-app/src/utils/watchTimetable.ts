export interface WatchRotationPlan {
  slotCount: number;
  watchDurationHours: number;
  minimumWatchDurationHours: number | null;
  hasEnoughCrew: boolean;
  requiredCrewCount: number;
}

export interface PublishedWatchDurations {
  watchDurationHours: number | null;
  restDurationHours: number | null;
}

/**
 * Plan a round-robin rotation for one continuously staffed watch.
 *
 * When rest is provided, a crew member rests while every other selected crew
 * member completes their watch. The minimum watch length is therefore
 * rest / (crew - 1). An optional maximum duration acts as the regular watch
 * length. If neither optional value is provided, the voyage is divided evenly
 * across the selected crew. Watches are never resized to divide the voyage
 * evenly when a duration is supplied; only the final watch may be shorter.
 */
export function calculateWatchRotationPlan(
  totalRunningHours: number,
  restHours: number | null,
  crewCount: number,
  maximumWatchHours?: number | null
): WatchRotationPlan {
  if (!Number.isFinite(totalRunningHours) || totalRunningHours <= 0) {
    throw new Error('Total running time must be greater than zero.');
  }
  if (restHours !== null && (!Number.isFinite(restHours) || restHours <= 0)) {
    throw new Error('Hours of rest must be greater than zero.');
  }
  if (!Number.isInteger(crewCount) || crewCount <= 0) {
    throw new Error('At least one crew member is required.');
  }
  if (
    maximumWatchHours !== undefined &&
    maximumWatchHours !== null &&
    (!Number.isFinite(maximumWatchHours) || maximumWatchHours <= 0)
  ) {
    throw new Error('Maximum watch duration must be greater than zero.');
  }

  const minimumWatchDurationHours =
    restHours === null ? null : crewCount > 1 ? restHours / (crewCount - 1) : restHours;
  const watchDurationHours =
    maximumWatchHours ?? minimumWatchDurationHours ?? totalRunningHours / crewCount;
  const requiredCrewCount =
    restHours === null ? 1 : Math.ceil(restHours / watchDurationHours - 1e-9) + 1;
  const hasEnoughCrew = restHours === null || (crewCount > 1 && crewCount >= requiredCrewCount);

  const slotCount = getWatchSlotDurations(totalRunningHours, watchDurationHours).length;

  return {
    slotCount,
    watchDurationHours,
    minimumWatchDurationHours,
    hasEnoughCrew,
    requiredCrewCount,
  };
}

export function getWatchSlotDurations(
  totalRunningHours: number,
  watchDurationHours: number
): number[] {
  if (!Number.isFinite(totalRunningHours) || totalRunningHours <= 0) {
    throw new Error('Total running time must be greater than zero.');
  }
  if (!Number.isFinite(watchDurationHours) || watchDurationHours <= 0) {
    throw new Error('Watch duration must be greater than zero.');
  }

  const durations: number[] = [];
  let scheduledHours = 0;

  while (scheduledHours < totalRunningHours - 1e-9) {
    const remainingHours = totalRunningHours - scheduledHours;
    const duration = Math.min(watchDurationHours, remainingHours);
    durations.push(duration);
    scheduledHours += duration;
  }

  return durations;
}

/**
 * Summarise the repeating round-robin pattern stored in a published schedule.
 * The longest slot is the normal watch duration because only the final slot may
 * be shorter. Each crew member rests while the other selected crew members take
 * their watches.
 */
export function getPublishedWatchDurations(
  slots: ReadonlyArray<{ crewId: string; durationHours: number }>
): PublishedWatchDurations {
  const validSlots = slots.filter(
    (slot) => Number.isFinite(slot.durationHours) && slot.durationHours > 0
  );
  if (validSlots.length === 0) {
    return { watchDurationHours: null, restDurationHours: null };
  }

  const watchDurationHours = Math.max(...validSlots.map((slot) => slot.durationHours));
  const crewCount = new Set(validSlots.map((slot) => slot.crewId)).size;
  const restDurationHours = watchDurationHours * Math.max(crewCount - 1, 0);

  return { watchDurationHours, restDurationHours };
}

export function formatWatchHours(hours: number): string {
  return String(Math.round(hours * 100) / 100);
}
