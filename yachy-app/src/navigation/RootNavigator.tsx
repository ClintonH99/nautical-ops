/**
 * Root Navigation
 * Handles auth flow and main navigation
 */

import React, { useEffect } from 'react';
import { NavigationContainer, DefaultTheme, getStateFromPath } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { ActivityIndicator, View, StyleSheet, Platform, AppState } from 'react-native';
import { PostHogProvider } from 'posthog-react-native';
import { posthog } from '../config/posthog';
import {
  WelcomeScreen,
  LoginScreen,
  CreateAccountChoiceScreen,
  RegisterScreen,
  RegisterCaptainScreen,
  RegisterCrewScreen,
  JoinVesselScreen,
  ProfileScreen,
  VesselSettingsScreen,
  VesselPlansScreen,
  CrewManagementScreen,
  RotationalGroupsScreen,
  UpcomingTripsScreen,
  GuestTripsScreen,
  BossTripsScreen,
  AddEditTripScreen,
  PreDepartureChecklistScreen,
  AddEditPreDepartureChecklistScreen,
  ViewPreDepartureChecklistScreen,
  DeliveryTripsScreen,
  YardPeriodTripsScreen,
  TripColorSettingsScreen,
  TasksScreen,
  TasksListScreen,
  AddEditTaskScreen,
  OverdueTasksScreen,
  UpcomingTasksScreen,
  CompletedTasksScreen,
  YardPeriodJobsScreen,
  AddEditYardJobScreen,
  MaintenanceHomeScreen,
  MaintenanceLogScreen,
  AddEditMaintenanceLogScreen,
  ImportExportScreen,
  TasksCalendarScreen,
  WatchKeepingScreen,
  HoursOfRestScreen,
  WatchDutiesScreen,
  SignatureSetupScreen,
  RestDayEntryScreen,
  RestToBeConfirmedScreen,
  WatchScheduleScreen,
  CreateWatchTimetableScreen,
  ShoppingListCategoryScreen,
  ShoppingListScreen,
  AddEditShoppingListScreen,
  InventoryScreen,
  ForgotPasswordScreen,
  AddEditInventoryItemScreen,
  UniformsScreen,
  AddEditUniformScreen,
  DepartmentColorSettingsScreen,
  ThemeSettingsScreen,
  NotificationSettingsScreen,
  FAQScreen,
  TermsConditionsScreen,
  PrivacyPolicyScreen,
  RefundPolicyScreen,
  VesselLogsScreen,
  GeneralWasteLogScreen,
  AddEditGeneralWasteLogScreen,
  FuelLogScreen,
  AddEditFuelLogScreen,
  PumpOutLogScreen,
  AddEditPumpOutLogScreen,
  ContractorDatabaseScreen,
  AddEditContractorScreen,
  NotepadScreen,
  FutureUpdatesScreen,
  AddEditNoteScreen,
  VesselCrewSafetyScreen,
  MusterStationScreen,
  CreateMusterStationScreen,
  SafetyEquipmentScreen,
  CreateSafetyEquipmentScreen,
  RulesScreen,
  CreateRulesScreen,
} from '../screens';
import { CreateVesselScreen, CaptainWelcomeScreen } from '../screens';
import { WatchScheduleDetailScreen } from '../screens/WatchScheduleDetailScreen';
import { MainTabsNavigator } from './MainTabsNavigator';
import { useAuthStore, useDepartmentColorStore, useThemeStore, BACKGROUND_THEMES } from '../store';
import authService from '../services/auth';
import { supabase } from '../services/supabase';
import { startRealtimeSync, stopRealtimeSync } from '../services/realtimeSync';
import { COLORS } from '../constants/theme';

const Stack = createNativeStackNavigator();

/** Web URL paths: split by auth state so parsed URLs always target mounted screens */
const WEB_PREFIXES = [
  'https://www.nautical-ops.com',
  'https://nautical-ops.com',
  'https://nautical-ops.vercel.app',
  'nauticalops://',
];

