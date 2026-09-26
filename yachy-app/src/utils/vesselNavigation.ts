/** Fresh vessel context: never retain the old vessel's screens or creation form. */
export function vesselNavigationState(destination: 'MainTabs' | 'VesselSettings') {
  return destination === 'VesselSettings'
    ? { index: 1, routes: [{ name: 'MainTabs' }, { name: 'VesselSettings' }] }
    : { index: 0, routes: [{ name: 'MainTabs' }] };
}

/** Also recover screens opened at the root by an older build or direct link. */
export function backFromVesselSettings(navigation: {
  canGoBack: () => boolean;
  goBack: () => void;
  reset: (state: ReturnType<typeof vesselNavigationState>) => void;
}) {
  if (navigation.canGoBack()) navigation.goBack();
  else navigation.reset(vesselNavigationState('MainTabs'));
}
