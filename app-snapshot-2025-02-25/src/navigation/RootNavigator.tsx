/**
 * Root Navigation
 * Handles auth flow and main navigation
 */

import React, { useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { ActivityIndicator, View, StyleSheet } from 'react-native';
import { 
  LoginScreen, 
  CreateAccountChoiceScreen,
  RegisterScreen, 
  RegisterCaptainScreen, 
  RegisterCrewScreen, 
  JoinVesselScreen,
  ProfileScreen,
  VesselSettingsScreen,
  CrewManagementScreen,
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
  WatchScheduleScreen,
  CreateWatchTimetableScreen,
  ShoppingListCategoryScreen,
  ShoppingListScreen,
  AddEditShoppingListScreen,
  InventoryScreen,
  AddEditInventoryItemScreen,
  DepartmentColorSettingsScreen,
  ThemeSettingsScreen,
  NotificationSettingsScreen,
  VesselLogsScreen,
  GeneralWasteLogScreen,
  AddEditGeneralWasteLogScreen,
  FuelLogScreen,
  AddEditFuelLogScreen,
  PumpOutLogScreen,
  AddEditPumpOutLogScreen,
  ContractorDatabaseScreen,
  AddEditContractorScreen,
  VesselCrewSafetyScreen,
  MusterStationScreen,
  CreateMusterStationScreen,
  SafetyEquipmentScreen,
  CreateSafetyEquipmentScreen,
  RulesScreen,
  CreateRulesScreen,
} from '../screens';
import { CreateVesselScreen } from '../screens/CreateVesselScreen';
import { MainTabsNavigator } from './MainTabsNavigator';
import { useAuthStore, useDepartmentColorStore, useThemeStore, BACKGROUND_THEMES } from '../store';
import authService from '../services/auth';
import { COLORS } from '../constants/theme';

const Stack = createNativeStackNavigator();

export const RootNavigator = () => {
  const { isAuthenticated, isLoading, setUser, setLoading } = useAuthStore();
  const backgroundTheme = useThemeStore((s) => s.backgroundTheme);
  const themeColors = BACKGROUND_THEMES[backgroundTheme];

  useEffect(() => {
    // Check for existing session on mount
    const checkAuth = async () => {
      try {
        const session = await authService.getSession();
        if (session?.user) {
          const userData = await authService.getUserProfile(session.user.id);
          setUser(userData);
        }
      } catch (error) {
        console.error('Auth check error:', error);
      } finally {
        setLoading(false);
      }
    };

    checkAuth();

    // Listen to auth state changes
    const { data: authListener } = authService.onAuthStateChange((user) => {
      setUser(user);
      setLoading(false);
    });

    // Cleanup
    return () => {
      authListener?.subscription?.unsubscribe();
    };
  }, []);

  const loadDepartmentColorOverrides = useDepartmentColorStore((s) => s.loadOverrides);
  const loadTheme = useThemeStore((s) => s.loadTheme);
  useEffect(() => {
    loadTheme();
    if (isAuthenticated) loadDepartmentColorOverrides();
  }, [isAuthenticated, loadDepartmentColorOverrides, loadTheme]);

  if (isLoading) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: themeColors.background }]}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  return (
    <NavigationContainer>
      <Stack.Navigator
        screenOptions={{
          headerStyle: {
            backgroundColor: themeColors.background,
          },
          headerShadowVisible: false,
          headerTintColor: themeColors.textPrimary,
          headerTitleStyle: {
            fontWeight: 'bold',
          },
          contentStyle: { backgroundColor: themeColors.background },
        }}
      >
        {!isAuthenticated ? (
          // Auth Stack
          <>
            <Stack.Screen 
              name="Login" 
              component={LoginScreen}
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
          </>
        ) : (
          // Main App Stack (tabs = Home, Explore, Profile)
          <>
            <Stack.Screen 
              name="MainTabs" 
              component={MainTabsNavigator}
              options={{ headerShown: false }}
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
              options={{ 
                title: 'Create Vessel',
                headerShown: true,
              }}
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
            <Stack.Screen name="MusterStation" component={MusterStationScreen} options={{ title: 'Muster Station & Duties', headerShown: true }} />
            <Stack.Screen name="CreateMusterStation" component={CreateMusterStationScreen} options={{ title: 'Create Muster Station', headerShown: true }} />
            <Stack.Screen name="SafetyEquipment" component={SafetyEquipmentScreen} options={{ title: 'Safety Equipment', headerShown: true }} />
            <Stack.Screen name="CreateSafetyEquipment" component={CreateSafetyEquipmentScreen} options={{ title: 'Create Safety Equipment', headerShown: true }} />
            <Stack.Screen name="Rules" component={RulesScreen} options={{ title: 'Rules On-Board', headerShown: true }} />
            <Stack.Screen name="CreateRules" component={CreateRulesScreen} options={{ title: 'Create Rules', headerShown: true }} />
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
              name="WatchSchedule" 
              component={WatchScheduleScreen}
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
