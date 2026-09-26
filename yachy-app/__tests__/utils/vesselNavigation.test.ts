import { CommonActions, StackRouter } from '@react-navigation/routers';
import { backFromVesselSettings, vesselNavigationState } from '../../src/utils/vesselNavigation';

describe('vessel creation back navigation', () => {
  const router = StackRouter({ initialRouteName: 'MainTabs' });
  const options = {
    routeNames: ['MainTabs', 'CreateVessel', 'VesselSettings'],
    routeParamList: {},
    routeGetIdList: {},
  };

  it('handles GO_BACK after creation and returns Home, never to the creation form', () => {
    const state = router.getRehydratedState(
      { stale: true, ...vesselNavigationState('VesselSettings') },
      options
    );
    expect(state.routes[state.index].name).toBe('VesselSettings');
    const back = router.getStateForAction(state, CommonActions.goBack(), options);
    expect(back).not.toBeNull();
    expect(back?.index).toBe(0);
    expect(back?.routes.map((route) => route.name)).toEqual(['MainTabs']);
  });

  it('leaves departure resets at Home without old-vessel history', () => {
    expect(vesselNavigationState('MainTabs')).toEqual({ index: 0, routes: [{ name: 'MainTabs' }] });
  });

  it('recovers an already-stranded Vessel Settings screen without dispatching GO_BACK', () => {
    const navigation = { canGoBack: () => false, goBack: jest.fn(), reset: jest.fn() };
    backFromVesselSettings(navigation);
    expect(navigation.goBack).not.toHaveBeenCalled();
    expect(navigation.reset).toHaveBeenCalledWith(vesselNavigationState('MainTabs'));
  });

  it('preserves normal back behaviour when a previous screen exists', () => {
    const navigation = { canGoBack: () => true, goBack: jest.fn(), reset: jest.fn() };
    backFromVesselSettings(navigation);
    expect(navigation.goBack).toHaveBeenCalledTimes(1);
    expect(navigation.reset).not.toHaveBeenCalled();
  });
});
