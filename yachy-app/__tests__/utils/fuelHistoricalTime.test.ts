import {
  canPreserveUnknownReceiptTime,
  needsHistoricalOffsetConfirmation,
} from '../../src/utils/fuelHistoricalTime';

describe('historical fuel event time decisions', () => {
  const unknownUnallocatedReceipt = {
    historicalTimeUnknown: true,
    offsetConfirmed: false,
    legacyAllocationRequired: true,
    hasPositiveAllocation: false,
    localDateTimeUnchanged: true,
  };

  it('preserves unknown evidence for an unchanged unallocated metadata-only receipt', () => {
    expect(canPreserveUnknownReceiptTime(unknownUnallocatedReceipt)).toBe(true);
    expect(needsHistoricalOffsetConfirmation(true, false, true)).toBe(false);
  });

  it.each([
    ['the local date or time changes', { localDateTimeUnchanged: false }],
    ['a tank allocation is added', { hasPositiveAllocation: true }],
    ['the historical receipt already has allocations', { legacyAllocationRequired: false }],
  ])('requires confirmation when %s', (_label, change) => {
    const preserving = canPreserveUnknownReceiptTime({
      ...unknownUnallocatedReceipt,
      ...change,
    });
    expect(preserving).toBe(false);
    expect(needsHistoricalOffsetConfirmation(true, false, preserving)).toBe(true);
  });

  it('uses the normal path after an explicit offset confirmation', () => {
    expect(
      canPreserveUnknownReceiptTime({
        ...unknownUnallocatedReceipt,
        offsetConfirmed: true,
      })
    ).toBe(false);
    expect(needsHistoricalOffsetConfirmation(true, true)).toBe(false);
  });

  it('never blocks a record that already has complete event evidence', () => {
    expect(needsHistoricalOffsetConfirmation(false, false)).toBe(false);
  });
});
