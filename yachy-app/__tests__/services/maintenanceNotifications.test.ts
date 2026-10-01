const mockRpc = jest.fn();
jest.mock('../../src/services/supabase', () => ({
  supabase: { rpc: (...args: unknown[]) => mockRpc(...args) },
}));
import {
  canManageMaintenanceNotifications,
  getMaintenanceRecipients,
  setMaintenanceRecipients,
} from '../../src/services/maintenanceNotifications';
beforeEach(() => jest.clearAllMocks());
it.each(['CAPTAIN_MOV', 'HOD'])('allows %s to manage recipients', (role) => {
  expect(canManageMaintenanceNotifications(role)).toBe(true);
});
it.each(['CREW', 'MANAGEMENT', undefined])('denies other roles (%s)', (role) => {
  expect(canManageMaintenanceNotifications(role)).toBe(false);
});
it('reads a vessel-scoped crew list with named people', async () => {
  const data = {
    crew: [{ id: 'person', name: 'John Doe' }],
    recipientIds: ['person'],
    revision: 2,
  };
  mockRpc.mockResolvedValue({ data, error: null });
  expect(await getMaintenanceRecipients('vessel')).toEqual(data);
  expect(mockRpc).toHaveBeenCalledWith('get_maintenance_notification_recipients', {
    p_vessel_id: 'vessel',
  });
});
it('saves user IDs, not positions, with a concurrency revision', async () => {
  mockRpc.mockResolvedValue({ error: null });
  await setMaintenanceRecipients('vessel', ['a', 'b', 'a'], 3);
  expect(mockRpc).toHaveBeenCalledWith('set_maintenance_notification_recipients', {
    p_vessel_id: 'vessel',
    p_recipient_ids: ['a', 'b'],
    p_revision: 3,
  });
});
it('propagates permission and stale-selection failures', async () => {
  mockRpc.mockResolvedValue({ error: new Error('Not allowed') });
  await expect(setMaintenanceRecipients('vessel', [], 0)).rejects.toThrow('Not allowed');
  await expect(getMaintenanceRecipients('vessel')).rejects.toThrow('Not allowed');
});
