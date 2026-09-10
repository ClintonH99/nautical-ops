/**
 * Vessel service security-path tests
 * @jest-environment node
 */

const mockRpc = jest.fn();
const mockFrom = jest.fn();

jest.mock('../../src/services/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
    from: (...args: unknown[]) => mockFrom(...args),
  },
}));

jest.mock('../../src/utils/fileUpload', () => ({
  readFileBytesForUpload: jest.fn(),
}));

import vesselService from '../../src/services/vessel';

describe('VesselService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('creates a solo Crew workspace through the protected server function', async () => {
    mockRpc.mockResolvedValue({
      data: {
        id: 'solo-vessel',
        name: 'Crew Account',
        invite_code: 'PRIVATE1',
        invite_expiry: '2027-09-10T12:00:00.000Z',
        created_at: '2026-09-10T12:00:00.000Z',
        updated_at: '2026-09-10T12:00:00.000Z',
      },
      error: null,
    });

    const vessel = await vesselService.createVessel({ name: 'Crew Account', isSolo: true });

    expect(mockRpc).toHaveBeenCalledWith('create_solo_vessel_for_current_user');
    expect(mockFrom).not.toHaveBeenCalled();
    expect(vessel).toEqual(expect.objectContaining({ id: 'solo-vessel', name: 'Crew Account' }));
  });
});
