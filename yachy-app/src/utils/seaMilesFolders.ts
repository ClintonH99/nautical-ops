import type { SeaMileEntry } from '../types';

export const ALL_SEA_MILES = 'ALL';
export const UNFILED_SEA_MILES = 'UNFILED';
export type SeaMileFolderFilter = typeof ALL_SEA_MILES | typeof UNFILED_SEA_MILES | string;

export function filterSeaMileEntries(
  entries: SeaMileEntry[],
  folderAssignments: Record<string, string>,
  selectedFolderId: SeaMileFolderFilter,
  searchQuery: string
): SeaMileEntry[] {
  const query = searchQuery.trim().toLocaleLowerCase();

  return entries.filter((entry) => {
    const assignedFolderId = folderAssignments[entry.id];
    const matchesFolder =
      selectedFolderId === ALL_SEA_MILES ||
      (selectedFolderId === UNFILED_SEA_MILES
        ? !assignedFolderId
        : assignedFolderId === selectedFolderId);

    if (!matchesFolder) return false;
    if (!query) return true;

    return [entry.vesselName, entry.fromLocation, entry.toLocation].some((value) =>
      value.toLocaleLowerCase().includes(query)
    );
  });
}
