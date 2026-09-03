/**
 * Root Navigation
 * Handles auth flow and main navigation
 */

import React, { useCallback, useEffect } from 'react';
import {
  NavigationContainer,
  DefaultTheme,
  getStateFromPath,
  useNavigationContainerRef,
} from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
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
import {
  useAuthStore,
  useDepartmentColorStore,
  useThemeStore,
  BACKGROUND_THEMES,
  LOGIN_NOTICE_STORAGE_KEY,
  PAYMENT_RESTRICTION_STORAGE_KEY,
} from '../store';
import authService from '../services/auth';
import { supabase, SUPABASE_AUTH_STORAGE_KEY } from '../services/supabase';
import { startRealtimeSync, stopRealtimeSync } from '../services/realtimeSync';
import {
  evaluateAccountAccess,
  SUBSCRIPTION_PAYMENT_REQUIRED_MESSAGE,
} from '../services/accountAccess';
import { DEVICE_LIMIT_MESSAGE } from '../services/deviceAccess';
import { reconcileAppleSubscription } from '../services/iap';
import { COLORS } from '../constants/theme';
import {
  isSentryEnabled,
  sentryNavigationIntegration,
  setSentryUserContext,
} from '../lib/sentry';

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

const PAYMENT_RESTRICTED_PATHS = {
  VesselPlans: 'vessel-plans',
  TermsConditions: 'terms',
  PrivacyPolicy: 'privacy',
};

const createWebLinkingConfig = (isAuthenticated: boolean, captainPaymentRequired = false) => {
  const screens = !isAuthenticated
    ? AUTH_SCREEN_PATHS
    : captainPaymentRequired
      ? PAYMENT_RESTRICTED_PATHS
      : APP_SCREEN_PATHS;

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
        return getStateFromPath(captainPaymentRequired ? 'vessel-plans' : '', options);
      }

      const resolved = getStateFromPath(cleanedPath, options);
      if (resolved) return resolved;

      // Invalid/protected URL behavior:
      // - logged out -> /login
      // - logged in -> /
      return getStateFromPath(
        isAuthenticated ? (captainPaymentRequired ? 'vessel-plans' : '') : 'login',
        options
      );
    },
  };
};

