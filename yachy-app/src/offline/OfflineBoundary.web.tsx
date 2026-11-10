import { supportsOfflineRoute } from './routes';
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useAuthStore } from '../store';
import { useThemeColors } from '../hooks/useThemeColors';
import {
  prepareOffline,
  checkOfflineAccess,
  syncOffline,
  useOfflineStatus,
  useOfflineRoute,
  webOfflineEnabled,
  keepBothNoteCopies,
  recoverSavedNotes,
} from './runtime.web';
import { registerOfflineShell } from './registerShell.web';

export function OfflineBoundary({ children }: { children: React.ReactNode }) {
  const user = useAuthStore((state) => state.user);
  const state = useOfflineStatus();
  const colors = useThemeColors();
  const route = useOfflineRoute((state) => state.name);
  const [resolving, setResolving] = useState<string | null>(null);
  const keepBoth = async (id: string) => {
    setResolving(id);
    try {
      await keepBothNoteCopies(id);
    } catch {
      useOfflineStatus.setState({
        issue: 'The device copy is still saved. Please retry after reconnecting.',
      });
    } finally {
      setResolving(null);
    }
  };
  const recover = async () => {
    setResolving('recover');
    try {
      await recoverSavedNotes();
    } catch {
      useOfflineStatus.setState({
        issue: 'Saved edits are still kept. Reconnect and verify access before recovering them.',
      });
    } finally {
      setResolving(null);
    }
  };
  useEffect(() => {
    if (!webOfflineEnabled) return;
    useOfflineStatus.setState({ shellState: 'preparing' });
    void registerOfflineShell().then((ready) =>
      useOfflineStatus.setState({ shellState: ready ? 'ready' : 'unavailable' })
    );
    void prepareOffline(useAuthStore.getState().user);
  }, [user?.id, user?.vesselId]);
  useEffect(() => {
    if (!webOfflineEnabled || !user?.id) return;
    const update = () => {
      void checkOfflineAccess();
    };
    const offline = () => {
      useOfflineStatus.setState({ disconnected: true });
      update();
    };
    const online = () => {
      void syncOffline();
    };
    const visibility = () => {
      if (document.visibilityState === 'visible') {
        update();
        if (navigator.onLine) online();
      }
    };
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (useOfflineStatus.getState().saving === 0) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', beforeUnload);
    window.addEventListener('offline', offline);
    window.addEventListener('online', online);
    window.addEventListener('popstate', update);
    document.addEventListener('visibilitychange', visibility);
    const timer = setInterval(update, 15000);
    const retry = setInterval(() => {
      if (navigator.onLine && document.visibilityState === 'visible') online();
    }, 60000);
    return () => {
      clearInterval(timer);
      clearInterval(retry);
      window.removeEventListener('beforeunload', beforeUnload);
      window.removeEventListener('offline', offline);
      window.removeEventListener('online', online);
      window.removeEventListener('popstate', update);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [user?.id]);
  if (!webOfflineEnabled || !user?.vesselId) return children;
  const supported = supportsOfflineRoute(route, location.pathname);
  const blocked = state.disconnected && (!state.ready || !supported);
  return (
    <View style={styles.root}>
      {(state.disconnected ||
        state.pending > 0 ||
        state.saving > 0 ||
        state.shellState !== 'ready' ||
        state.issue ||
        state.recoverable > 0) && (
        <View
          style={[styles.banner, { backgroundColor: colors.surface, borderColor: colors.border }]}
          accessibilityLiveRegion="polite"
        >
          <Text style={{ color: colors.textPrimary }}>
            {state.disconnected ? 'Offline' : 'Connected'} · {state.pending}{' '}
            {state.pending === 1 ? 'change' : 'changes'} saved on this device
            {state.pending ? ' · Waiting to sync' : ''}
          </Text>
          {state.saving > 0 && (
            <Text style={{ color: colors.textPrimary }}>
              Saving on this device… Please keep this page open.
            </Text>
          )}
          {state.shellState !== 'ready' && (
            <Text style={{ color: colors.textSecondary }}>
              {state.shellState === 'preparing'
                ? 'Downloading offline pages. Keep this page open.'
                : 'Offline page download is incomplete. Reconnect before closing the app.'}
            </Text>
          )}
          {state.issue && <Text style={{ color: colors.textSecondary }}>{state.issue}</Text>}
          {state.conflicts.map((conflict) => (
            <View key={conflict.id} style={{ gap: 4 }}>
              <Text style={{ color: colors.textPrimary }}>
                {conflict.canFork === false
                  ? 'Watch rules changed on another device. Your edits are kept here until the rules can be reconciled.'
                  : `${conflict.title}: changed on another device. Keep the online record and save your edits as a separate device copy.`}
              </Text>
              {conflict.canFork !== false && (
                <TouchableOpacity
                  accessibilityRole="button"
                  disabled={resolving !== null}
                  onPress={() => void keepBoth(conflict.id)}
                >
                  <Text style={{ color: colors.textPrimary, textDecorationLine: 'underline' }}>
                    {resolving === conflict.id ? 'Saving copy…' : 'Keep both copies'}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          ))}
          {state.recoverable > 0 && (
            <View style={{ gap: 4 }}>
              <Text style={{ color: colors.textPrimary }}>
                {state.recoverable} saved edits from an earlier sign-in are still on this device.
              </Text>
              {!state.disconnected && (
                <TouchableOpacity
                  accessibilityRole="button"
                  disabled={resolving !== null}
                  onPress={() => void recover()}
                >
                  <Text style={{ color: colors.textPrimary, textDecorationLine: 'underline' }}>
                    Recover saved edits
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          )}
          {navigator.onLine && (
            <TouchableOpacity accessibilityRole="button" onPress={() => void syncOffline()}>
              <Text style={{ color: colors.textPrimary, textDecorationLine: 'underline' }}>
                Retry Sync
              </Text>
            </TouchableOpacity>
          )}
        </View>
      )}
      <View
        style={[styles.root, blocked && styles.hidden]}
        pointerEvents={blocked ? 'none' : 'auto'}
        accessibilityElementsHidden={blocked}
        importantForAccessibility={blocked ? 'no-hide-descendants' : 'auto'}
      >
        {children}
      </View>
      {blocked && (
        <View style={[styles.block, { backgroundColor: colors.background }]}>
          <Text style={[styles.title, { color: colors.textPrimary }]}>
            {state.ready ? 'This page needs a connection' : 'Reconnect to continue'}
          </Text>
          <Text style={{ color: colors.textSecondary, textAlign: 'center' }}>
            Your pending edits remain saved on this device.
            {state.ready
              ? ' Open a downloaded page such as Notepad. This test build does not yet support every page offline.'
              : ' Connect to the internet to verify your access.'}
          </Text>
          {state.ready && (
            <TouchableOpacity accessibilityRole="link" onPress={() => location.assign('/notepad')}>
              <Text
                style={{
                  color: colors.textPrimary,
                  textDecorationLine: 'underline',
                  marginTop: 20,
                }}
              >
                Open Notepad
              </Text>
            </TouchableOpacity>
          )}
        </View>
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  root: { flex: 1 },
  banner: { padding: 12, borderBottomWidth: 1, gap: 4 },
  hidden: { opacity: 0 },
  block: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  title: { fontSize: 22, fontWeight: '700', marginBottom: 12 },
});