const AUTH_SCREEN_PATHS = {
  Welcome: 'welcome',
  Login: 'login',
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
      Home: '',
      Categories: 'categories',
      Profile: 'profile',
    },
  },
  JoinVessel: 'join-vessel',
  Settings: 'settings',
  VesselPlans: 'vessel-plans',
  TermsConditions: 'terms',
  PrivacyPolicy: 'privacy',
  RefundPolicy: 'refund-policy',
  VesselSettings: 'vessel-settings',
  CrewManagement: 'crew',
  RotationalGroups: 'rotational-groups',
  UpcomingTrips: 'trips/upcoming',
  GuestTrips: 'trips/guest',
  BossTrips: 'trips/boss',
  AddEditTrip: 'trips/edit',
  DeliveryTrips: 'trips/delivery',
  YardPeriodTrips: 'trips/yard-period',
  TripColorSettings: 'trip-colors',
  VesselCrewSafety: 'safety',
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
  WatchSchedule: 'watch-schedule',
  CreateWatchTimetable: 'watch-schedule/create',
  ShoppingListCategory: 'shopping',
  ShoppingList: 'shopping/list',
  AddEditShoppingList: 'shopping/edit',
  Inventory: 'inventory',
  AddEditInventoryItem: 'inventory/edit',
  DepartmentColorSettings: 'department-colors',
  ThemeSettings: 'theme',
  NotificationSettings: 'notifications',
  VesselLogs: 'logs',
  GeneralWasteLog: 'logs/general-waste',
  AddEditGeneralWasteLog: 'logs/general-waste/edit',
  FuelLog: 'logs/fuel',
  AddEditFuelLog: 'logs/fuel/edit',
  PumpOutLog: 'logs/pump-out',
  AddEditPumpOutLog: 'logs/pump-out/edit',
  ContractorDatabase: 'contractors',
  AddEditContractor: 'contractors/edit',
};

const createWebLinkingConfig = (isAuthenticated: boolean) => {
  const screens = isAuthenticated ? APP_SCREEN_PATHS : AUTH_SCREEN_PATHS;

  return {
    prefixes: WEB_PREFIXES,
    config: { screens },
    getStateFromPath: (path: string, options: any) => {
      const cleanedPath = String(path || '')
        .split('?')[0]
        .replace(/^\/+|\/+$/g, '');

      // Logged out: root should always resolve to /login
      if (!isAuthenticated && (cleanedPath === '' || cleanedPath === 'welcome')) {
        return getStateFromPath('login', options);
      }

      // Logged in: /login should resolve to home
      if (isAuthenticated && cleanedPath === 'login') {
        return getStateFromPath('', options);
      }

      const resolved = getStateFromPath(cleanedPath, options);
      if (resolved) return resolved;

      // Invalid/protected URL behavior:
      // - logged out -> /login
      // - logged in -> /
      return getStateFromPath(isAuthenticated ? '' : 'login', options);
    },
  };
};

