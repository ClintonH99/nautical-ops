import type { ReturnNavigation } from './returnToPreviousPage';
const parents: Readonly<Record<string, string>> = {
  AddEditNote: 'Notepad',
  AddEditPumpOutLog: 'PumpOutLog',
  AddEditGeneralWasteLog: 'GeneralWasteLog',
  AddEditUniform: 'Uniforms',
  AddEditShoppingList: 'ShoppingListCategory',
  AddEditTask: 'Tasks',
  AddEditContractor: 'ContractorDatabase',
  CreateRules: 'Rules',
  CreateSafetyEquipment: 'SafetyEquipment',
  CreateMusterStation: 'MusterStation',
  AddEditYardJob: 'YardPeriodJobs',
  AddEditMaintenanceLog: 'MaintenanceLog',
};
/** A direct URL/reload has no navigation stack. Use only a registered app route. */
export function returnOnWeb(navigation: ReturnNavigation): void {
  if (navigation.canGoBack()) {
    navigation.goBack();
    return;
  }
  const state = navigation.getState(),
    current = state.routes[state.index];
  const tripParents: Readonly<Record<string, string>> = {
    GUEST: 'GuestTrips',
    BOSS: 'BossTrips',
    DELIVERY: 'DeliveryTrips',
    YARD_PERIOD: 'YardPeriodJobs',
  };
  const parent =
    current?.name === 'AddEditTrip'
      ? tripParents[String(current.params?.type)]
      : parents[current?.name];
  if (parent && state.routeNames.includes(parent)) navigation.navigate(parent);
  else if (state.routeNames.includes('MainTabs'))
    navigation.navigate('MainTabs', { screen: 'Home' });
  // A payment-restricted or authentication stack cannot navigate into the app.
}
