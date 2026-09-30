import { getStateFromPath } from '@react-navigation/native';

const WEB_PREFIXES = [
  'https://www.nautical-ops.com',
  'https://nautical-ops.com',
  'https://nautical-ops.vercel.app',
  'nauticalops://',
];

const AUTH_SCREEN_PATHS = {
  Welcome: 'welcome',
  Login: 'login',
  ForgotPassword: 'forgot-password',
  CreateAccountChoice: 'create-account',
  Register: 'register',
  RegisterCaptain: 'register-captain',
  RegisterCrew: 'register-crew',
  CreateVessel: 'create-vessel',
  TermsConditions: 'terms',
  PrivacyPolicy: 'privacy',
  RefundPolicy: 'refund-policy',
};

const APP_SCREEN_PATHS = {
  CaptainWelcome: 'captain-welcome',
  MainTabs: {
    path: '',
    screens: {
      Home: 'app',
      Categories: 'categories',
      Profile: 'profile',
    },
  },
  JoinVessel: 'join-vessel',
  CreateVessel: 'create-vessel',
  FAQHelp: 'help',
  Settings: 'settings',
  AccountProfile: 'settings/profile',
  VesselPlans: 'vessel-plans',
  TermsConditions: 'terms',
  PrivacyPolicy: 'privacy',
  RefundPolicy: 'refund-policy',
  VesselSettings: 'vessel-settings',
  CrewManagement: 'crew',
  RotationalGroups: 'rotational-groups',
  SeaMilesReview: 'crew/sea-miles',
  UpcomingTrips: 'trips/upcoming',
  GuestTrips: 'trips/guest',
  BossTrips: 'trips/boss',
  AddEditTrip: 'trips/edit',
  CrewLeave: 'crew-leave',
  AddEditCrewLeave: 'crew-leave/edit',
  DeliveryTrips: 'trips/delivery',
  TripColorSettings: 'trip-colors',
  VesselCrewSafety: 'safety',
  MySeaMiles: 'safety/sea-miles',
  AddEditSeaMile: 'safety/sea-miles/edit',
  MusterStation: 'safety/muster',
  CreateMusterStation: 'safety/muster/create',
  SafetyEquipment: 'safety/equipment',
  CreateSafetyEquipment: 'safety/equipment/create',
  Rules: 'rules',
  CreateRules: 'rules/create',
  PreDepartureChecklist: 'pre-departure',
  AddEditPreDepartureChecklist: 'pre-departure/edit',
  ViewPreDepartureChecklist: 'pre-departure/view',
  Tasks: 'tasks',
  TasksList: 'tasks/list',
  AddEditTask: 'tasks/edit',
  OverdueTasks: 'tasks/overdue',
  UpcomingTasks: 'tasks/upcoming',
  CompletedTasks: 'tasks/completed',
  TasksCalendar: 'tasks/calendar',
  YardPeriodJobs: 'yard-period',
  AddEditYardJob: 'yard-period/edit',
  MaintenanceHome: 'maintenance',
  MaintenanceLog: 'maintenance/log',
  AddEditMaintenanceLog: 'maintenance/edit',
  ImportExport: 'import-export',
  WatchKeeping: 'watch-keeping',
  HoursOfRest: 'hours-of-rest',
  WatchDuties: 'watch-duties',
  SignatureSetup: 'signature',
  RestDayEntry: 'hours-of-rest/entry',
  RestToBeConfirmed: 'hours-of-rest/review',
  WatchSchedule: 'watch-schedule',
  CreateWatchTimetable: 'watch-schedule/create',
  ShoppingListCategory: 'shopping',
  ShoppingList: 'shopping/list',
  AddEditShoppingList: 'shopping/edit',
  Inventory: 'inventory',
  AddEditInventoryItem: 'inventory/edit',
  Uniforms: 'uniforms',
  AddEditUniform: 'uniforms/edit',
  DepartmentColorSettings: 'department-colors',
  ThemeSettings: 'theme',
  NotificationSettings: 'notifications',
  VesselLogs: 'logs',
  GeneralWasteLog: 'logs/general-waste',
  VesselLogHistory: 'logs/history',
  AddEditGeneralWasteLog: 'logs/general-waste/edit',
  FuelLog: 'logs/fuel',
  AddEditFuelLog: 'logs/fuel/edit',
  FuelInventory: 'logs/fuel/inventory',
  FuelHistory: 'logs/fuel/history',
  FuelSetup: 'logs/fuel/setup',
  FuelTransfers: 'logs/fuel/transfers',
  FuelTransfer: 'logs/fuel/transfers/edit',
  PumpOutLog: 'logs/pump-out',
  AddEditPumpOutLog: 'logs/pump-out/edit',
  ContractorDatabase: 'contractors',
  FutureUpdates: 'future-updates',
  Notepad: 'notepad',
  AddEditNote: 'notepad/edit',
  AddEditContractor: 'contractors/edit',
};

const PAYMENT_RESTRICTED_PATHS = {
  VesselPlans: 'vessel-plans',
  TermsConditions: 'terms',
  PrivacyPolicy: 'privacy',
};

export const createWebLinkingConfig = (
  isAuthenticated: boolean,
  captainPaymentRequired = false
) => {
  const screens = !isAuthenticated
    ? AUTH_SCREEN_PATHS
    : captainPaymentRequired
      ? PAYMENT_RESTRICTED_PATHS
      : APP_SCREEN_PATHS;

  return {
    prefixes: WEB_PREFIXES,
    config: { screens },
    getStateFromPath: (path: string, options: any) => {
      const [pathname, ...query] = String(path || '').split('?');
      const cleanedPath = pathname.replace(/^\/+|\/+$/g, '');
      const suffix = query.length ? `?${query.join('?')}` : '';

      // Logged out: root should always resolve to /login
      if (!isAuthenticated && (cleanedPath === '' || cleanedPath === 'welcome')) {
        return getStateFromPath('/login', options);
      }

      // Logged in: /login should resolve to home
      if (isAuthenticated && (cleanedPath === 'login' || cleanedPath === '')) {
        return getStateFromPath(captainPaymentRequired ? '/vessel-plans' : '/app', options);
      }

      // Previously unmapped screens used their route names as URLs. Keep old
      // bookmarks working, but always store an absolute path in browser history.
      const legacyPath = (screens as Record<string, unknown>)[cleanedPath];
      const canonicalPath = typeof legacyPath === 'string' ? legacyPath : cleanedPath;
      const resolved = getStateFromPath(`/${canonicalPath}${suffix}`, options);
      if (resolved) return resolved;

      // Invalid/protected URL behavior:
      // - logged out -> /login
      // - logged in -> /
      return getStateFromPath(
        isAuthenticated ? (captainPaymentRequired ? '/vessel-plans' : '/app') : '/login',
        options
      );
    },
  };
};
