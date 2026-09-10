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
