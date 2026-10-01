import React, { useRef, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Button } from './Button';
import { Input } from './Input';
import { useThemeColors } from '../hooks/useThemeColors';
import { SPACING, FONTS } from '../constants/theme';
import {
  leaveVesselForAccount,
  isOnlyCaptainError,
  APPOINT_CAPTAIN_TITLE,
  APPOINT_CAPTAIN_MESSAGE,
} from '../services/vesselDeparture';

/** Explicit confirmation; opening this panel never changes membership. */
export function LeaveVesselRecovery({
  requiresSignIn = true,
  disabled = false,
  onBusyChange,
}: {
  requiresSignIn?: boolean;
  disabled?: boolean;
  onBusyChange?: (busy: boolean) => void;
}) {
  const colors = useThemeColors();
  const [expanded, setExpanded] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [error, setError] = useState('');

  const leave = async () => {
    if (inFlight.current || disabled) return;
    if (requiresSignIn && (!email.trim() || !password)) {
      setError('Enter your account email and password to confirm it is you.');
      return;
    }
    inFlight.current = true;
    setBusy(true);
    onBusyChange?.(true);
    setError('');
    try {
      await leaveVesselForAccount(requiresSignIn ? { email: email.trim(), password } : undefined);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Please check your connection and try again.';
      setError(
        isOnlyCaptainError(message)
          ? `${APPOINT_CAPTAIN_TITLE}\n${APPOINT_CAPTAIN_MESSAGE}`
          : message
      );
    } finally {
      setPassword('');
      setBusy(false);
      onBusyChange?.(false);
      inFlight.current = false;
    }
  };

  return (
    <View style={styles.panel}>
      {!expanded ? (
        <>
          <Button
            title="Leave Vessel"
            variant="outline"
            fullWidth
            disabled={disabled}
            onPress={() => setExpanded(true)}
          />
          <Text
            style={[
              styles.body,
              { color: colors.textSecondary, textAlign: 'center', marginTop: SPACING.sm },
            ]}
          >
            You’ll be asked to confirm before leaving.
          </Text>
        </>
      ) : (
        <>
          <Text style={[styles.title, { color: colors.textPrimary }]}>Leave your vessel?</Text>
          <Text style={[styles.body, { color: colors.textSecondary }]}>
            Your My Sea Miles stays with you. You will return to a private Crew account and lose
            access to this vessel’s records. Those records stay with the vessel. Joining again
            requires an invitation.
          </Text>
          {requiresSignIn && (
            <>
              <Input
                forceLight
                label="Account email"
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                editable={!busy}
              />
              <Input
                forceLight
                label="Account password"
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                showPasswordToggle
                autoCapitalize="none"
                editable={!busy}
              />
            </>
          )}
          {!!error && (
            <Text accessibilityRole="alert" style={[styles.body, { color: colors.textPrimary }]}>
              {error}
            </Text>
          )}
          <Button
            title="Confirm and Leave Vessel"
            fullWidth
            onPress={leave}
            loading={busy}
            disabled={disabled || busy}
          />
          <Button
            title="Cancel"
            variant="outline"
            fullWidth
            style={styles.cancel}
            disabled={busy}
            onPress={() => {
              setExpanded(false);
              setPassword('');
              setError('');
            }}
          />
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { marginTop: SPACING.lg },
  title: { fontSize: FONTS.lg, fontWeight: '700', marginBottom: SPACING.sm },
  body: { fontSize: FONTS.sm, lineHeight: 21, marginBottom: SPACING.md },
  cancel: { marginTop: SPACING.sm },
});
