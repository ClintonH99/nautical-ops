/**
 * Core Type Definitions for Nautical Ops
 */

// ===== USER & AUTH TYPES =====

export type UserRole = 'HOD' | 'CREW' | 'MANAGEMENT' | 'CAPTAIN_MOV';

export type ContractType = 'permanent' | 'temporary' | 'rotational';

export interface RotationGroup {
  id: string;
  vesselId: string;
  name: string;
  createdAt: string;
}

export type Department = 'BRIDGE' | 'ENGINEERING' | 'EXTERIOR' | 'INTERIOR' | 'GALLEY';

export type NotificationPreferenceKey =
  | 'tasks'
  | 'trips'
  | 'preDeparture'
  | 'maintenance'
  | 'yardJobs'
  | 'watchSchedule'
  | 'crewLeave';

export interface NotificationPreferences {
  tasks: boolean;
  trips: boolean;
  preDeparture: boolean;
  maintenance: boolean;
  yardJobs: boolean;
  watchSchedule: boolean;
  crewLeave: boolean;
}

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  tasks: true,
  trips: true,
  preDeparture: true,
  maintenance: true,
  yardJobs: true,
  watchSchedule: true,
  crewLeave: true,
};

export interface User {
  id: string;
  email: string;
  name: string;
  position: string;
  department: Department;
  department2?: Department | null; // Optional second department for dual-role crew (e.g. deck/stew)
  role: UserRole;
  contractType?: ContractType;
  rotationGroupId?: string | null;
  vesselId?: string; // Optional - user can join vessel later
  profilePhoto?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Vessel {
  id: string;
  name: string;
  imoNumber?: string;
  managementCompanyId?: string;
  inviteCode: string;
  inviteExpiry: string;
  createdAt: string;
  updatedAt: string;
}

// ===== TASK TYPES =====

export type TaskStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED';

export type TaskPriority = 'GREEN' | 'YELLOW' | 'RED' | 'OVERDUE';

export type TaskTimeframe = '1_DAY' | '3_DAYS' | '1_WEEK' | '2_WEEKS' | '1_MONTH' | 'CUSTOM';

export type TaskCategory = 'DAILY' | 'WEEKLY' | 'MONTHLY';

export type TaskRecurring = '7_DAYS' | '14_DAYS' | '30_DAYS' | null;

export interface VesselTask {
  id: string;
  vesselId: string;
  category: TaskCategory;
  department: Department;
  title: string;
  notes: string;
  doneByDate: string | null;
  status: TaskStatus;
  recurring: TaskRecurring;
  completedBy?: string;
  completedAt?: string;
  completedByName?: string;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  vesselId: string;
  createdBy: string;
  createdByName: string;
  department: Department;
  assignedTo?: string;
  assignedToName?: string;
  timeframe: TaskTimeframe;
  deadline: string;
  status: TaskStatus;
  priority: TaskPriority;
  notes: TaskNote[];
  attachments: Attachment[];
  claimedBy?: string;
  claimedByName?: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TaskNote {
  id: string;
  taskId: string;
  userId: string;
  userName: string;
  content: string;
  createdAt: string;
}

// ===== WATCH DUTIES TYPES =====

export interface WatchDuty {
  id: string;
  vesselId: string;
  department: Department;
  date: string;
  startTime: string;
  endTime: string;
  assignedTo: string;
  assignedToName: string;
  tasks: WatchTask[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface WatchTask {
  id: string;
  watchDutyId: string;
  description: string;
  order: number;
}

// Local-only watch checklist (stored on device)
export interface WatchChecklist {
  watchDutyId: string;
  userId: string;
  date: string;
  checkboxes: { [taskId: string]: boolean };
}

// ===== GENERAL DUTIES TYPES =====

export type DutyFrequency = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'CUSTOM';

export interface DutyCategory {
  id: string;
  name: string;
  frequency: DutyFrequency;
  department: Department;
  vesselId: string;
  order: number;
  createdBy: string;
  createdAt: string;
}

export interface Duty {
  id: string;
  categoryId: string;
  description: string;
  order: number;
  createdAt: string;
}

// ===== TRIPS TYPES =====

export type TripType = 'BOSS' | 'GUEST' | 'DELIVERY' | 'YARD_PERIOD';

export interface Trip {
  id: string;
  vesselId: string;
  type: TripType;
  title: string;
  startDate: string;
  endDate: string;
  department?: Department | null;
  yardLocation?: string | null;
  contractorCompanyName?: string | null;
  contactDetails?: string | null;
  itinerary?: Itinerary[];
  preferences?: TripPreference[];
  specialRequests?: string;
  notes: string;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Itinerary {
  id: string;
  tripId: string;
  date: string;
  location: string;
  activity: string;
  time?: string;
  notes?: string;
  order: number;
}

export interface TripPreference {
  id: string;
  tripId: string;
  category: string; // e.g., "Dietary", "Room", "Activities"
  preference: string;
}

// ===== CREW LEAVE TYPES =====

export type CrewLeaveType = 'ANNUAL' | 'SICK' | 'ROTATION' | 'OTHER';

export interface CrewLeave {
  id: string;
  vesselId: string;
  crewMemberId: string;
  crewMemberName: string;
  crewMemberPosition?: string;
  crewMemberDepartment?: Department;
  leaveType: CrewLeaveType;
  startDate: string;
  endDate: string;
  notes: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

// ===== PERSONAL SEA MILES TYPES =====

export type SeaMileEntryStatus = 'DRAFT' | 'PENDING' | 'APPROVED' | 'DECLINED';

export interface CaptainSeaMileContact {
  userId: string;
  firstName: string;
  lastName: string;
  cellNumber: string | null;
  emailAddress: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SeaMileFolder {
  id: string;
  userId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface SeaMileFolderAssignment {
  entryId: string;
  folderId: string;
}

export interface SeaMileEntry {
  id: string;
  userId: string;
  reviewVesselId: string | null;
  voyageDate: string;
  vesselName: string;
  vesselLength: string;
  fromLocation: string;
  toLocation: string;
  capacityRole: string;
  milesLogged: number;
  dayHours: number;
  nightHours: number;
  tidal: boolean;
  status: SeaMileEntryStatus;
  declineComment: string | null;
  submittedAt: string | null;
  reviewedBy: string | null;
  reviewerName: string | null;
  reviewerSignatureType: 'drawn' | 'typed' | null;
  reviewerSignatureImage: string | null;
  reviewerTypedName: string | null;
  reviewerContactFirstName: string | null;
  reviewerContactLastName: string | null;
  reviewerContactCellNumber: string | null;
  reviewerContactEmailAddress: string | null;
  reviewedAt: string | null;
  ownerName?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PreDepartureChecklistItem {
  id: string;
  checklistId: string;
  label: string;
  sortOrder: number;
  checked: boolean;
  createdAt: string;
}

export interface PreDepartureChecklist {
  id: string;
  vesselId: string;
  tripId: string | null;
  linkedTrip?: {
    id: string;
    title: string;
    startDate: string;
    endDate: string;
  } | null;
  department: Department | null;
  title: string;
  items: PreDepartureChecklistItem[];
  createdAt: string;
  createdBy?: string;
}

// ===== YARD PERIOD JOBS TYPES =====

export type YardJobPriority = 'GREEN' | 'YELLOW' | 'RED';

export interface YardPeriodJob {
  id: string;
  vesselId: string;
  tripId?: string | null;
  jobTitle: string;
  jobDescription: string;
  defectDetails: string;
  defectLocation: string;
  equipmentSerial: string;
  department: Department;
  priority: YardJobPriority;
  yardLocation: string;
  contractorCompanyName: string;
  contactDetails: string;
  startDate: string | null;
  endDate: string | null;
  /** @deprecated Preserved temporarily while existing records are migrated to a date range. */
  doneByDate: string | null;
  status: 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED';
  completedBy?: string;
  completedAt?: string;
  completedByName?: string;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ShipyardRecordFolder {
  id: string;
  vesselId: string;
  name: string;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ShipyardRecordFolderAssignment {
  jobId: string;
  folderId: string;
}

// ===== MAINTENANCE LOG TYPES =====

export interface MaintenanceLog {
  id: string;
  vesselId: string;
  equipment: string;
  portStarboardNa: string;
  serialNumber: string;
  hoursOfService: string;
  hoursAtNextService: string;
  whatServiceDone: string;
  notes: string;
  serviceDoneBy: string;
  createdAt: string;
  updatedAt: string;
}

// ===== CONTRACTORS TYPES =====

export interface Contractor {
  id: string;
  vesselId: string;
  department: Department;
  serviceType: string;
  companyName: string;
  contactName: string;
  phone: string;
  email: string;
  date: string;
  time: string;
  notes?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

// ===== SHARED TYPES =====

export interface Attachment {
  id: string;
  url: string;
  filename: string;
  mimeType: string;
  size: number;
  uploadedBy: string;
  uploadedAt: string;
}

// ===== CALENDAR TYPES =====

export type CalendarFilterType =
  | 'ALL'
  | 'BOSS_TRIPS'
  | 'GUEST_TRIPS'
  | 'CONTRACTORS'
  | 'JOBS'
  | 'DUTIES';

export interface CalendarEvent {
  id: string;
  type: CalendarFilterType;
  title: string;
  date: string;
  startTime?: string;
  endTime?: string;
  color: string;
  relatedId: string; // ID of the task, trip, contractor, etc.
}

// ===== LOCATION/STORE FINDER TYPES =====

export interface SavedLocation {
  id: string;
  vesselId: string;
  name: string;
  category: string;
  address: string;
  latitude: number;
  longitude: number;
  notes?: string;
  savedBy: string;
  createdAt: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

export interface SavedChat {
  id: string;
  userId: string;
  vesselId: string;
  title: string;
  messages: ChatMessage[];
  createdAt: string;
}

// ===== VESSEL LOG TYPES =====

export type WeightUnit = 'kgs' | 'lbs';

export interface GeneralWasteLog {
  id: string;
  vesselId: string;
  logDate: string;
  logTime: string;
  positionLocation: string;
  descriptionOfGarbage: string;
  weight?: number | null;
  weightUnit?: WeightUnit | null;
  createdByName: string;
  createdAt: string;
}

export type DischargeType = 'DIRECT_DISCHARGE' | 'TREATMENT_PLANT' | 'PUMPOUT_SERVICE';

export interface PumpOutLog {
  id: string;
  vesselId: string;
  dischargeType: DischargeType;
  pumpoutServiceName: string;
  location: string;
  amountInGallons: number;
  description: string;
  logDate: string;
  logTime: string;
  createdByName: string;
  createdAt: string;
}

export interface FuelLog {
  id: string;
  vesselId: string;
  locationOfRefueling: string;
  logDate: string;
  logTime: string;
  amountOfFuel: number;
  /**
   * Legacy field name retained because existing callers and historical exports
   * use the `price_per_gallon` database column. For new entries its semantic
   * unit is described by `volumeUnit`.
   */
  pricePerGallon: number;
  /** Alias for new fuel flows; equal to pricePerGallon for every row. */
  pricePerVolumeUnit: number;
  totalPrice: number;
  /** NULL identifies a pre-migration record; the legacy UI stored US gallons. */
  volumeUnit: FuelVolumeUnit | null;
  /** ISO-style, three-letter currency code. Historical rows default to USD. */
  currencyCode: string;
  comment: string;
  /** Immutable authenticated actor UUID for new records; null on unverifiable legacy rows. */
  createdBy: string | null;
  createdByName: string;
  createdAt: string;
  /** Unambiguous ship-time evidence retained for current report-only and ledger records. */
  effectiveAt?: string | null;
  utcOffsetMinutes?: number | null;
  inventoryRevision?: number;
  currentInventoryOperationId?: string | null;
  voidedAt?: string | null;
}

export type FuelVolumeUnit = 'LITRES' | 'US_GALLONS';

/**
 * Inventory is deliberately opt-in. Historical Fuel Log rows cannot establish
 * a trustworthy current balance because they contain no consumption data.
 */
export type FuelInventoryActivationStatus = 'NOT_ACTIVATED' | 'NEEDS_INITIALIZATION' | 'ACTIVE';

/** Canonical operation kinds persisted by the append-only tank ledger. */
export type FuelInventoryEntryKind =
  | 'OPENING'
  | 'REFUEL'
  | 'TRANSFER'
  | 'CONSUMPTION'
  | 'SOUNDING'
  | 'ADJUSTMENT';

export type FuelInventoryOperationStatus = 'POSTED' | 'VOIDED' | 'REPLACED';
export type FuelInventoryVerificationKind = 'OPENING' | 'SOUNDING';

export interface VesselFuelSettings {
  vesselId: string;
  volumeUnit: FuelVolumeUnit;
  /** Optimistic concurrency token for the vessel-wide tank catalogue. */
  setupRevision: number;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FuelTank {
  id: string;
  vesselId: string;
  name: string;
  location: string;
  description: string;
  /** Canonical persisted capacity, always in litres. */
  capacityLitres: number;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string | null;
}

export interface FuelTankInput {
  name: string;
  location?: string;
  description?: string;
  capacityLitres: number;
}

export interface FuelSetupTankInput extends FuelTankInput {
  /** Omit for a new tank; supply an existing ID to update it during saveSetup. */
  id?: string;
}

export interface FuelSetup {
  settings: VesselFuelSettings | null;
  tanks: FuelTank[];
  /** Derived from configured tank capacities; never stored redundantly. */
  totalCapacityLitres: number;
}

export interface FuelLogTankEntry {
  id: string;
  vesselId: string;
  fuelLogId: string;
  fuelTankId: string;
  /** Canonical persisted allocation, always in litres. */
  amountLitres: number;
  createdAt: string;
}

export interface FuelLogTankEntryInput {
  fuelTankId: string;
  amountLitres: number;
}

/** Read model used when presenting one persisted tank allocation. */
export interface FuelLogTankAllocation {
  fuelLogId: string;
  fuelTankId: string;
  tankName: string;
  /** Canonical persisted allocation, always in litres. */
  amountLitres: number;
}

export type FuelLogTankAllocationsByLogId = Record<string, FuelLogTankAllocation[]>;

/**
 * One batched snapshot for fuel-log history and export. Amounts stay canonical
 * here; presentation converts them using the vessel's configured display unit.
 */
export interface FuelLogAllocationSnapshot {
  displayUnit: FuelVolumeUnit;
  allocationsByLogId: FuelLogTankAllocationsByLogId;
}

export interface FuelTransfer {
  id: string;
  vesselId: string;
  sourceTankId: string;
  destinationTankId: string;
  /** Immutable ledger snapshot for posted activity; retained tank-name fallback for legacy rows. */
  sourceTankName?: string;
  /** Immutable ledger snapshot for posted activity; retained tank-name fallback for legacy rows. */
  destinationTankName?: string;
  /** Canonical persisted transfer amount, always in litres. */
  amountLitres: number;
  transferDate: string;
  transferTime: string;
  location: string;
  notes: string;
  /** Canonical inventory-ledger operation created for this transfer, when activated. */
  ledgerOperationId?: string | null;
  /** Unambiguous operational timestamp used by chronological balance validation. */
  effectiveAt?: string | null;
  utcOffsetMinutes?: number | null;
  createdBy: string | null;
  createdByName?: string;
  createdAt: string;
  updatedAt: string;
  voidedAt?: string | null;
  inventoryRevision?: number;
  currentInventoryOperationId?: string | null;
}

export interface FuelTransferInput {
  vesselId: string;
  sourceTankId: string;
  destinationTankId: string;
  amountLitres: number;
  transferDate: string;
  transferTime: string;
  location?: string;
  notes?: string;
  /** Optional explicit ISO timestamp; legacy screens may continue supplying date + time. */
  effectiveAt?: string;
  utcOffsetMinutes?: number;
  /** Stable UUID supplied by a caller that may retry the same logical write. */
  idempotencyKey?: string;
  /** Required by the server when an existing posted transfer is replaced. */
  amendmentReason?: string;
  expectedRevision?: number;
}

export interface FuelInventoryOpeningBalanceInput {
  tankId: string;
  amountLitres: number;
}

export interface FuelInventoryActivationInput {
  vesselId: string;
  entries: FuelInventoryOpeningBalanceInput[];
  occurredAt?: string;
  utcOffsetMinutes?: number;
  notes?: string;
  idempotencyKey?: string;
}

/** Manager-only replacement of one existing opening operation. */
export interface FuelInventoryOpeningAmendmentInput {
  operationId: string;
  expectedRevision: number;
  occurredAt: string;
  utcOffsetMinutes?: number;
  entries: FuelInventoryOpeningBalanceInput[];
  notes?: string;
  amendmentReason: string;
  idempotencyKey?: string;
}

/** Inputs accepted for an explicit sounding, consumption, or manager adjustment. */
export interface FuelInventoryEntryInput {
  vesselId: string;
  fuelTankId: string;
  kind: Extract<FuelInventoryEntryKind, 'SOUNDING' | 'CONSUMPTION' | 'ADJUSTMENT'>;
  /** SOUNDING is absolute; CONSUMPTION is positive usage; ADJUSTMENT is signed. */
  amountLitres: number;
  adjustmentDirection?: 'ADD' | 'REMOVE';
  occurredAt: string;
  utcOffsetMinutes?: number;
  location?: string;
  /** Mandatory for ADJUSTMENT and recommended for every manual record. */
  reason?: string;
  notes?: string;
  idempotencyKey?: string;
}

export interface FuelInventoryEntryAmendmentInput extends FuelInventoryEntryInput {
  operationId: string;
  expectedRevision: number;
  /** Required audit explanation; distinct from the operational entry reason. */
  amendmentReason: string;
}

export interface FuelInventoryEntryVoidInput {
  operationId: string;
  expectedRevision: number;
  reason: string;
  idempotencyKey?: string;
}

export interface FuelInventoryTankSnapshot {
  tank: FuelTank;
  initialized: boolean;
  /** Null is materially different from zero: the tank has not been initialized. */
  balanceLitres: number | null;
  remainingCapacityLitres: number | null;
  lastVerifiedAt: string | null;
  lastVerificationKind: FuelInventoryVerificationKind | null;
  lastVerifiedUtcOffsetMinutes: number | null;
  lastActivityAt: string | null;
}

/** Backward-compatible name retained for early callers. */
export type FuelTankInventoryState = FuelInventoryTankSnapshot;

export interface FuelInventorySnapshot {
  vesselId: string;
  status: FuelInventoryActivationStatus;
  activatedAt: string | null;
  asOf: string;
  displayUnit: FuelVolumeUnit;
  totalBalanceLitres: number | null;
  totalCapacityLitres: number;
  allTanksInitialized: boolean;
  uninitializedTankIds: string[];
  tanks: FuelInventoryTankSnapshot[];
}

export type FuelInventoryPostingMode = 'DELTA' | 'ABSOLUTE';

export interface FuelInventoryLedgerPosting {
  tankId: string;
  tankName: string;
  postingMode: FuelInventoryPostingMode;
  /** Signed for DELTA postings; absolute observed quantity for ABSOLUTE postings. */
  amountLitres: number;
}

/** Backward-compatible name retained for early callers. */
export type FuelInventoryLedgerLine = FuelInventoryLedgerPosting;

export interface FuelInventoryOperation {
  id: string;
  logicalOperationId: string;
  revisionNo: number;
  vesselId: string;
  kind: FuelInventoryEntryKind;
  status: FuelInventoryOperationStatus;
  effectiveAt: string;
  /** Null only for historical server rows that predate captured timezone context. */
  utcOffsetMinutes: number | null;
  effectiveOrder: number;
  recordedSequence: number;
  metadata: Record<string, unknown>;
  sourceFuelLogId: string | null;
  sourceTransferId: string | null;
  supersedesOperationId: string | null;
  createdBy: string | null;
  createdByName: string;
  recordedAt: string;
  voided: boolean;
  voidKind: string | null;
  voidReason: string | null;
  voidedBy: string | null;
  voidedByName: string;
  voidedAt: string | null;
  postings: FuelInventoryLedgerPosting[];
}

export interface FuelInventoryHistory {
  operations: FuelInventoryOperation[];
  /** Opaque server cursor. Null means there are no older operations. */
  nextBeforeSequence: number | null;
}

export type FuelInventoryLegacyAuditSourceType = 'FUEL_LOG' | 'FUEL_TRANSFER';
export type FuelInventoryLegacyAuditAction = 'AMENDMENT' | 'VOID';

/**
 * Immutable evidence for a correction to a report-only fuel record that
 * predates ledger activation. These records never alter calculated inventory.
 */
export interface FuelInventoryLegacyAudit {
  id: string;
  vesselId: string;
  sourceType: FuelInventoryLegacyAuditSourceType;
  sourceId: string;
  action: FuelInventoryLegacyAuditAction;
  revisionBefore: number | null;
  revisionAfter: number | null;
  beforeSnapshot: Record<string, unknown>;
  afterSnapshot: Record<string, unknown>;
  reason: string;
  clientRequestId: string;
  createdBy: string | null;
  createdByName: string;
  recordedAt: string;
}

export interface FuelInventoryLegacyAuditCursor {
  recordedAt: string;
  id: string;
}

export interface FuelInventoryLegacyAuditHistory {
  audits: FuelInventoryLegacyAudit[];
  nextCursor: FuelInventoryLegacyAuditCursor | null;
}

export interface FuelTankBalance {
  tank: FuelTank;
  /**
   * Recorded net volume only: tank allocations plus inbound transfers minus
   * outbound transfers. It intentionally excludes unallocated legacy logs.
   */
  recordedVolumeLitres: number;
  remainingCapacityLitres: number;
  /** Compatibility read model; use FuelInventorySnapshot when nullability matters. */
  isInitialized?: boolean;
  lastVerifiedAt?: string | null;
  lastVerificationKind?: FuelInventoryVerificationKind | null;
}

// ===== NAVIGATION TYPES =====

export type RootStackParamList = {
  Auth: undefined;
  Main: undefined;
  Login: undefined;
  Register: undefined;
};

export type MainTabParamList = {
  Tasks: undefined;
  Calendar: undefined;
  More: undefined;
};

export type TasksStackParamList = {
  TasksList: undefined;
  TaskDetail: { taskId: string };
  CreateTask: undefined;
  EditTask: { taskId: string };
};
