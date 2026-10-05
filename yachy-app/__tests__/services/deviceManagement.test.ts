const mockRpc = jest.fn();
const mockSetSession = jest.fn();
const mockPassword = jest.fn();
const mockOtp = jest.fn();
const mockVerify = jest.fn();
const mockRecoveryRpc = jest.fn();
const mockSignOut = jest.fn();
const mockGetSession = jest.fn();
const mockCreate = jest.fn();
jest.mock('@supabase/supabase-js', () => ({ createClient: (...args: unknown[]) => mockCreate(...args) }));
jest.mock('../../src/services/supabase', () => ({
  SUPABASE_URL: 'https://example.invalid', SUPABASE_ANON_KEY: 'public-test-key',
  supabase: { rpc: (...args: unknown[]) => mockRpc(...args), auth: { setSession: (...args: unknown[]) => mockSetSession(...args) } },
}));
jest.mock('../../src/services/deviceAccess', () => ({
  getCurrentDeviceFingerprint: async () => 'installation-fingerprint', getDeviceLabel: () => 'Test browser',
}));
import { createDeviceRecovery, listAccountDevices, removeAccountDevice } from '../../src/services/deviceManagement';

beforeEach(() => {
  jest.clearAllMocks();
  mockCreate.mockReturnValue({ rpc: mockRecoveryRpc, auth: { signInWithPassword: mockPassword, signInWithOtp: mockOtp, verifyOtp: mockVerify, getSession: mockGetSession, signOut: mockSignOut } });
  mockPassword.mockResolvedValue({ data: { user: { id: 'owner' } } });
  mockOtp.mockResolvedValue({ error: null });
  mockVerify.mockResolvedValue({ data: { user: { id: 'owner' }, session: { access_token: 'otp-token' } } });
  mockGetSession.mockResolvedValue({ data: { session: { access_token: 'otp-token', refresh_token: 'otp-refresh' } } });
  mockRecoveryRpc.mockImplementation(async (name: string) => ({ data: name === 'begin_device_recovery' ? 'challenge-id' : name === 'complete_device_recovery' ? { allowed: true } : [] }));
  mockSetSession.mockResolvedValue({ error: null });
  mockSignOut.mockResolvedValue({});
});

it('uses ephemeral authentication and does not sign the app in before replacement', async () => {
  const recovery = createDeviceRecovery();
  expect(mockCreate.mock.calls[0][2].auth).toMatchObject({ persistSession: false, autoRefreshToken: false, detectSessionInUrl: false });
  await recovery.start(' CREW@example.com ', 'password');
  expect(mockPassword).toHaveBeenCalledWith({ email: 'crew@example.com', password: 'password' });
  expect(mockOtp).toHaveBeenCalledWith({ email: 'crew@example.com', options: { shouldCreateUser: false } });
  await expect(recovery.continueToApp()).rejects.toThrow('Replace a saved device');
  await recovery.verify('123456');
  expect(mockSetSession).not.toHaveBeenCalled();
  await recovery.replace(['old-device']);
  expect(mockRecoveryRpc).toHaveBeenCalledWith('complete_device_recovery', expect.objectContaining({ p_remove_device_ids: ['old-device'], p_challenge: 'challenge-id', p_device_fingerprint: 'installation-fingerprint' }));
  await recovery.continueToApp();
  expect(mockSetSession).toHaveBeenCalledWith({ access_token: 'otp-token', refresh_token: 'otp-refresh' });
  await recovery.dispose();
  expect(mockSignOut).not.toHaveBeenCalled();
});

it('never requests an OTP after incorrect credentials', async () => {
  mockPassword.mockResolvedValue({ data: {}, error: new Error('private provider error') });
  await expect(createDeviceRecovery().start('crew@example.com', 'bad')).rejects.toThrow('Could not verify your account');
  expect(mockOtp).not.toHaveBeenCalled();
  expect(mockRecoveryRpc).not.toHaveBeenCalled();
});

it('does not list devices when verification belongs to another user', async () => {
  const recovery = createDeviceRecovery();
  await recovery.start('crew@example.com', 'password');
  mockVerify.mockResolvedValue({ data: { user: { id: 'other' }, session: {} } });
  await expect(recovery.verify('123456')).rejects.toThrow('invalid or expired');
  expect(mockRecoveryRpc).not.toHaveBeenCalledWith('list_account_devices', expect.anything());
  await expect(recovery.replace(['old-device'])).rejects.toThrow('Verify your email');
});

it('does not unlock the app after failed or ambiguous replacement', async () => {
  const recovery = createDeviceRecovery();
  await recovery.start('crew@example.com', 'password'); await recovery.verify('123456');
  mockRecoveryRpc.mockResolvedValueOnce({ data: null });
  await expect(recovery.replace(['old'])).rejects.toThrow('Could not register');
  await expect(recovery.continueToApp()).rejects.toThrow('Replace a saved device');
  expect(mockSetSession).not.toHaveBeenCalled();
});

it('cancels only the ephemeral session and frees a newly registered slot on cancellation', async () => {
  const recovery = createDeviceRecovery();
  await recovery.start('crew@example.com', 'password'); await recovery.verify('123456'); await recovery.replace(['old']);
  await recovery.dispose();
  expect(mockRecoveryRpc).toHaveBeenCalledWith('revoke_current_device');
  expect(mockSignOut).toHaveBeenCalledWith({ scope: 'local' });
  expect(mockSetSession).not.toHaveBeenCalled();
});

it('does not revoke the adopted session if navigation unmounts during setSession', async () => {
  const recovery = createDeviceRecovery();
  await recovery.start('crew@example.com', 'password'); await recovery.verify('123456'); await recovery.replace(['old']);
  mockSetSession.mockImplementationOnce(async () => { await recovery.dispose(); return {}; });
  await recovery.continueToApp();
  expect(mockSignOut).not.toHaveBeenCalled();
});

it('uses limited management RPCs and requires confirmed removal', async () => {
  mockRpc.mockResolvedValueOnce({ data: [{ id: 'saved' }] });
  await expect(listAccountDevices()).resolves.toEqual([{ id: 'saved' }]);
  mockRpc.mockResolvedValueOnce({ data: false });
  await expect(removeAccountDevice('saved')).rejects.toThrow('Could not confirm');
  expect(mockRpc).toHaveBeenCalledWith('remove_account_device', { p_device_id: 'saved' });
});