// ROUTING RULE: Users with an account AND assigned to a vessel always go to Home (MainTabs).
// CaptainWelcome (create vessel) is ONLY for captains who have no vessel yet.
export const RootNavigator = () => {
  const { isAuthenticated, isLoading, setUser, setLoading, user } = useAuthStore();
  const isCaptain = user?.role === 'CAPTAIN_MOV';
  const hasVessel = !!user?.vesselId;
  // Welcome: logged-out cold start only. Logged-in users skip Welcome (straight to MainTabs / CaptainWelcome).
  // Per ADMIN rule: Crew members never see CaptainWelcome - go straight to MainTabs
  const initialRoute = !isAuthenticated
    ? 'Login'
    : isCaptain && !hasVessel
      ? 'CaptainWelcome'
      : 'MainTabs';
  const backgroundTheme = useThemeStore((s) => s.backgroundTheme);
  const themeColors = BACKGROUND_THEMES[backgroundTheme];

  const loadTheme = useThemeStore((s) => s.loadTheme);

  useEffect(() => {
    let mounted = true;
    const BOOTSTRAP_MAX_MS = 12000;

    const runBootstrap = async () => {
      try {
        const [, session] = await Promise.all([
          loadTheme().catch(() => {
            /* theme load is non-critical */
          }),
          authService.getSession(),
        ]);
        if (!mounted) return;

        if (!session?.user) {
          return;
        }

        let userData = await authService.getUserProfileWithRetry(session.user.id);

        if (mounted && !userData && Platform.OS === 'web') {
          try {
            await supabase.auth.signOut({ scope: 'local' });
          } catch {
            /* best-effort clear of stale web session */
          }
          return;
        }

        if (mounted && userData) {
          const isCaptain =
            userData.role === 'CAPTAIN_MOV';
          if (isCaptain && !userData.vesselId) {
            const refetch = await authService.getUserProfile(session.user.id);
            if (mounted && refetch?.vesselId) userData = refetch;
          }
          if (isCaptain) {
            setUser(userData);
          } else if (userData.vesselId) {
            // TODO: Re-enable subscription check once payment flow is set up
            if (mounted) setUser(userData);
          } else {
            setUser(userData);
          }
        }
      } catch (error) {
        if (__DEV__) console.error('Auth check error:', error);
        if (Platform.OS === 'web') {
          try {
            await supabase.auth.signOut({ scope: 'local' });
          } catch {
            /* best-effort clear on error */
          }
        }
      }
    };

    void (async () => {
      try {
        await Promise.race([
          runBootstrap(),
          new Promise<void>((resolve) => setTimeout(() => resolve(), BOOTSTRAP_MAX_MS)),
        ]);
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    const { data: authListener } = authService.onAuthStateChange(async (user) => {
      try {
        // Password reset verifies an OTP, which signs the user in mid-flow.
        // Without this guard the stack remounts and ForgotPasswordScreen is
        // destroyed before the new password is ever set.
        if (useAuthStore.getState().deferUserUpdate) return;
        if (!user) {
          setUser(null);
          return;
        }
        const isCaptain = user.role === 'CAPTAIN_MOV';
        if (isCaptain && !user.vesselId) {
          const refetch = await authService.getUserProfile(user.id);
          if (refetch?.vesselId) setUser(refetch);
          else setUser(user);
        } else if (isCaptain) {
          setUser(user);
        } else if (user.vesselId) {
          // TODO: Re-enable subscription check once payment flow is set up
          // const subscription = await getVesselSubscription(user.vesselId);
          // if (subscription?.status === 'active') {
          //   setUser(user);
          // } else {
          //   await supabase.auth.signOut();
          //   setUser(null);
          // }
          setUser(user);
        } else {
          setUser(user);
        }
      } catch (error) {
        if (__DEV__) console.error('Auth listener error:', error);
      } finally {
        setLoading(false);
      }
    });

    return () => {
      mounted = false;
      authListener?.subscription?.unsubscribe();
    };
  }, [loadTheme, setLoading, setUser]);

  const loadDepartmentColorOverrides = useDepartmentColorStore((s) => s.loadOverrides);
  useEffect(() => {
    if (!isAuthenticated) return;
    const t = setTimeout(() => {
      loadDepartmentColorOverrides();
    }, 0);
    return () => clearTimeout(t);
  }, [isAuthenticated, loadDepartmentColorOverrides]);

  // Realtime sync: keep app and web in sync when data changes on either platform
  useEffect(() => {
    if (!isAuthenticated || !user?.id) {
      stopRealtimeSync();
      return;
    }
    const t = setTimeout(() => {
      startRealtimeSync(user.id, user.vesselId, {
        onUserUpdated: (u) => {
          // CreateVesselScreen defers setUser until "Go to Home" to avoid stack remount
          if (useAuthStore.getState().deferUserUpdate) return;
          setUser(u ?? null);
        },
      });
    }, 0);
    return () => {
      clearTimeout(t);
      stopRealtimeSync();
    };
  }, [isAuthenticated, user?.id, user?.vesselId, setUser]);

  // Resume: restart token auto-refresh and refresh profile after backgrounding (Supabase RN guidance)
  useEffect(() => {
    const onAppStateChange = (state: string) => {
      if (state === 'active') {
        supabase.auth.startAutoRefresh();
        void authService.getSession().then((session) => {
          if (!session?.user?.id) return;
          void authService.getUserProfileWithRetry(session.user.id).then((fresh) => {
            if (fresh) setUser(fresh);
          });
        });
      } else {
        supabase.auth.stopAutoRefresh();
      }
    };

    const sub = AppState.addEventListener('change', onAppStateChange);
    return () => sub.remove();
  }, [setUser]);

  if (isLoading) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: themeColors.background }]}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  const navTheme = {
    ...DefaultTheme,
    dark: themeColors.isDark,
    colors: {
      ...DefaultTheme.colors,
      primary: COLORS.primary,
      background: themeColors.background,
      card: themeColors.background,
      text: themeColors.textPrimary,
      border: themeColors.surfaceAlt,
      notification: COLORS.danger,
    },
  };

  const webLinking = Platform.OS === 'web' ? createWebLinkingConfig(isAuthenticated) : undefined;

  return (
    <NavigationContainer
      theme={navTheme}
      linking={webLinking}
      fallback={
        <View style={[styles.loadingContainer, { backgroundColor: themeColors.background }]}>
          <ActivityIndicator size="large" color={COLORS.primary} />
        </View>
      }
    >
      <PostHogProvider
        client={posthog}
        autocapture={{
          captureScreens: false,
          captureTouches: true,
          propsToCapture: ['testID'],
        }}
      >
        <Stack.Navigator
          key={isAuthenticated ? `main-${initialRoute}` : 'auth'}
          initialRouteName={initialRoute}
          screenOptions={{
            headerStyle: {
              backgroundColor: themeColors.surface,
            },
            headerShadowVisible: false,
            headerTintColor: themeColors.isDark ? COLORS.white : themeColors.textPrimary,
            headerTitleStyle: {
              fontWeight: 'bold',
            },
            headerBackTitle: 'Back',
            headerRightContainerStyle: { backgroundColor: 'transparent', paddingRight: 16 },
            contentStyle: { backgroundColor: themeColors.background },
          }}
        >
          {!isAuthenticated ? (
            // Auth Stack
            <>
              <Stack.Screen
                name="Welcome"
                component={WelcomeScreen}
                options={{ headerShown: false }}
              />
              <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
              <Stack.Screen
                name="ForgotPassword"
                component={ForgotPasswordScreen}
                options={{ title: 'Reset Password', headerShown: true }}
              />
              <Stack.Screen
                name="CreateAccountChoice"
                component={CreateAccountChoiceScreen}
                options={{ headerShown: false }}
              />
              <Stack.Screen
                name="Register"
                component={RegisterScreen}
                options={{ headerShown: false }}
              />
              <Stack.Screen
                name="RegisterCaptain"
                component={RegisterCaptainScreen}
                options={{ headerShown: false }}
              />
              <Stack.Screen
                name="RegisterCrew"
                component={RegisterCrewScreen}
                options={{ headerShown: false }}
              />
              <Stack.Screen
                name="CreateVessel"
                component={CreateVesselScreen}
                options={{ headerShown: false }}
              />
              <Stack.Screen
                name="TermsConditions"
                component={TermsConditionsScreen}
                options={{ title: 'Terms & Conditions', headerShown: true }}
              />
              <Stack.Screen
                name="PrivacyPolicy"
                component={PrivacyPolicyScreen}
                options={{ title: 'Privacy Policy', headerShown: true }}
              />
              <Stack.Screen
                name="RefundPolicy"
                component={RefundPolicyScreen}
                options={{ title: 'Refund Policy', headerShown: true }}
              />
            </>
          ) : (
            // Main App Stack (tabs = Home, Explore, Profile)
            <>
              <Stack.Screen
                name="CaptainWelcome"
                component={CaptainWelcomeScreen}
                options={{ headerShown: false }}
              />
              <Stack.Screen
                name="MainTabs"
                component={MainTabsNavigator}
                options={{
                  headerShown: false,
                  title: 'Home',
                  headerBackTitle: 'Back',
                }}
              />
              <Stack.Screen
                name="JoinVessel"
                component={JoinVesselScreen}
                options={{
                  title: 'Join Vessel',
                  headerShown: true,
                }}
              />
              <Stack.Screen
                name="CreateVessel"
                component={CreateVesselScreen}
                options={{ headerShown: false }}
              />
              <Stack.Screen
                name="FAQHelp"
                component={FAQScreen}
                options={{ title: 'FAQ & Help', headerShown: true }}
              />
              <Stack.Screen
                name="Settings"
                component={ProfileScreen}
                options={{
                  title: 'Settings & Profile',
                  headerShown: true,
                }}
              />
              <Stack.Screen
                name="VesselPlans"
                component={VesselPlansScreen}
                options={{
                  title: 'Vessel Plans',
                  headerShown: false,
                }}
              />
              <Stack.Screen
                name="VesselSettings"
                component={VesselSettingsScreen}
                options={{
                  title: 'Vessel Settings',
                  headerShown: true,
                }}
              />
              <Stack.Screen
                name="CrewManagement"
                component={CrewManagementScreen}
                options={{
                  title: 'Crew Management',
                  headerShown: true,
                }}
              />
              <Stack.Screen
                name="RotationalGroups"
                component={RotationalGroupsScreen}
                options={{
                  title: 'Rotational Groups',
                  headerShown: true,
                }}
              />
              <Stack.Screen
                name="UpcomingTrips"
                component={UpcomingTripsScreen}
                options={{
                  title: 'Upcoming Trips',
                  headerShown: true,
                }}
              />
              <Stack.Screen
                name="GuestTrips"
                component={GuestTripsScreen}
                options={{
                  title: 'Guest Trips',
                  headerShown: true,
                }}
              />
              <Stack.Screen
                name="BossTrips"
                component={BossTripsScreen}
                options={{
                  title: 'Boss Trips',
                  headerShown: true,
                }}
              />
              <Stack.Screen
                name="AddEditTrip"
                component={AddEditTripScreen}
                options={{
                  title: 'Trip',
                  headerShown: true,
                }}
              />
              <Stack.Screen
                name="VesselCrewSafety"
                component={VesselCrewSafetyScreen}
                options={{
                  title: 'Vessel & Crew Safety',
                  headerShown: true,
                }}
              />
              <Stack.Screen
                name="MusterStation"
                component={MusterStationScreen}
                options={{ title: 'Muster Station & Duties', headerShown: true }}
              />
              <Stack.Screen
                name="CreateMusterStation"
                component={CreateMusterStationScreen}
                options={{ title: 'Create Muster Station', headerShown: true }}
              />
              <Stack.Screen
                name="SafetyEquipment"
                component={SafetyEquipmentScreen}
                options={{ title: 'Safety Equipment', headerShown: true }}
              />
              <Stack.Screen
                name="CreateSafetyEquipment"
                component={CreateSafetyEquipmentScreen}
                options={{ title: 'Create Safety Equipment', headerShown: true }}
              />
              <Stack.Screen
                name="Rules"
                component={RulesScreen}
                options={{ title: 'Rules On-Board', headerShown: true }}
              />
              <Stack.Screen
                name="CreateRules"
                component={CreateRulesScreen}
                options={{ title: 'Create Rules', headerShown: true }}
              />
              <Stack.Screen
                name="PreDepartureChecklist"
                component={PreDepartureChecklistScreen}
                options={{
                  title: 'Pre-Departure Checklist',
                  headerShown: true,
                }}
              />
              <Stack.Screen
                name="AddEditPreDepartureChecklist"
                component={AddEditPreDepartureChecklistScreen}
                options={{
                  title: 'Pre-Departure Checklist',
                  headerShown: true,
                }}
              />
              <Stack.Screen
                name="ViewPreDepartureChecklist"
                component={ViewPreDepartureChecklistScreen}
                options={{
                  title: 'View Checklist',
                  headerShown: true,
                }}
              />
              <Stack.Screen
                name="DeliveryTrips"
                component={DeliveryTripsScreen}
                options={{
                  title: 'Delivery',
                  headerShown: true,
                }}
              />
              <Stack.Screen
                name="YardPeriodTrips"
                component={YardPeriodTripsScreen}
                options={{
                  title: 'Yard Period',
                  headerShown: true,
                }}
              />
              <Stack.Screen
                name="TripColorSettings"
                component={TripColorSettingsScreen}
                options={{
                  title: 'Trip colors',
                  headerShown: true,
                }}
              />
              <Stack.Screen
                name="Tasks"
                component={TasksScreen}
                options={{
                  title: 'Tasks',
                  headerShown: true,
                }}
              />
              <Stack.Screen
                name="TasksList"
                component={TasksListScreen}
                options={{
                  title: 'Tasks',
                  headerShown: true,
                }}
              />
              <Stack.Screen
                name="AddEditTask"
                component={AddEditTaskScreen}
                options={{
                  title: 'Task',
                  headerShown: true,
                }}
              />
              <Stack.Screen
                name="OverdueTasks"
                component={OverdueTasksScreen}
                options={{
                  title: 'Overdue Tasks',
                  headerShown: true,
                }}
              />
              <Stack.Screen
                name="UpcomingTasks"
                component={UpcomingTasksScreen}
                options={{
                  title: 'Upcoming Tasks',
                  headerShown: true,
                }}
              />
              <Stack.Screen
                name="CompletedTasks"
                component={CompletedTasksScreen}
                options={{
                  title: 'Completed Tasks',
                  headerShown: true,
                }}
              />
              <Stack.Screen
                name="TasksCalendar"
                component={TasksCalendarScreen}
                options={{
                  title: 'Yard Period Calendar',
                  headerShown: true,
                }}
              />
              <Stack.Screen
                name="YardPeriodJobs"
                component={YardPeriodJobsScreen}
                options={{
                  title: 'Yard Period',
                  headerShown: true,
                }}
              />
              <Stack.Screen
                name="AddEditYardJob"
                component={AddEditYardJobScreen}
                options={{
                  title: 'Job',
                  headerShown: true,
                }}
              />
              <Stack.Screen
                name="MaintenanceHome"
                component={MaintenanceHomeScreen}
                options={{
                  title: 'Maintenance',
                  headerShown: true,
                }}
              />
              <Stack.Screen
                name="MaintenanceLog"
                component={MaintenanceLogScreen}
                options={{
                  title: 'Maintenance Log',
                  headerShown: true,
                }}
              />
              <Stack.Screen
                name="AddEditMaintenanceLog"
                component={AddEditMaintenanceLogScreen}
                options={{
                  title: 'Log',
                  headerShown: true,
                }}
              />
              <Stack.Screen
                name="ImportExport"
                component={ImportExportScreen}
                options={{
                  title: 'Import / Export',
                  headerShown: true,
                }}
              />
              <Stack.Screen
                name="WatchKeeping"
                component={WatchKeepingScreen}
                options={{
                  title: 'Watch Keeping',
                  headerShown: true,
                }}
              />
              <Stack.Screen
                name="HoursOfRest"
                component={HoursOfRestScreen}
                options={{
                  title: 'Hours of Rest',
                  headerShown: true,
                }}
              />
              <Stack.Screen
                name="WatchDuties"
                component={WatchDutiesScreen}
                options={{
                  title: 'Watch Duties',
                  headerShown: true,
                }}
              />
              <Stack.Screen
                name="SignatureSetup"
                component={SignatureSetupScreen}
                options={{
                  title: 'E-Signature',
                  headerShown: true,
                }}
              />
              <Stack.Screen
                name="RestDayEntry"
                component={RestDayEntryScreen}
                options={{
                  title: 'Rest Entry',
                  headerShown: true,
                }}
              />
              <Stack.Screen
                name="RestToBeConfirmed"
                component={RestToBeConfirmedScreen}
                options={{
                  title: 'Rest to be Confirmed',
                  headerShown: true,
                }}
              />
              <Stack.Screen
                name="WatchSchedule"
                component={WatchScheduleScreen}
                options={{
                  title: 'Watch Schedule',
                  headerShown: true,
                }}
              />
              <Stack.Screen
                name="WatchScheduleDetail"
                component={WatchScheduleDetailScreen}
                options={{
                  title: 'Watch Schedule',
                  headerShown: true,
                }}
              />
              <Stack.Screen
                name="CreateWatchTimetable"
                component={CreateWatchTimetableScreen}
                options={{
                  title: 'Create',
                  headerShown: true,
                }}
              />
              <Stack.Screen
                name="ShoppingListCategory"
                component={ShoppingListCategoryScreen}
                options={{
                  title: 'Shopping List',
                  headerShown: true,
                }}
              />
              <Stack.Screen
                name="ShoppingList"
                component={ShoppingListScreen}
                options={({ route }: any) => ({
                  title: route.params?.listType === 'trip' ? 'Trip Shopping' : 'General Shopping',
                  headerShown: true,
                })}
              />
              <Stack.Screen
                name="AddEditShoppingList"
                component={AddEditShoppingListScreen}
                options={{
                  title: 'Shopping List',
                  headerShown: true,
                }}
              />
              <Stack.Screen
                name="Inventory"
                component={InventoryScreen}
                options={{
                  title: 'Inventory',
                  headerShown: true,
                }}
              />
              <Stack.Screen
                name="AddEditInventoryItem"
                component={AddEditInventoryItemScreen}
                options={({ route }: any) => ({
                  title: route.params?.itemId ? 'Edit' : 'Create',
                  headerShown: true,
                })}
              />
              <Stack.Screen
                name="Uniforms"
                component={UniformsScreen}
                options={{
                  title: 'Uniforms',
                  headerShown: true,
                }}
              />
              <Stack.Screen
                name="AddEditUniform"
                component={AddEditUniformScreen}
                options={({ route }: any) => ({
                  title: route.params?.uniformId ? 'Edit' : 'Create',
                  headerShown: true,
                })}
              />
              <Stack.Screen
                name="DepartmentColorSettings"
                component={DepartmentColorSettingsScreen}
                options={{
                  title: 'Department colors',
                  headerShown: true,
                }}
              />
              <Stack.Screen
                name="ThemeSettings"
                component={ThemeSettingsScreen}
                options={{
                  title: 'Appearance',
                  headerShown: true,
                }}
              />
              <Stack.Screen
                name="NotificationSettings"
                component={NotificationSettingsScreen}
                options={{
                  title: 'Notifications',
                  headerShown: true,
                }}
              />
              <Stack.Screen
                name="TermsConditions"
                component={TermsConditionsScreen}
                options={{
                  title: 'Terms & Conditions',
                  headerShown: true,
                }}
              />
              <Stack.Screen
                name="PrivacyPolicy"
                component={PrivacyPolicyScreen}
                options={{
                  title: 'Privacy Policy',
                  headerShown: true,
                }}
              />
              <Stack.Screen
                name="RefundPolicy"
                component={RefundPolicyScreen}
                options={{
                  title: 'Refund Policy',
                  headerShown: true,
                }}
              />
              <Stack.Screen
                name="VesselLogs"
                component={VesselLogsScreen}
                options={{
                  title: 'Vessel Logs',
                  headerShown: true,
                }}
              />
              <Stack.Screen
                name="GeneralWasteLog"
                component={GeneralWasteLogScreen}
                options={{
                  title: 'General Waste Log',
                  headerShown: true,
                }}
              />
              <Stack.Screen
                name="AddEditGeneralWasteLog"
                component={AddEditGeneralWasteLogScreen}
                options={{
                  title: 'New Waste Log Entry',
                  headerShown: true,
                }}
              />
              <Stack.Screen
                name="FuelLog"
                component={FuelLogScreen}
                options={{
                  title: 'Fuel Log',
                  headerShown: true,
                }}
              />
              <Stack.Screen
                name="AddEditFuelLog"
                component={AddEditFuelLogScreen}
                options={{
                  title: 'New Fuel Log Entry',
                  headerShown: true,
                }}
              />
              <Stack.Screen
                name="PumpOutLog"
                component={PumpOutLogScreen}
                options={{
                  title: 'Pump Out Log',
                  headerShown: true,
                }}
              />
              <Stack.Screen
                name="AddEditPumpOutLog"
                component={AddEditPumpOutLogScreen}
                options={{
                  title: 'New Pump Out Entry',
                  headerShown: true,
                }}
              />
              <Stack.Screen
                name="ContractorDatabase"
                component={ContractorDatabaseScreen}
                options={{
                  title: 'Contractor Database',
                  headerShown: true,
                }}
              />
              <Stack.Screen
                name="FutureUpdates"
              component={FutureUpdatesScreen}
              options={{ title: 'Future Updates', headerShown: true }}
            />
            <Stack.Screen
              name="Notepad"
              component={NotepadScreen}
              options={{ title: 'Notepad', headerShown: true }}
            />
            <Stack.Screen
              name="AddEditNote"
              component={AddEditNoteScreen}
              options={({ route }: any) => ({
                title: route.params?.noteId ? 'Edit Note' : 'New Note',
                headerShown: true,
              })}
            />
            <Stack.Screen
              name="AddEditContractor"
                component={AddEditContractorScreen}
                options={({ route }: any) => ({
                  title: route.params?.contractorId ? 'Edit Contractor' : 'New Contractor',
                  headerShown: true,
                })}
              />
            </>
          )}
        </Stack.Navigator>
      </PostHogProvider>
    </NavigationContainer>
  );
};

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLORS.background,
  },
});
