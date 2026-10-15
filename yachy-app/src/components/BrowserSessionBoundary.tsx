import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Platform } from 'react-native';
import { Button } from './Button';
import { useThemeColors } from '../hooks/useThemeColors';
import { LostDeviceScreen } from '../screens/LostDeviceScreen';
import authService from '../services/auth';
import { supabase, readTransport } from '../services/supabase';
import { useAuthStore } from '../store';
import {
  useBrowserSessionLease,
  expireBrowserSessionUi,
  isBrowserSessionVisible,
  SESSION_HEARTBEAT_MS,
} from '../services/browserSessionLease';

type Session = {
  id: string;
  device_name: string | null;
  platform: string;
  last_seen_at: string;
};

/** Keep the navigator mounted behind the gate so unsaved form state survives.
 * This is UX only: PostgreSQL independently denies unregistered/revoked sessions.
 */
export function BrowserSessionBoundary({
  userId,
  checkAccess,
  children,
}: {
  userId?: string;
  checkAccess: () => Promise<unknown>;
  children: React.ReactNode;
}) {
  const colors = useThemeColors();
  const lease = useBrowserSessionLease();
  const enabled = Platform.OS === 'web' && !!userId && lease.userId === userId;
  const blocked = enabled && lease.status !== 'allowed';
  const [recovering, setRecovering] = useState(false);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [error, setError] = useState('');
  const busy = useRef(false);
  const [checking, setChecking] = useState(false);
  const checkRef = useRef(checkAccess);
  checkRef.current = checkAccess;
  const check = useCallback(async () => {
    if (busy.current || !isBrowserSessionVisible() || useAuthStore.getState().deferUserUpdate)
      return;
    busy.current = true;
    setChecking(true);
    expireBrowserSessionUi();
    try {
      await checkRef.current();
    } catch {
      setError('Could not confirm your session. Check your connection and retry.');
    } finally {
      busy.current = false;
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'web' || !userId || recovering) return;
    // Also discover rollout mode for returning cached/legacy sessions.
    void check();
    const interval = setInterval(() => {
      expireBrowserSessionUi();
      void check();
    }, SESSION_HEARTBEAT_MS);
    const resume = () => {
      expireBrowserSessionUi();
      if (isBrowserSessionVisible()) {
        readTransport.invalidate();
        void check();
      }
    };
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('online', resume);
    window.addEventListener('pageshow', resume);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('online', resume);
      window.removeEventListener('pageshow', resume);
    };
  }, [userId, recovering, check]);

  useEffect(() => {
    if (!enabled || lease.status !== 'allowed' || !Number.isFinite(lease.validUntil)) return;
    // Shield the UI at expiry even if a renewal stalls. Never log out here.
    const timer = setTimeout(expireBrowserSessionUi, Math.max(0, lease.validUntil - Date.now()));
    return () => clearTimeout(timer);
  }, [enabled, lease.status, lease.validUntil]);

  useEffect(() => {
    if (!blocked || recovering) return;
    let active = true;
    setError('');
    void supabase.rpc('list_active_browser_sessions').then(({ data, error: rpcError }) => {
      if (!active) return;
      if (rpcError) setError('Could not load active sessions. Please retry.');
      else setSessions(data ?? []);
    });
    return () => {
      active = false;
    };
  }, [blocked, recovering, lease.status, checking]);

  useEffect(() => {
    if (!blocked) setRecovering(false);
  }, [blocked]);
  useEffect(() => {
    if (!userId)
      useBrowserSessionLease.setState({ userId: null, status: 'checking', validUntil: 0 });
  }, [userId]);

  return (
    <View style={styles.root}>
      <View
        style={[styles.root, blocked && styles.hidden]}
        pointerEvents={blocked ? 'none' : 'auto'}
        accessibilityElementsHidden={blocked}
        importantForAccessibility={blocked ? 'no-hide-descendants' : 'auto'}
      >
        {children}
      </View>
      {blocked && (
        <View style={[styles.overlay, { backgroundColor: colors.background }]}>
          {recovering ? (
            <LostDeviceScreen navigation={{ navigate: () => setRecovering(false) }} />
          ) : (
            <ScrollView contentContainerStyle={styles.content}>
              <Text style={[styles.title, { color: colors.textPrimary }]}>
                {lease.status === 'limited'
                  ? 'Two browsers are already saved'
                  : 'Reconnecting your session'}
              </Text>
              <Text style={[styles.text, { color: colors.textSecondary }]}>
                You are still signed in. Your account supports two saved browsers. Closing a browser
                or leaving it unused does not release its slot.
              </Text>
              <Text style={[styles.text, { color: colors.textSecondary }]}>
                {lease.status === 'limited'
                  ? 'Sign out on another browser to free a slot, or verify your account to replace a saved browser.'
                  : 'We need to confirm an available slot before you continue. Check your connection and retry. Your open page is kept in place.'}
              </Text>
              {sessions.map((session) => (
                <View key={session.id} style={[styles.card, { borderColor: colors.border }]}>
                  <Text style={[styles.name, { color: colors.textPrimary }]}>
                    {session.device_name || session.platform}
                  </Text>
                  <Text style={[styles.text, { color: colors.textSecondary }]}>
                    Last used {new Date(session.last_seen_at).toLocaleString()}. Saved until
                    sign-out or removal.
                  </Text>
                </View>
              ))}
              {error ? (
                <Text accessibilityRole="alert" style={{ color: colors.textPrimary }}>
                  {error}
                </Text>
              ) : null}
              <Button
                title="Check for an available slot"
                onPress={() => void check()}
                loading={checking}
                fullWidth
              />
              <Button
                title="Verify and end another session"
                variant="outline"
                onPress={() => setRecovering(true)}
                fullWidth
              />
              <Button
                title="Sign out"
                variant="text"
                onPress={async () => {
                  try {
                    await authService.signOut();
                    useAuthStore.getState().logout();
                  } catch {
                    setError('Could not sign out. Please retry.');
                  }
                }}
              />
            </ScrollView>
          )}
        </View>
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  root: { flex: 1 },
  hidden: { display: 'none' },
  overlay: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, zIndex: 2147483647 },
  content: {
    padding: 24,
    paddingTop: 48,
    gap: 18,
    maxWidth: 680,
    width: '100%',
    alignSelf: 'center',
  },
  title: { fontSize: 26, fontWeight: '700' },
  text: { fontSize: 16, lineHeight: 24 },
  name: { fontSize: 18, fontWeight: '600' },
  card: { padding: 18, borderWidth: 1, borderRadius: 16, gap: 8 },
});
