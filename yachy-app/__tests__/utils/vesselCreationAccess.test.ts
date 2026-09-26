import { canCreateNewVessel, vesselTransitionRoute } from '../../src/utils/access';
import type { User } from '../../src/types';

const profile = (values: Partial<User>) => ({ id: 'user', role: 'CREW', ...values }) as User;

describe('departure-based vessel creation', () => {
  it('clears old-vessel navigation after a departure', () => {
    expect(
      vesselTransitionRoute(
        profile({ vesselId: 'old' }),
        profile({ vesselId: 'solo', vesselCreationUnlocked: true })
      )
    ).toBe('MainTabs');
  });
  it('routes former crew and new Captains to settings after creation', () => {
    const captain = profile({ role: 'CAPTAIN_MOV', vesselId: 'new' });
    expect(
      vesselTransitionRoute(profile({ vesselId: 'solo', vesselCreationUnlocked: true }), captain)
    ).toBe('VesselSettings');
    expect(vesselTransitionRoute(profile({ role: 'CAPTAIN_MOV' }), captain)).toBe('VesselSettings');
    expect(vesselTransitionRoute(null, captain)).toBeNull();
    expect(vesselTransitionRoute(captain, captain)).toBeNull();
  });
  it('allows new Captain signups without a vessel', () => {
    expect(canCreateNewVessel(profile({ role: 'CAPTAIN_MOV' }))).toBe(true);
  });
  it.each(['CREW', 'HOD', 'CAPTAIN_MOV'] as const)('allows an authorized former %s', (role) => {
    expect(
      canCreateNewVessel(profile({ role, vesselId: 'fresh-private', vesselCreationUnlocked: true }))
    ).toBe(true);
  });
  it.each(['CREW', 'HOD', 'CAPTAIN_MOV'] as const)(
    'blocks attached %s without departure permission',
    (role) => {
      expect(canCreateNewVessel(profile({ role, vesselId: 'existing' }))).toBe(false);
    }
  );
  it('blocks new Crew accounts, including accounts with no vessel', () => {
    expect(canCreateNewVessel(profile({}))).toBe(false);
    expect(canCreateNewVessel(profile({ vesselId: 'private' }))).toBe(false);
    expect(canCreateNewVessel(null)).toBe(false);
  });
});
