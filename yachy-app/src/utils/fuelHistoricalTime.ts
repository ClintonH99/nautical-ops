export interface PreserveUnknownReceiptTimeInput {
  historicalTimeUnknown: boolean;
  offsetConfirmed: boolean;
  legacyAllocationRequired: boolean;
  hasPositiveAllocation: boolean;
  localDateTimeUnchanged: boolean;
}

/**
 * A genuinely unallocated pre-ledger receipt may retain unknown ship-time
 * evidence only while the event itself remains untouched. Metadata such as a
 * supplier note or price can still be corrected without fabricating a zone.
 */
export function canPreserveUnknownReceiptTime(input: PreserveUnknownReceiptTimeInput): boolean {
  return (
    input.historicalTimeUnknown &&
    !input.offsetConfirmed &&
    input.legacyAllocationRequired &&
    !input.hasPositiveAllocation &&
    input.localDateTimeUnchanged
  );
}

export function needsHistoricalOffsetConfirmation(
  historicalTimeUnknown: boolean,
  offsetConfirmed: boolean,
  preservingUnknownTime = false
): boolean {
  return historicalTimeUnknown && !offsetConfirmed && !preservingUnknownTime;
}
