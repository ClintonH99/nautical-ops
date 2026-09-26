/**
 * User service security-path tests
 * @jest-environment node
 */

const mockRpc = jest.fn();

jest.mock('../../src/services/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
  },
}));

jest.mock('../../src/utils/fileUpload', () => ({
  readFileBytesForUpload: jest.fn(),
}));

import userService from '../../src/services/user';

describe('UserService Captain crew removal', () => {
  beforeEach(() => jest.clearAllMocks());

  it('uses the protected RPC without requesting the detached profile through RLS', async () => {
    mockRpc.mockResolvedValue({ data: true, error: null });
    await userService.removeCrewMember('crew-1');
    expect(mockRpc).toHaveBeenCalledWith('remove_current_vessel_crew_member', {
      p_user_id: 'crew-1',
    });
  });

  it('propagates server permission errors', async () => {
    const error = { message: 'Only the Captain/MOV can remove crew members', code: 'P0001' };
    mockRpc.mockResolvedValue({ data: null, error });
    await expect(userService.removeCrewMember('crew-1')).rejects.toEqual(error);
  });

  it.each([null, false])(
    'does not claim success without server confirmation (%s)',
    async (data) => {
      mockRpc.mockResolvedValue({ data, error: null });
      await expect(userService.removeCrewMember('crew-1')).rejects.toThrow(
        'Could not confirm crew removal'
      );
    }
  );
});

describe('UserService crew rotation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('assigns rotation through the protected Captain-only function', async () => {
    mockRpc.mockResolvedValue({ data: true, error: null });

    await userService.assignCrewRotation('crew-1');

    expect(mockRpc).toHaveBeenCalledWith('assign_current_vessel_crew_rotation', {
      p_user_id: 'crew-1',
    });
  });

  it('surfaces a rejected rotation assignment', async () => {
    mockRpc.mockResolvedValue({ data: null, error: new Error('Captain required') });

    await expect(userService.assignCrewRotation('crew-1')).rejects.toThrow('Captain required');
  });
});
