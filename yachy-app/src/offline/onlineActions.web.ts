import { Alert } from 'react-native';
import { OfflineError } from './access';
import { useOfflineStatus, webOfflineEnabled } from './runtime.web';

/** Wi-Fi being enabled does not prove that the app's server is reachable. */
export function isOfflineConnection(): boolean {
  return webOfflineEnabled && (!navigator.onLine || useOfflineStatus.getState().disconnected);
}
export function requireOnlineAction(): void {
  if (isOfflineConnection()) throw new OfflineError('ONLINE_ONLY');
}
export function allowOnlineAction(action = 'This action'): boolean {
  if (!isOfflineConnection()) return true;
  Alert.alert(
    'Connection required',
    `${action} needs a connection. Your saved offline changes are kept on this device.`
  );
  return false;
}
