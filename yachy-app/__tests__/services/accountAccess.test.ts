const mockRegisterCurrentDevice = jest.fn();
const mockGetVesselSubscriptionAccess = jest.fn();

jest.mock('../../src/services/deviceAccess', () => ({
  registerCurrentDevice: (...args: unknown[]) => mockRegisterCurrentDevice(...args),
}));

jest.mock('../../src/services/subscription', () => ({
  getVesselSubscriptionAccess: (...args: unknown[]) => mockGetVesselSubscriptionAccess(...args),
}));

import { evaluateAccountAccess } from '../../src/services/accountAccess';
import type { User } from '../../src/types';

const crew = {
  id: 'crew-1',
  role: 'CREW',
  vesselId: 'vessel-1',
} as User;

const captain = {
  id: 'captain-1',
  role: 'CAPTAIN_MOV',
  vesselId: 'vessel-1',
} as User;

describe('evaluateAccountAccess', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRegisterCurrentDevice.mockResolvedValue({ state: 'allowed', activeDeviceCount: 1 });
    mockGetVesselSubscriptionAccess.mockResolvedValue({
      state: 'entitled',
      subscription: {},
    });
  });

  it('blocks the third active device before checking the subscription', async () => {
    mockRegisterCurrentDevice.mockResolvedValue({
      state: 'limit_reached',
      activeDeviceCount: 2,
    });

    await expect(evaluateAccountAccess(crew)).resolves.toEqual({
      state: 'device_limit_reached',
    });
    expect(mockGetVesselSubscriptionAccess).not.toHaveBeenCalled();
  });

  it('allows normal access throughout the grace period', async () => {
    mockGetVesselSubscriptionAccess.mockResolvedValue({
      state: 'grace_period',
      subscription: {},
    });

    await expect(evaluateAccountAccess(crew)).resolves.toEqual({ state: 'allowed' });
  });

  it('signs crew out after provider-confirmed non-payment', async () => {
    mockGetVesselSubscriptionAccess.mockResolvedValue({
      state: 'payment_required',
      subscription: {},
    });

    await expect(evaluateAccountAccess(crew)).resolves.toEqual({
      state: 'crew_payment_required',
    });
  });

  it('restricts the Captain to Vessel Plans after provider-confirmed non-payment', async () => {
    mockGetVesselSubscriptionAccess.mockResolvedValue({
      state: 'payment_required',
      subscription: {},
    });

    await expect(evaluateAccountAccess(captain)).resolves.toEqual({
      state: 'captain_payment_required',
    });
  });

  it('does not interpret an unavailable provider/backend check as non-payment', async () => {
    mockGetVesselSubscriptionAccess.mockResolvedValue({
      state: 'unavailable',
      subscription: null,
    });

    await expect(evaluateAccountAccess(crew)).resolves.toEqual({ state: 'unavailable' });
  });
});
