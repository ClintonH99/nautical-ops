const mockRpc=jest.fn(); const mockFrom=jest.fn(); const mockPermission=jest.fn(); const mockToken=jest.fn();
jest.mock('expo-notifications',()=>({setNotificationHandler:jest.fn(),getPermissionsAsync:()=>mockPermission(),getExpoPushTokenAsync:()=>mockToken()}));
jest.mock('expo-device',()=>({isDevice:true}));
jest.mock('expo-constants',()=>({__esModule:true,default:{easConfig:{projectId:'project'}}}));
jest.mock('../../src/services/supabase',()=>({supabase:{rpc:(...args:unknown[])=>mockRpc(...args),from:(...args:unknown[])=>mockFrom(...args)}}));
jest.mock('../../src/services/deviceAccess',()=>({getCurrentDeviceFingerprint:async ()=>'installation-123456'}));
import { enablePushForCurrentDevice, savePushToken, syncPushTokenForCurrentDevice, saveNotificationPreference } from '../../src/services/notifications';
const query=(result:unknown)=>{
  const q:any={}; ['select','eq','is'].forEach(key=>q[key]=()=>q); q.maybeSingle=async()=>result; q.single=async()=>result;return q;
};
beforeEach(()=>{jest.clearAllMocks();mockPermission.mockResolvedValue({status:'granted'});mockToken.mockResolvedValue({data:'ExpoPushToken[test]'});mockRpc.mockResolvedValue({data:true,error:null});});
it('does not refresh tokens for an opted-out device',async()=>{
  mockFrom.mockReturnValue(query({data:{push_enabled:false},error:null}));
  await syncPushTokenForCurrentDevice('u'); expect(mockToken).not.toHaveBeenCalled();expect(mockRpc).not.toHaveBeenCalled();
});
it('fails closed when device preference lookup fails',async()=>{
  mockFrom.mockReturnValue(query({data:null,error:{message:'offline'}}));
  await syncPushTokenForCurrentDevice('u');expect(mockToken).not.toHaveBeenCalled();
});
it('refreshes an opted-in device without requesting permission again',async()=>{
  mockFrom.mockReturnValue(query({data:{push_enabled:true},error:null}));
  await syncPushTokenForCurrentDevice('u');expect(mockRpc).toHaveBeenCalledWith('set_current_device_push_token',expect.anything());
});
it('does not rewrite the legacy token when a concurrent opt-out wins',async()=>{
  mockRpc.mockResolvedValue({data:false,error:null});await savePushToken('u','ExpoPushToken[test]');expect(mockFrom).not.toHaveBeenCalled();
});
it('explicit ON atomically enables the device and registers its token',async()=>{
  await enablePushForCurrentDevice('u','ExpoPushToken[test]');
  expect(mockRpc).toHaveBeenCalledWith('enable_current_device_push',{p_device_fingerprint:'installation-123456',p_expo_push_token:'ExpoPushToken[test]'});
});
it('does not reset unrelated preferences when reading them fails',async()=>{
  mockFrom.mockReturnValue(query({data:null,error:new Error('offline')}));
  await expect(saveNotificationPreference('u','tasks',false)).rejects.toThrow('offline');
});
