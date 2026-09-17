import type { Department, YardPeriodJob } from '../../src/types';
import {
  ALL_SHIPYARD_RECORDS,
  countShipyardRecords,
  filterShipyardRecords,
  getActiveYardJobs,
  UNFILED_SHIPYARD_RECORDS,
} from '../../src/utils/shipyardRecords';

const allDepartments: Record<Department, boolean> = {
  BRIDGE: true,
  ENGINEERING: true,
  EXTERIOR: true,
  INTERIOR: true,
  GALLEY: true,
};

const jobs: YardPeriodJob[] = [
  {
    id: 'completed-engineering',
    vesselId: 'vessel-1',
    jobTitle: 'Service port generator',
    jobDescription: 'Replace filters',
    defectDetails: 'Low oil pressure',
    defectLocation: 'Engine room',
    equipmentSerial: 'GEN-42',
    department: 'ENGINEERING',
    priority: 'RED',
    yardLocation: 'Rybovich',
    contractorCompanyName: 'Marine Power',
    contactDetails: '',
    startDate: '2026-09-01',
    endDate: '2026-09-03',
    doneByDate: null,
    status: 'COMPLETED',
    completedByName: 'Alex Crew',
    createdAt: '2026-09-01T10:00:00.000Z',
    updatedAt: '2026-09-03T10:00:00.000Z',
  },
  {
    id: 'completed-interior',
    vesselId: 'vessel-1',
    jobTitle: 'Repair guest blind',
    jobDescription: 'Starboard guest cabin',
    defectDetails: '',
    defectLocation: 'Guest cabin',
    equipmentSerial: '',
    department: 'INTERIOR',
    priority: 'GREEN',
    yardLocation: 'Derecktor',
    contractorCompanyName: '',
    contactDetails: '',
    startDate: '2026-09-02',
    endDate: '2026-09-02',
    doneByDate: null,
    status: 'COMPLETED',
    createdAt: '2026-09-02T10:00:00.000Z',
    updatedAt: '2026-09-02T12:00:00.000Z',
  },
  {
    id: 'active-job',
    vesselId: 'vessel-1',
    jobTitle: 'Active work',
    jobDescription: '',
    defectDetails: '',
    defectLocation: '',
    equipmentSerial: '',
    department: 'ENGINEERING',
    priority: 'YELLOW',
    yardLocation: '',
    contractorCompanyName: '',
    contactDetails: '',
    startDate: '2026-09-04',
    endDate: '2026-09-05',
    doneByDate: null,
    status: 'NOT_STARTED',
    createdAt: '2026-09-03T10:00:00.000Z',
    updatedAt: '2026-09-03T10:00:00.000Z',
  },
];

describe('Shipyard Records filtering', () => {
  it('keeps completed records out of active calendar jobs', () => {
    expect(getActiveYardJobs(jobs).map((job) => job.id)).toEqual(['active-job']);
  });

  it('counts records in vessel-wide folders without counting active jobs', () => {
    expect(
      countShipyardRecords(jobs, {
        'completed-engineering': 'refit-2026',
        'completed-interior': 'refit-2026',
        'active-job': 'refit-2026',
      })
    ).toEqual({
      all: 2,
      unfiled: 0,
      byFolder: { 'refit-2026': 2 },
    });
  });

  it('counts completed records without an explicit assignment as unfiled', () => {
    expect(countShipyardRecords(jobs, {})).toEqual({
      all: 2,
      unfiled: 2,
      byFolder: {},
    });
  });

  it('shows only completed jobs in All Records', () => {
    expect(
      filterShipyardRecords(jobs, {}, allDepartments, ALL_SHIPYARD_RECORDS, '').map((job) => job.id)
    ).toEqual(['completed-engineering', 'completed-interior']);
  });

  it('shows only records without a folder in Unfiled', () => {
    expect(
      filterShipyardRecords(
        jobs,
        { 'completed-engineering': 'folder-1' },
        allDepartments,
        UNFILED_SHIPYARD_RECORDS,
        ''
      ).map((job) => job.id)
    ).toEqual(['completed-interior']);
  });

  it('filters by a selected folder and department', () => {
    expect(
      filterShipyardRecords(
        jobs,
        { 'completed-engineering': 'folder-1', 'completed-interior': 'folder-1' },
        { ...allDepartments, INTERIOR: false },
        'folder-1',
        ''
      ).map((job) => job.id)
    ).toEqual(['completed-engineering']);
  });

  it.each(['generator', 'oil pressure', 'engine room', 'gen-42', 'rybovich', 'marine power'])(
    'searches all useful record fields for %s',
    (query) => {
      expect(
        filterShipyardRecords(jobs, {}, allDepartments, ALL_SHIPYARD_RECORDS, query).map(
          (job) => job.id
        )
      ).toEqual(['completed-engineering']);
    }
  );
});
