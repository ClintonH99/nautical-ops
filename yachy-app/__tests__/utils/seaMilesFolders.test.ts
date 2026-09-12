import type { SeaMileEntry } from '../../src/types';
import {
  ALL_SEA_MILES,
  filterSeaMileEntries,
  UNFILED_SEA_MILES,
} from '../../src/utils/seaMilesFolders';

function entry(
  id: string,
  vesselName: string,
  fromLocation: string,
  toLocation: string
): SeaMileEntry {
  return {
    id,
    userId: 'crew-1',
    reviewVesselId: null,
    voyageDate: '2026-09-11',
    vesselName,
    vesselLength: '138 ft',
    fromLocation,
    toLocation,
    capacityRole: 'Deckhand',
    milesLogged: 100,
    dayHours: 8,
    nightHours: 4,
    tidal: false,
    status: 'DRAFT',
    declineComment: null,
    submittedAt: null,
    reviewedBy: null,
    reviewerName: null,
    reviewerSignatureType: null,
    reviewerSignatureImage: null,
    reviewerTypedName: null,
    reviewerContactFirstName: null,
    reviewerContactLastName: null,
    reviewerContactCellNumber: null,
    reviewerContactEmailAddress: null,
    reviewedAt: null,
    createdAt: '2026-09-11T12:00:00Z',
    updatedAt: '2026-09-11T12:00:00Z',
  };
}

const entries = [
  entry('entry-1', 'M/Y Aurora', 'Fort Lauderdale', 'Nassau'),
  entry('entry-2', 'S/Y Freedom', 'New York', 'Newport'),
  entry('entry-3', 'M/Y Horizon', 'Miami', 'Key West'),
];
const assignments = { 'entry-1': 'folder-1', 'entry-2': 'folder-2' };

describe('filterSeaMileEntries', () => {
  it('keeps the current complete list in All Sea Miles', () => {
    expect(filterSeaMileEntries(entries, assignments, ALL_SEA_MILES, '')).toHaveLength(3);
  });

  it('shows only records without a folder in Unfiled', () => {
    expect(filterSeaMileEntries(entries, assignments, UNFILED_SEA_MILES, '')).toEqual([entries[2]]);
  });

  it('shows only records in the selected custom folder', () => {
    expect(filterSeaMileEntries(entries, assignments, 'folder-1', '')).toEqual([entries[0]]);
  });

  it.each([
    ['aurora', 'entry-1'],
    ['FORT', 'entry-1'],
    ['newport', 'entry-2'],
  ])('searches vessel, departure, and destination using %s', (query, expectedId) => {
    expect(
      filterSeaMileEntries(entries, assignments, ALL_SEA_MILES, query).map((item) => item.id)
    ).toEqual([expectedId]);
  });
});
