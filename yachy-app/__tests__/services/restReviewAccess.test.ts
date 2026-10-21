jest.mock('../../src/services/supabase', () => ({ supabase: { rpc: jest.fn() } }));

import { supabase } from '../../src/services/supabase';
import { canManageRestFor } from '../../src/services/restEntries';

describe('Captain-only Hours of Rest review', () => {
  beforeEach(() => jest.resetAllMocks());

  it.each(['CREW', 'HOD', 'MANAGEMENT', ''])(
    'denies %s without consulting legacy assignments',
    async (role) => {
      expect(await canManageRestFor('viewer', role, 'crew', 'vessel')).toBe(false);
      expect(supabase.rpc).not.toHaveBeenCalled();
    }
  );

  it('requires server confirmation even for a cached Captain role', async () => {
    jest.mocked(supabase.rpc).mockResolvedValue({ data: true, error: null } as never);
    expect(await canManageRestFor('captain', 'CAPTAIN_MOV', 'crew', 'vessel')).toBe(true);
    expect(supabase.rpc).toHaveBeenCalledWith('current_user_can_manage_rest_entry', {
      target_user_id: 'crew',
      target_vessel_id: 'vessel',
    });
  });

  it('keeps Captain own-entry review available', async () => {
    jest.mocked(supabase.rpc).mockResolvedValue({ data: true, error: null } as never);
    expect(await canManageRestFor('captain', 'CAPTAIN_MOV', 'captain', 'vessel')).toBe(true);
  });

  it.each([
    { data: false, error: null },
    { data: null, error: null },
    { data: true, error: { message: 'Permission lookup failed' } },
  ])('fails closed on denied, absent or failed permission evidence', async (result) => {
    jest.mocked(supabase.rpc).mockResolvedValue(result as never);
    expect(await canManageRestFor('captain', 'CAPTAIN_MOV', 'crew', 'vessel')).toBe(false);
  });

  it('fails closed on a network exception', async () => {
    jest.mocked(supabase.rpc).mockRejectedValue(new Error('Offline'));
    expect(await canManageRestFor('captain', 'CAPTAIN_MOV', 'crew', 'vessel')).toBe(false);
  });
});
