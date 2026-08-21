/**
 * Forgot Password Screen
 * Three steps in one screen: request a code, verify it, set a new password.
 * Uses Supabase's OTP recovery flow rather than an emailed link, since
 * deep linking is currently web-only in this app.
 */
import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { COLORS, FONTS, SPACING, SIZES } from '../constants/theme';
import { useThemeColors } from '../hooks/useThemeColors';
import authService from '../services/auth';
import { useAuthStore } from '../store';
import { Input, Button, PageHeader } from '../components';

type Step = 'email' | 'code' | 'password';

export const ForgotPasswordScreen = ({ navigation }: any) => {
  const themeColors = useThemeColors();
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const setDeferUserUpdate = useAuthStore((s) => s.setDeferUserUpdate);

  // verifyOtp signs the user in as a side effect. Hold off any global
  // auth-state updates while this screen is open so the navigator does
  // not remount and drop us out of the flow.
  useEffect(() => {
    setDeferUserUpdate(true);
    return () => setDeferUserUpdate(false);
  }, [setDeferUserUpdate]);

  const handleSendCode = async () => {
    const trimmed = email.trim();
    if (!trimmed || !/\S+@\S+\.\S+/.test(trimmed)) {
      Alert.alert('Check your email', 'Please enter a valid email address.');
      return;
    }
    setLoading(true);
    try {
      await authService.sendPasswordResetCode(trimmed);
      setStep('code');
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Could not send the code. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyCode = async () => {
    // Guard against a double call (keyboard "done" plus button tap). The
    // code is single-use, so a second call always fails as expired.
    if (loading || step !== 'code') return;
    const trimmed = code.trim();
    if (trimmed.length < 6) {
      Alert.alert('Check your code', 'Please enter the 6-digit code from your email.');
      return;
    }
    setLoading(true);
    try {
      await authService.verifyPasswordResetCode(email, trimmed);
      setStep('password');
    } catch (e: any) {
      const msg = (e?.message || '').toLowerCase();
      if (msg.includes('expired')) {
        Alert.alert('Code expired', 'That code has expired. Request a new one and try again.');
      } else {
        Alert.alert('Invalid code', 'That code was not accepted. Please check it and try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSetPassword = async () => {
    if (password.length < 6) {
      Alert.alert('Password too short', 'Please use at least 6 characters.');
      return;
    }
    if (password !== confirmPassword) {
      Alert.alert('Passwords do not match', 'Please make sure both fields match.');
      return;
    }
    setLoading(true);
    try {
      await authService.updatePassword(password);
      await authService.signOut();
      setDeferUserUpdate(false);
      Alert.alert('Password updated', 'You can now sign in with your new password.', [
        { text: 'OK', onPress: () => navigation.navigate('Login') },
      ]);
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Could not update your password. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const titles: Record<Step, string> = {
    email: 'Reset your password',
    code: 'Check your email',
    password: 'Set a new password',
  };
  const subtitles: Record<Step, string> = {
    email: "Enter your email and we'll send you a 6-digit code.",
    code: `We sent a code to ${email} - enter it below.`,
    password: 'Choose a new password for your account.',
  };

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: themeColors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={100}
    >
      <PageHeader title="Reset Password" />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={[styles.title, { color: themeColors.textPrimary }]}>{titles[step]}</Text>
        <Text style={[styles.subtitle, { color: themeColors.textSecondary }]}>{subtitles[step]}</Text>

        {step === 'email' && (
          <>
            <Input
              label="Email"
              value={email}
              onChangeText={setEmail}
              placeholder="crew@vessel.com"
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="send"
              onSubmitEditing={handleSendCode}
            />
            <Button
              title="Send code"
              onPress={handleSendCode}
              variant="primary"
              loading={loading}
              disabled={loading}
              fullWidth
              style={styles.actionBtn}
            />
          </>
        )}

        {step === 'code' && (
          <>
            <Input
              label="6-digit code"
              value={code}
              onChangeText={setCode}
              placeholder="123456"
              keyboardType="number-pad"
              maxLength={6}
              returnKeyType="done"
              onSubmitEditing={handleVerifyCode}
            />
            <Button
              title="Verify code"
              onPress={handleVerifyCode}
              variant="primary"
              loading={loading}
              disabled={loading}
              fullWidth
              style={styles.actionBtn}
            />
            <TouchableOpacity onPress={handleSendCode} disabled={loading} style={styles.linkBtn}>
              <Text style={[styles.linkText, { color: COLORS.primary }]}>Send a new code</Text>
            </TouchableOpacity>
          </>
        )}

        {step === 'password' && (
          <>
            <Input
              label="New password"
              value={password}
              onChangeText={setPassword}
              placeholder="At least 6 characters"
              secureTextEntry
              showPasswordToggle
              autoCapitalize="none"
            />
            <Input
              label="Confirm new password"
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              placeholder="Re-enter your password"
              secureTextEntry
              showPasswordToggle
              autoCapitalize="none"
              returnKeyType="done"
              onSubmitEditing={handleSetPassword}
            />
            <Button
              title="Update password"
              onPress={handleSetPassword}
              variant="primary"
              loading={loading}
              disabled={loading}
              fullWidth
              style={styles.actionBtn}
            />
          </>
        )}

        <TouchableOpacity onPress={() => navigation.navigate('Login')} style={styles.linkBtn}>
          <Text style={[styles.linkText, { color: themeColors.textSecondary }]}>Back to sign in</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: SPACING.lg, paddingBottom: SIZES.bottomScrollPadding, paddingTop: SPACING.xl },
  title: { fontSize: FONTS['2xl'], fontWeight: '700', marginBottom: SPACING.xs, textAlign: 'center' },
  subtitle: { fontSize: FONTS.base, textAlign: 'center', lineHeight: 22, marginBottom: SPACING.xl },
  actionBtn: { marginTop: SPACING.md },
  linkBtn: { marginTop: SPACING.lg, alignItems: 'center', paddingVertical: SPACING.sm },
  linkText: { fontSize: FONTS.sm, fontWeight: '600' },
});
