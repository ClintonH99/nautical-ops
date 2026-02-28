/**
 * Core Type Definitions for Nautical Ops
 */

// ===== USER & AUTH TYPES =====

export type UserRole = 'HOD' | 'CREW' | 'MANAGEMENT';

export type Department = 'BRIDGE' | 'ENGINEERING' | 'EXTERIOR' | 'INTERIOR' | 'GALLEY';

export type NotificationPreferenceKey =
  | 'tasks'
  | 'trips'
  | 'preDeparture'
  | 'maintenance'
  | 'yardJobs'
  | 'watchSchedule';

export interface NotificationPreferences {
  tasks: boolean;
  trips: boolean;
  preDeparture: boolean;
  maintenance: boolean;
  yardJobs: boolean;
  watchSchedule: boolean;
}

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  tasks: true,
  trips: true,
  preDeparture: true,
  maintenance: true,
  yardJobs: true,
  watchSchedule: true,
};

export interface User {
  id: string;
  email: string;
  name: string;
  position: string;
  department: Department;
  role: UserRole;
  vesselId?: string; // Optional - user can join vessel later
  profilePhoto?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Vessel {
  id: string;
  name: string;
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
  jobTitle: string;
  jobDescription: string;
  department: Department;
  priority: YardJobPriority;
  yardLocation: string;
  contractorCompanyName: string;
  contactDetails: string;
  doneByDate: string | null;
  status: 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED';
  completedBy?: string;
  completedAt?: string;
  completedByName?: string;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
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

export type CalendarFilterType = 'ALL' | 'BOSS_TRIPS' | 'GUEST_TRIPS' | 'CONTRACTORS' | 'JOBS' | 'DUTIES';

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
  pricePerGallon: number;
  totalPrice: number;
  createdByName: string;
  createdAt: string;
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