// ROUTING RULE: Users with an account AND assigned to a vessel always go to Home (MainTabs).
// CaptainWelcome (create vessel) is ONLY for captains who have no vessel yet.
export const RootNavigator = () => {
  const {
    isAuthenticated,
    isLoading,
    setUser,
    setLoading,
    user,
    captainPaymentRequired,
    setCaptainPaymentRequired,
    setLoginNotice,
  } = useAuthStore();
  const isCaptain = user?.role === 'CAPTAIN_MOV';
  const hasVessel = !!user?.vesselId;
  const navigationRef = useNavigationContainerRef();
  // Welcome: logged-out cold start only. Logged-in users skip Welcome (straight to MainTabs / CaptainWelcome).
  // Per ADMIN rule: Crew members never see CaptainWelcome - go straight to MainTabs
  const initialRoute = !isAuthenticated
    ? 'Login'
    : captainPaymentRequired
      ? 'VesselPlans'
      : isCaptain && !hasVessel
        ? 'CaptainWelcome'
        : 'MainTabs';
  const backgroundTheme = useThemeStore((s) => s.backgroundTheme);
  const themeColors = BACKGROUND_THEMES[backgroundTheme];

  const loadTheme = useThemeStore((s) => s.loadTheme);

  useEffect(() => {
    if (isSentryEnabled) {
      sentryNavigationIntegration.registerNavigationContainer(navigationRef);
    }
  }, [navigationRef]);

  useEffect(() => {
    setSentryUserContext(
      user
        ? {
            id: user.id,
            role: user.role,
            vesselId: user.vesselId,
          }
        : null
    );
  }, [user?.id, user?.role, user?.vesselId]);

  const applyAccountAccess = useCallback(
    async (candidate: NonNullable<typeof user>): Promise<boolean> => {
      const decision = await evaluateAccountAccess(candidate);

      if (decision.state === 'unavailable') {
        // A connectivity/backend failure must not create a new restriction or
        // clear one that the server already confirmed earlier.
        setUser(candidate);
        return !useAuthStore.getState().captainPaymentRequired;
      }

      if (decision.state === 'device_limit_reached') {
        setLoginNotice(DEVICE_LIMIT_MESSAGE);
        setCaptainPaymentRequired(false);
        try {
          await supabase.auth.signOut({ scope: 'local' });
        } catch {
          /* best-effort local sign-out */
        }
        setUser(null);
        return false;
      }

      if (decision.state === 'crew_payment_required') {
        setLoginNotice(SUBSCRIPTION_PAYMENT_REQUIRED_MESSAGE);
        setCaptainPaymentRequired(false);
        try {
          await supabase.auth.signOut({ scope: 'local' });
        } catch {
          /* best-effort local sign-out */
        }
        setUser(null);
        return false;
      }

      if (decision.state === 'captain_payment_required') {
        setLoginNotice(null);
        setCaptainPaymentRequired(true);
        setUser(candidate);
        return false;
      }

      setLoginNotice(null);
      setCaptainPaymentRequired(false);
      setUser(candidate);
      return true;
    },
    [setCaptainPaymentRequired, setLoginNotice, setUser]
  );

  useEffect(() => {
    let mounted = true;
    const BOOTSTRAP_MAX_MS = 12000;

    // Phase 1 - local reads only. Nothing here touches the network, so it
    // finishes in milliseconds and the app is on screen before any request
    // is made. This is what makes a cold start feel instant.
    const renderFromCache = async (): Promise<boolean> => {
      await loadTheme().catch(() => {
        /* theme load is non-critical */
      });
      try {
        const [cached, storedAuth, storedNotice, storedPaymentRestriction] = await Promise.all([
          AsyncStorage.getItem('nautical_ops_cached_user'),
          AsyncStorage.getItem(SUPABASE_AUTH_STORAGE_KEY),
          AsyncStorage.getItem(LOGIN_NOTICE_STORAGE_KEY),
          AsyncStorage.getItem(PAYMENT_RESTRICTION_STORAGE_KEY),
        ]);

        if (storedNotice) setLoginNotice(storedNotice);
        if (storedPaymentRestriction === 'true') setCaptainPaymentRequired(true);

        let hasUsableLocalSession = false;
        try {
          const session = storedAuth ? JSON.parse(storedAuth) : null;
          hasUsableLocalSession = Boolean(
            session?.access_token &&
            session?.refresh_token &&
            typeof session?.expires_at === 'number' &&
            session.expires_at * 1000 > Date.now() + 30_000
          );
        } catch {
          /* malformed auth storage is handled as signed out below */
        }

        if (!hasUsableLocalSession) {
          // Do not delete a structurally valid Supabase session merely because
          // its short-lived access token expired. getSession() below can still
          // renew it using the refresh token. We only withhold the cached UI so
          // authenticated screens cannot make requests with the expired token.
          await AsyncStorage.removeItem('nautical_ops_cached_user');
          if (mounted) {
            setUser(null);
            setLoading(false);
          }
          return false;
        }

        if (cached && mounted) {
          const parsed = JSON.parse(cached);
          if (parsed?.id) {
            setUser(parsed);
            setLoading(false);
            return true;
          }
        }
      } catch {
        /* cache is best-effort */
      }
      // No cached user means Login is the safest immediately usable screen.
      // Do not hold first launch behind the network session/profile request.
      if (mounted) setLoading(false);
      return false;
    };

    // Phase 2 - the session check and profile refresh, run behind the UI the
    // user is already looking at. If it turns out the session is dead, the
    // user is corrected out of the app from here.
    const runBootstrap = async (renderedFromCache: boolean) => {
      try {
        const session = await authService.getSession();
        if (!mounted) return;

        if (!session?.user) {
          // Rendered from cache but the session is gone - sign them back out.
          if (renderedFromCache) setUser(null);
          return;
        }

        let userData = renderedFromCache
          ? await authService.getUserProfile(session.user.id)
          : await authService.getUserProfileWithRetry(session.user.id);

        if (mounted && !userData && Platform.OS === 'web') {
          try {
            await supabase.auth.signOut({ scope: 'local' });
          } catch {
            /* best-effort clear of stale web session */
          }
          return;
        }

        if (mounted && userData) {
          const isCaptain = userData.role === 'CAPTAIN_MOV';
          if (isCaptain && !userData.vesselId) {
            const refetch = await authService.getUserProfile(session.user.id);
            if (mounted && refetch?.vesselId) userData = refetch;
          }
          if (mounted) await applyAccountAccess(userData);
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

    let unsubscribeAuth: (() => void) | undefined;

    const handleAuthChange = async (user: Parameters<typeof setUser>[0]) => {
      try {
        // Password reset verifies an OTP, which signs the user in mid-flow.
        // Without this guard the stack remounts and ForgotPasswordScreen is
        // destroyed before the new password is ever set.
        if (useAuthStore.getState().deferUserUpdate) return;
        if (!user) {
          setUser(null);
          return;
        }
        if (user.role === 'CAPTAIN_MOV' && !user.vesselId) {
          const refetch = await authService.getUserProfile(user.id);
          await applyAccountAccess(refetch?.vesselId ? refetch : user);
        } else {
          await applyAccountAccess(user);
        }
      } catch (error) {
        if (__DEV__) console.error('Auth listener error:', error);
      } finally {
        setLoading(false);
      }
    };

    void (async () => {
      const renderedFromCache = await renderFromCache();
      if (!mounted) return;

      try {
        const bootstrap = runBootstrap(renderedFromCache);
        await Promise.race([
          bootstrap,
          new Promise<void>((resolve) => setTimeout(() => resolve(), BOOTSTRAP_MAX_MS)),
        ]);

        // Finish the session refresh/cleanup before subscribing. Registering
        // first makes Supabase run a second INITIAL_SESSION refresh and log an
        // invalid refresh token as a red-screen error in Expo Go.
        await bootstrap;
        if (!mounted) return;

        const { data: authListener } = authService.onAuthStateChange(handleAuthChange);
        unsubscribeAuth = () => authListener?.subscription?.unsubscribe();

        if (
          Platform.OS !== 'web' &&
          AppState.currentState === 'active' &&
          useAuthStore.getState().isAuthenticated
        ) {
          supabase.auth.startAutoRefresh();
        }
      } finally {
        // Only matters on a first launch with no cache. For a returning user
        // loading was already cleared before the network was touched.
        if (mounted) setLoading(false);
      }
    })();

    return () => {
      mounted = false;
      unsubscribeAuth?.();
    };
  }, [
    applyAccountAccess,
    loadTheme,
    setCaptainPaymentRequired,
    setLoading,
    setLoginNotice,
    setUser,
  ]);

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
          if (u) void applyAccountAccess(u);
          else setUser(null);
        },
      });
    }, 0);
    return () => {
      clearTimeout(t);
      stopRealtimeSync();
    };
  }, [applyAccountAccess, isAuthenticated, user?.id, user?.vesselId, setUser]);

  // Subscription/device access is checked on app resume and periodically while
  // open. Restricted Captains are refreshed every 15 seconds so a successful
  // payment unlocks promptly without exposing provider records via Realtime.
  useEffect(() => {
    if (!isAuthenticated || !user) return;
    let active = true;
    let checking = false;

    const checkAccess = async () => {
      if (checking) return;
      checking = true;
      try {
        const currentUser = useAuthStore.getState().user;
        if (active && currentUser) await applyAccountAccess(currentUser);
      } finally {
        checking = false;
      }
    };

    const interval = setInterval(checkAccess, captainPaymentRequired ? 15_000 : 300_000);
    const appStateSubscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void checkAccess();
    });

    return () => {
      active = false;
      clearInterval(interval);
      appStateSubscription.remove();
    };
  }, [applyAccountAccess, captainPaymentRequired, isAuthenticated, user]);

  // Existing Apple subscriptions created before server notifications need one
  // verified refresh to link their transaction chain to the vessel. Run it in
  // the background after first paint, at most once every 24 hours.
  useEffect(() => {
    if (
      Platform.OS !== 'ios' ||
      !isAuthenticated ||
      user?.role !== 'CAPTAIN_MOV' ||
      !user.vesselId
    ) {
      return;
    }

    let active = true;
    const storageKey = `nautical_ops_apple_reconcile_${user.vesselId}`;
    const timer = setTimeout(() => {
      void (async () => {
        const lastAttempt = Number(await AsyncStorage.getItem(storageKey));
        if (Number.isFinite(lastAttempt) && Date.now() - lastAttempt < 24 * 60 * 60 * 1000) return;
        await AsyncStorage.setItem(storageKey, String(Date.now()));
        const refreshed = await reconcileAppleSubscription(user.vesselId!);
        const currentUser = useAuthStore.getState().user;
        if (active && refreshed && currentUser) await applyAccountAccess(currentUser);
      })();
    }, 1500);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [applyAccountAccess, isAuthenticated, user?.role, user?.vesselId]);

  // Resume: restart token auto-refresh and refresh profile after backgrounding (Supabase RN guidance)
  useEffect(() => {
    const onAppStateChange = (state: string) => {
      if (state === 'active') {
        supabase.auth.startAutoRefresh();
        void authService.getSession().then((session) => {
          if (!session?.user?.id) return;
          void authService.getUserProfileWithRetry(session.user.id).then((fresh) => {
            if (fresh) void applyAccountAccess(fresh);
          });
        });
      } else {
        supabase.auth.stopAutoRefresh();
      }
    };

    const sub = AppState.addEventListener('change', onAppStateChange);
    return () => sub.remove();
  }, [applyAccountAccess]);

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

  const webLinking =
    Platform.OS === 'web'
      ? createWebLinkingConfig(isAuthenticated, captainPaymentRequired)
      : undefined;

  return (
    <NavigationContainer
      ref={navigationRef}
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
                options={{ headerShown: false }}
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
                options={{ headerShown: false }}
              />
              <Stack.Screen
                name="PrivacyPolicy"
                component={PrivacyPolicyScreen}
                options={{ headerShown: false }}
              />
              <Stack.Screen
                name="RefundPolicy"
                component={RefundPolicyScreen}
                options={{ headerShown: false }}
              />
            </>
          ) : captainPaymentRequired ? (
            <>
              <Stack.Screen
                name="VesselPlans"
                component={VesselPlansScreen}
                initialParams={{ paymentRestricted: true }}
                options={{ headerShown: false }}
              />
              <Stack.Screen
                name="TermsConditions"
                component={TermsConditionsScreen}
                options={{ headerShown: false }}
              />
              <Stack.Screen
                name="PrivacyPolicy"
                component={PrivacyPolicyScreen}
                options={{ headerShown: false }}
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
                  headerShown: false,
                }}
              />
              <Stack.Screen
                name="CreateVessel"
                component={CreateVesselScreen}
                options={{ headerShown: false }}
              />
              <Stack.Screen name="FAQHelp" component={FAQScreen} options={{ headerShown: false }} />
              <Stack.Screen
                name="Settings"
                component={ProfileScreen}
                options={{ headerShown: false }}
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
                options={{ headerShown: false }}
              />
              <Stack.Screen
                name="CrewManagement"
                component={CrewManagementScreen}
                options={{
                  headerShown: false,
                }}
              />
              <Stack.Screen
                name="RotationalGroups"
                component={RotationalGroupsScreen}
                options={{
                  headerShown: false,
                }}
              />
              <Stack.Screen
                name="UpcomingTrips"
                component={UpcomingTripsScreen}
                options={{ headerShown: false }}
              />
              <Stack.Screen
                name="GuestTrips"
                component={GuestTripsScreen}
                options={{ headerShown: false }}
              />
              <Stack.Screen
                name="BossTrips"
                component={BossTripsScreen}
                options={{ headerShown: false }}
              />
              <Stack.Screen
                name="AddEditTrip"
                component={AddEditTripScreen}
                options={{
                  headerShown: false,
                }}
              />
              <Stack.Screen
                name="VesselCrewSafety"
                component={VesselCrewSafetyScreen}
                options={{ headerShown: false }}
              />
              <Stack.Screen
                name="MusterStation"
                component={MusterStationScreen}
                options={{ headerShown: false }}
              />
              <Stack.Screen
                name="CreateMusterStation"
                component={CreateMusterStationScreen}
                options={{ headerShown: false }}
              />
              <Stack.Screen
                name="SafetyEquipment"
                component={SafetyEquipmentScreen}
                options={{ headerShown: false }}
              />
              <Stack.Screen
                name="CreateSafetyEquipment"
                component={CreateSafetyEquipmentScreen}
                options={{ headerShown: false }}
              />
              <Stack.Screen name="Rules" component={RulesScreen} options={{ headerShown: false }} />
              <Stack.Screen
                name="CreateRules"
                component={CreateRulesScreen}
                options={{ headerShown: false }}
              />
              <Stack.Screen
                name="PreDepartureChecklist"
                component={PreDepartureChecklistScreen}
                options={{
                  headerShown: false,
                }}
              />
              <Stack.Screen
                name="AddEditPreDepartureChecklist"
                component={AddEditPreDepartureChecklistScreen}
                options={{
                  headerShown: false,
                }}
              />
              <Stack.Screen
                name="ViewPreDepartureChecklist"
                component={ViewPreDepartureChecklistScreen}
                options={{ headerShown: false }}
              />
              <Stack.Screen
                name="DeliveryTrips"
                component={DeliveryTripsScreen}
                options={{ headerShown: false }}
              />
              <Stack.Screen
                name="YardPeriodTrips"
                component={YardPeriodTripsScreen}
                options={{
                  headerShown: false,
                }}
              />
              <Stack.Screen
                name="TripColorSettings"
                component={TripColorSettingsScreen}
                options={{ headerShown: false }}
              />
              <Stack.Screen name="Tasks" component={TasksScreen} options={{ headerShown: false }} />
              <Stack.Screen
                name="TasksList"
                component={TasksListScreen}
                options={{
                  headerShown: false,
                }}
              />
              <Stack.Screen
                name="AddEditTask"
                component={AddEditTaskScreen}
                options={{
                  headerShown: false,
                }}
              />
              <Stack.Screen
                name="OverdueTasks"
                component={OverdueTasksScreen}
                options={{
                  headerShown: false,
                }}
              />
              <Stack.Screen
                name="UpcomingTasks"
                component={UpcomingTasksScreen}
                options={{
                  headerShown: false,
                }}
              />
              <Stack.Screen
                name="CompletedTasks"
                component={CompletedTasksScreen}
                options={{
                  headerShown: false,
                }}
              />
              <Stack.Screen
                name="TasksCalendar"
                component={TasksCalendarScreen}
                options={{ headerShown: false }}
              />
              <Stack.Screen
                name="YardPeriodJobs"
                component={YardPeriodJobsScreen}
                options={{
                  // Back button, title and export live in the screen body.
                  headerShown: false,
                }}
              />
              <Stack.Screen
                name="AddEditYardJob"
                component={AddEditYardJobScreen}
                options={{
                  headerShown: false,
                }}
              />
              <Stack.Screen
                name="MaintenanceHome"
                component={MaintenanceHomeScreen}
                options={{ headerShown: false }}
              />
              <Stack.Screen
                name="MaintenanceLog"
                component={MaintenanceLogScreen}
                options={{ headerShown: false }}
              />
              <Stack.Screen
                name="AddEditMaintenanceLog"
                component={AddEditMaintenanceLogScreen}
                options={{
                  headerShown: false,
                }}
              />
              <Stack.Screen
                name="ImportExport"
                component={ImportExportScreen}
                options={{ headerShown: false }}
              />
              <Stack.Screen
                name="WatchKeeping"
                component={WatchKeepingScreen}
                options={{ headerShown: false }}
              />
              <Stack.Screen
                name="HoursOfRest"
                component={HoursOfRestScreen}
                options={{ headerShown: false }}
              />
              <Stack.Screen
                name="WatchDuties"
                component={WatchDutiesScreen}
                options={{ headerShown: false }}
              />
              <Stack.Screen
                name="SignatureSetup"
                component={SignatureSetupScreen}
                options={{
                  headerShown: false,
                }}
              />
              <Stack.Screen
                name="RestDayEntry"
                component={RestDayEntryScreen}
                options={{ headerShown: false }}
              />
              <Stack.Screen
                name="RestToBeConfirmed"
                component={RestToBeConfirmedScreen}
                options={{ headerShown: false }}
              />
              <Stack.Screen
                name="WatchSchedule"
                component={WatchScheduleScreen}
                options={{ headerShown: false }}
              />
              <Stack.Screen
                name="WatchScheduleDetail"
                component={WatchScheduleDetailScreen}
                options={{ headerShown: false }}
              />
              <Stack.Screen
                name="CreateWatchTimetable"
                component={CreateWatchTimetableScreen}
                options={{
                  headerShown: false,
                }}
              />
              <Stack.Screen
                name="ShoppingListCategory"
                component={ShoppingListCategoryScreen}
                options={{
                  // Back button and title both live in the screen body.
                  headerShown: false,
                }}
              />
              <Stack.Screen
                name="ShoppingList"
                component={ShoppingListScreen}
                options={{ headerShown: false }}
              />
              <Stack.Screen
                name="AddEditShoppingList"
                component={AddEditShoppingListScreen}
                options={{
                  headerShown: false,
                }}
              />
              <Stack.Screen
                name="Inventory"
                component={InventoryScreen}
                options={{ headerShown: false }}
              />
              <Stack.Screen
                name="AddEditInventoryItem"
                component={AddEditInventoryItemScreen}
                options={({ route }: any) => ({
                  title: route.params?.itemId ? 'Edit' : 'Create',
                  headerShown: false,
                })}
              />
              <Stack.Screen
                name="Uniforms"
                component={UniformsScreen}
                options={{
                  headerShown: false,
                }}
              />
              <Stack.Screen
                name="AddEditUniform"
                component={AddEditUniformScreen}
                options={({ route }: any) => ({
                  title: route.params?.uniformId ? 'Edit' : 'Create',
                  headerShown: false,
                })}
              />
              <Stack.Screen
                name="DepartmentColorSettings"
                component={DepartmentColorSettingsScreen}
                options={{
                  headerShown: false,
                }}
              />
              <Stack.Screen
                name="ThemeSettings"
                component={ThemeSettingsScreen}
                options={{ headerShown: false }}
              />
              <Stack.Screen
                name="NotificationSettings"
                component={NotificationSettingsScreen}
                options={{ headerShown: false }}
              />
              <Stack.Screen
                name="TermsConditions"
                component={TermsConditionsScreen}
                options={{ headerShown: false }}
              />
              <Stack.Screen
                name="PrivacyPolicy"
                component={PrivacyPolicyScreen}
                options={{ headerShown: false }}
              />
              <Stack.Screen
                name="RefundPolicy"
                component={RefundPolicyScreen}
                options={{ headerShown: false }}
              />
              <Stack.Screen
                name="VesselLogs"
                component={VesselLogsScreen}
                options={{ headerShown: false }}
              />
              <Stack.Screen
                name="GeneralWasteLog"
                component={GeneralWasteLogScreen}
                options={{
                  headerShown: false,
                }}
              />
              <Stack.Screen
                name="AddEditGeneralWasteLog"
                component={AddEditGeneralWasteLogScreen}
                options={{
                  headerShown: false,
                }}
              />
              <Stack.Screen
                name="FuelLog"
                component={FuelLogScreen}
                options={{
                  headerShown: false,
                }}
              />
              <Stack.Screen
                name="AddEditFuelLog"
                component={AddEditFuelLogScreen}
                options={{
                  headerShown: false,
                }}
              />
              <Stack.Screen
                name="PumpOutLog"
                component={PumpOutLogScreen}
                options={{
                  headerShown: false,
                }}
              />
              <Stack.Screen
                name="AddEditPumpOutLog"
                component={AddEditPumpOutLogScreen}
                options={{
                  headerShown: false,
                }}
              />
              <Stack.Screen
                name="ContractorDatabase"
                component={ContractorDatabaseScreen}
                options={{ headerShown: false }}
              />
              <Stack.Screen
                name="FutureUpdates"
                component={FutureUpdatesScreen}
                options={{ headerShown: false }}
              />
              <Stack.Screen
                name="Notepad"
                component={NotepadScreen}
                options={{ headerShown: false }}
              />
              <Stack.Screen
                name="AddEditNote"
                component={AddEditNoteScreen}
                options={{ headerShown: false }}
              />
              <Stack.Screen
                name="AddEditContractor"
                component={AddEditContractorScreen}
                options={{ headerShown: false }}
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
