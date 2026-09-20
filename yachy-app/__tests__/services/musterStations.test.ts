/** @jest-environment node */

jest.mock('../../src/services/supabase', () => ({
  supabase: {
    from: jest.fn(),
  },
}));

import { getMusterStationLocations } from '../../src/services/musterStations';

describe('getMusterStationLocations', () => {
  it('trims, filters, and preserves the order of the canonical location array', () => {
    expect(
      getMusterStationLocations({
        musterStationLocations: ['  Main Deck  ', '', '  ', 'Boat Deck', 'Port Quarter  '],
      })
    ).toEqual(['Main Deck', 'Boat Deck', 'Port Quarter']);
  });

  it('falls back to the trimmed legacy scalar location', () => {
    expect(getMusterStationLocations({ musterStation: '  Main Saloon  ' })).toEqual([
      'Main Saloon',
    ]);
  });

  it('prefers the canonical location array over the legacy scalar', () => {
    expect(
      getMusterStationLocations({
        musterStation: 'Legacy Location',
        musterStationLocations: ['Primary Location', 'Secondary Location'],
      })
    ).toEqual(['Primary Location', 'Secondary Location']);
  });

  it('returns an empty array for empty or malformed runtime data without throwing', () => {
    expect(getMusterStationLocations(null)).toEqual([]);
    expect(getMusterStationLocations({})).toEqual([]);
    expect(getMusterStationLocations(undefined as any)).toEqual([]);
    expect(
      getMusterStationLocations({
        musterStation: 42,
        musterStationLocations: 'not-an-array',
      } as any)
    ).toEqual([]);
  });

  it('ignores malformed array entries while retaining valid string locations', () => {
    expect(
      getMusterStationLocations({
        musterStationLocations: [null, 7, {}, '  Starboard Deck  ', undefined, ''],
      } as any)
    ).toEqual(['Starboard Deck']);
  });
});
