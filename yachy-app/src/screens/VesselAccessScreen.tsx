import React, { useRef, useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Button, PageHeader } from '../components';
import { LeaveVesselRecovery } from '../components/LeaveVesselRecovery';
import { useThemeColors } from '../hooks/useThemeColors';
import { useAuthStore } from '../store';
import authService from '../services/auth';
import { evaluateAccountAccess } from '../services/accountAccess';
import { supabase } from '../services/supabase';

/** Only registered in the authenticated, subscription-restricted navigator. */
export function VesselAccessScreen() {
  const colors = useThemeColors();
  const [busy, setBusy] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [notice, setNotice] = useState('');
  const inFlight = useRef(false);
  const user = useAuthStore((state) => state.user);

  const checkAccess = async () => {
    if (inFlight.current || leaving) return;
    inFlight.current = true;
    setBusy(true);
    setNotice('');
    const startingUser = useAuthStore.getState().user;
    try {
      if (!startingUser) return;
      const fresh = await authService.getUserProfile(startingUser.id);
      if (!fresh) throw new Error('Profile unavailable');
      const decision = await evaluateAccountAccess(fresh);
      const store = useAuthStore.getState();
      if (store.user !== startingUser || store.deferUserUpdate) return;
      if (decision.state === 'allowed' || decision.state === 'captain_payment_required') {
        store.setCaptainPaymentRequired(decision.state === 'captain_payment_required');
        store.setUser(fresh);
        store.setCrewPaymentRequired(false);
      } else {
        setNotice(
          decision.state === 'crew_payment_required'
            ? 'The vessel subscription is still inactive. You can check again after your Captain/MOV renews it.'
            : 'We could not confirm access. Please try again.'
        );
      }
    } catch {
      setNotice('Unable to check access. Please check your connection and try again.');
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  const signOut = async () => {
    if (inFlight.current || leaving) return;
    inFlight.current = true;
    setBusy(true);
    try {
      const { error } = await supabase.auth.signOut({ scope: 'local' });
      if (error) throw error;
      useAuthStore.getState().logout();
    } catch {
      setNotice('Unable to sign out. Please try again.');
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <PageHeader title="Vessel Access" showBack={false} />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.brand}>
          <Image
            source={require('../../assets/nautical-ops-vessel-logo.png')}
            style={styles.logo}
          />
          <Text style={[styles.brandText, { color: colors.textPrimary }]}>Nautical Ops</Text>
        </View>
        <View
          style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
        >
          <View style={[styles.icon, { backgroundColor: colors.accentSoft }]}>
            <Ionicons name="lock-closed-outline" size={36} color={colors.accent} />
          </View>
          <Text style={[styles.title, { color: colors.textPrimary }]}>
            Vessel access temporarily unavailable
          </Text>
          <Text style={[styles.body, { color: colors.textSecondary }]}>
            Your vessel’s subscription is inactive. Ask your Captain/MOV to renew it, or leave the
            vessel to continue with your own account.
          </Text>
          <View style={[styles.callout, { backgroundColor: colors.accentSoft }]}>
            <Text style={[styles.subtitle, { color: colors.textPrimary }]}>
              Your personal records stay with you
            </Text>
            <Text style={[styles.body, { color: colors.textSecondary }]}>
              Keep My Sea Miles. The vessel’s records stay with the vessel.
            </Text>
          </View>
        </View>
        {!!notice && (
          <Text
            accessibilityRole="alert"
            style={[styles.body, { color: colors.textSecondary, marginBottom: 16 }]}
          >
            {notice}
          </Text>
        )}
        <Button
          title="Check Access Again"
          onPress={checkAccess}
          disabled={busy || leaving}
          fullWidth
        />
        {(user?.role === 'CREW' || user?.role === 'HOD') && (
          <LeaveVesselRecovery requiresSignIn={false} disabled={busy} onBusyChange={setLeaving} />
        )}
        <Button
          title="Sign Out"
          variant="text"
          onPress={signOut}
          disabled={busy || leaving}
          fullWidth
        />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 24, paddingBottom: 48, width: '100%', maxWidth: 560, alignSelf: 'center' },
  brand: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    marginBottom: 28,
  },
  logo: { width: 48, height: 48, borderRadius: 12 },
  brandText: { fontSize: 23, fontWeight: '700' },
  card: { borderRadius: 22, borderWidth: 1, padding: 24, marginBottom: 24 },
  icon: { padding: 22, borderRadius: 48, alignSelf: 'center', marginBottom: 20 },
  title: { fontSize: 25, fontWeight: '700', textAlign: 'center', marginBottom: 14 },
  body: { fontSize: 15, lineHeight: 23, textAlign: 'center' },
  subtitle: { fontSize: 16, fontWeight: '700', marginBottom: 8, textAlign: 'center' },
  callout: { borderRadius: 14, padding: 16, marginTop: 22 },
});
