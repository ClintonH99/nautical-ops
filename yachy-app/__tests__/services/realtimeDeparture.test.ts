const mockOn = jest.fn();
const mockSubscribe = jest.fn();
const mockChannel = { on: mockOn, subscribe: mockSubscribe };
jest.mock('../../src/services/supabase', () => ({
  supabase: { channel: () => mockChannel, removeChannel: jest.fn() },
}));
import { startRealtimeSync, stopRealtimeSync } from '../../src/services/realtimeSync';

describe('departure profile realtime update', () => {
  beforeEach(() => {
    mockOn.mockClear().mockReturnValue(mockChannel);
  });
  afterEach(() => stopRealtimeSync());
  it('passes the independent Crew state and creation permission to navigation', async () => {
    const updated = jest.fn();
    startRealtimeSync('user', 'old-vessel', { onUserUpdated: updated });
    const callback = mockOn.mock.calls[0][2];
    await callback({
      eventType: 'UPDATE',
      new: {
        id: 'user',
        role: 'CREW',
        vessel_id: 'private-workspace',
        vessel_creation_unlocked: true,
        contract_type: 'permanent',
        rotation_group_id: null,
        department_2: null,
      },
    });
    expect(updated).toHaveBeenCalledWith(
      expect.objectContaining({
        role: 'CREW',
        vesselId: 'private-workspace',
        vesselCreationUnlocked: true,
        contractType: 'permanent',
        rotationGroupId: null,
        department2: null,
      })
    );
  });
  it('does not invent creation permission for old or ordinary profiles', async () => {
    const updated = jest.fn();
    startRealtimeSync('user', 'private', { onUserUpdated: updated });
    await mockOn.mock.calls[0][2]({
      eventType: 'UPDATE',
      new: { id: 'user', role: 'CREW', vessel_id: 'private' },
    });
    expect(updated).toHaveBeenCalledWith(
      expect.objectContaining({ vesselCreationUnlocked: false })
    );
  });
});
