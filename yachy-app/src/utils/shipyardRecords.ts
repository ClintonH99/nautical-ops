import type { Department, YardPeriodJob } from '../types';

export const ALL_SHIPYARD_RECORDS = 'ALL';
export const UNFILED_SHIPYARD_RECORDS = 'UNFILED';

export type ShipyardRecordFolderFilter =
  | typeof ALL_SHIPYARD_RECORDS
  | typeof UNFILED_SHIPYARD_RECORDS
  | string;

export interface ShipyardRecordCounts {
  all: number;
  unfiled: number;
  byFolder: Record<string, number>;
}

export function getActiveYardJobs(jobs: YardPeriodJob[]): YardPeriodJob[] {
  return jobs.filter((job) => job.status !== 'COMPLETED');
}

export function countShipyardRecords(
  jobs: YardPeriodJob[],
  assignments: Record<string, string>
): ShipyardRecordCounts {
  const counts: ShipyardRecordCounts = { all: 0, unfiled: 0, byFolder: {} };

  jobs.forEach((job) => {
    if (job.status !== 'COMPLETED') return;

    counts.all += 1;
    const folderId = assignments[job.id];
    if (!folderId) {
      counts.unfiled += 1;
      return;
    }
    counts.byFolder[folderId] = (counts.byFolder[folderId] ?? 0) + 1;
  });

  return counts;
}

export function filterShipyardRecords(
  jobs: YardPeriodJob[],
  assignments: Record<string, string>,
  visibleDepartments: Record<Department, boolean>,
  selectedFolderId: ShipyardRecordFolderFilter,
  searchQuery: string
): YardPeriodJob[] {
  const query = searchQuery.trim().toLocaleLowerCase();

  return jobs.filter((job) => {
    if (job.status !== 'COMPLETED') return false;
    if (!visibleDepartments[job.department ?? 'INTERIOR']) return false;

    const assignedFolderId = assignments[job.id];
    const matchesFolder =
      selectedFolderId === ALL_SHIPYARD_RECORDS ||
      (selectedFolderId === UNFILED_SHIPYARD_RECORDS
        ? !assignedFolderId
        : assignedFolderId === selectedFolderId);
    if (!matchesFolder) return false;
    if (!query) return true;

    return [
      job.jobTitle,
      job.jobDescription,
      job.defectDetails,
      job.defectLocation,
      job.equipmentSerial,
      job.yardLocation,
      job.contractorCompanyName,
      job.contactDetails,
      job.completedByName,
    ].some((value) => value?.toLocaleLowerCase().includes(query));
  });
}
