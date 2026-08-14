/**
 * Login Screen
 * Maritime / superyacht industry–focused sign-in
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Alert,
  StatusBar,
  TouchableOpacity,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Path } from 'react-native-svg';
import * as AppleAuthentication from 'expo-apple-authentication';
import { Button, Input } from '../components';
import { COLORS, FONTS, SPACING, BORDER_RADIUS } from '../constants/theme';
import { useThemeColors } from '../hooks/useThemeColors';
import authService from '../services/auth';
import { useAuthStore } from '../store';
import { usePostHog } from 'posthog-react-native';

const ACCENT_GOLD = '#c9a227';

/** Google's official four-colour "G", required by their branding guidelines. */
const GoogleG = () => (
  <Svg width={19} height={19} viewBox="0 0 48 48">
    <Path
      fill="#EA4335"
      d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
    />
    <Path
      fill="#4285F4"
      d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
    />
    <Path
      fill="#FBBC05"
      d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24s.92 7.54 2.56 10.78l7.97-6.19z"
    />
    <Path
      fill="#34A853"
      d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
    />
  </Svg>
);

export const LoginScreen = ({ navigation }: any) => {
  const themeColors = useThemeColors();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [socialLoading, setSocialLoading] = useState<'google' | 'apple' | null>(null);

  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState({ email: '', password: '' });

  const setUser = useAuthStore((state) => state.setUser);
  const [loginError, setLoginError] = useState('');
  const posthog = usePostHog();

  const validateForm = () => {
    let valid = true;
    const newErrors = { email: '', password: '' };

    if (!email) {
      newErrors.email = 'Email is required';
      valid = false;
    } else if (!/\S+@\S+\.\S+/.test(email)) {
      newErrors.email = 'Email is invalid';
      valid = false;
    }

    if (!password) {
      newErrors.password = 'Password is required';
      valid = false;
    } else if (password.length < 6) {
      newErrors.password = 'Password must be at least 6 characters';
      valid = false;
    }

    setErrors(newErrors);
    return valid;
  };

  const handleSocialSignIn = async (provider: 'google' | 'apple') => {
    if (socialLoading) return;
    setSocialLoading(provider);
    setLoginError('');
    try {
      const { user } =
        provider === 'google'
          ? await authService.signInWithGoogle()
          : await authService.signInWithApple();
      // A cancelled sign-in returns no user and is not an error.
      if (user) setUser(user);
    } catch (e: any) {
      if (e?.message === 'NO_ACCOUNT') {
        const msg = 'No account found for that sign-in. Please create an account first.';
        setLoginError(msg);
        if (Platform.OS !== 'web') Alert.alert('No account found', msg);
      } else {
        const msg = e?.message || 'Could not sign in. Please try again.';
        setLoginError(msg);
        if (Platform.OS !== 'web') Alert.alert('Sign in failed', msg);
      }
    } finally {
      setSocialLoading(null);
    }
  };

  const handleLogin = async () => {
    setLoginError('');
    if (!validateForm()) return;

    setLoading(true);
    try {
      const { user } = await authService.signIn({ email, password });

      if (user) {
        // TODO: Re-enable subscription check once payment flow is set up
        // const isCaptain = user.role === 'CAPTAIN_MOV';
        // if (!isCaptain && user.vesselId) {
        //   const subscription = await getVesselSubscription(user.vesselId);
        //   if (subscription?.status !== 'active') {
        //     const msg = 'Ensure subscription has been paid by the MOV. Once paid, access will be granted again.';
        //     setLoginError(msg);
        //     if (Platform.OS !== 'web') Alert.alert('Access Restricted', msg);
        //     return;
        //   }
        // }
        posthog.identify(user.id, {
          $set: { email: user.email, name: user.name, role: user.role, position: user.position },
          $set_once: { first_login_date: new Date().toISOString() },
        });
        posthog.capture('user_signed_in', {
          method: 'email',
          role: user.role,
          has_vessel: !!user.vesselId,
        });
        setUser(user);
      } else {
        const msg = 'Email Address or Password is Incorrect, Try Again.';
        setLoginError(msg);
        if (Platform.OS !== 'web') Alert.alert('Error', msg);
      }
    } catch (error: any) {
      const msg = error.message || 'Failed to sign in';
      setLoginError(msg);
      if (Platform.OS !== 'web') Alert.alert('Error', msg);
      else if (typeof window !== 'undefined') window.alert(`Error: ${msg}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: themeColors.background }]}>
      <StatusBar
        barStyle={themeColors.isDark ? 'light-content' : 'dark-content'}
        backgroundColor={themeColors.background}
      />
      <KeyboardAvoidingView
        style={styles.keyboardView}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Hero */}
          <View style={styles.hero}>
            <View style={[styles.heroBadge, { backgroundColor: themeColors.surface }]}>
              <Ionicons name="boat-outline" size={20} color={ACCENT_GOLD} />
              <Text style={[styles.heroBadgeText, { color: themeColors.textPrimary }]}>Nautical Ops</Text>
            </View>
            <Text style={[styles.heroTitle, { color: themeColors.textPrimary }]}>Welcome back</Text>
            <Text style={[styles.heroSubtitle, { color: themeColors.textSecondary }]}>
              Sign in to access your vessel, tasks, and crew—all in one place.
            </Text>
            <View style={styles.heroAccent} />
          </View>

          {/* Sign-in card */}
          <View
            style={[
              styles.card,
              {
                backgroundColor: themeColors.surface,
                borderColor: themeColors.isDark ? 'rgba(255,255,255,0.1)' : COLORS.border,
              },
            ]}
          >
            <Text style={[styles.cardTitle, { color: themeColors.textPrimary }]}>Sign in</Text>
            <Text style={[styles.cardSubtitle, { color: themeColors.textSecondary }]}>
              Enter your credentials to get started
            </Text>

            <Input
              label="Email"
              placeholder="crew@vessel.com"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              error={errors.email}
            />

            <Input
              label="Password"
              placeholder="Your password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              showPasswordToggle
              autoCapitalize="none"
              error={errors.password}
            />

            <Button
              title="Sign in"
              onPress={handleLogin}
              loading={loading}
              fullWidth
              variant="primary"
              style={styles.signInButton}
            />

            {loginError ? <Text style={styles.loginError}>{loginError}</Text> : null}
            <TouchableOpacity
              onPress={() => navigation.navigate('ForgotPassword')}
              style={styles.forgotBtn}
            >
              <Text style={[styles.forgotText, { color: themeColors.textSecondary }]}>
                Forgot password?
              </Text>
            </TouchableOpacity>
          </View>

          {/* Social sign-in - returning users only */}
          <View style={styles.socialSection}>
            <Text style={[styles.socialHint, { color: themeColors.textSecondary }]}>
              Already have an account?
            </Text>
            <TouchableOpacity
              onPress={() => handleSocialSignIn('google')}
              disabled={!!socialLoading}
              activeOpacity={0.8}
              style={[styles.googleButton, !!socialLoading && styles.socialDisabled]}
            >
              <GoogleG />
              <Text style={styles.googleButtonText}>
                {socialLoading === 'google' ? 'Signing in\u2026' : 'Sign in with Google'}
              </Text>
            </TouchableOpacity>
            {Platform.OS === 'ios' && (
              <AppleAuthentication.AppleAuthenticationButton
                buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
                buttonStyle={
                  themeColors.isDark
                    ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE
                    : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK
                }
                cornerRadius={8}
                style={styles.appleButton}
                onPress={() => handleSocialSignIn('apple')}
              />
            )}
          </View>

          {/* Create account */}
          <View style={styles.createSection}>
            <View style={styles.divider}>
              <View
                style={[
                  styles.dividerLine,
                  { backgroundColor: themeColors.isDark ? 'rgba(255,255,255,0.12)' : COLORS.border },
                ]}
              />
              <Text style={[styles.dividerText, { color: themeColors.textSecondary }]}>New here?</Text>
              <View
                style={[
                  styles.dividerLine,
                  { backgroundColor: themeColors.isDark ? 'rgba(255,255,255,0.12)' : COLORS.border },
                ]}
              />
            </View>
            <Text style={[styles.createAccountPrompt, { color: themeColors.textSecondary }]}>
              Create a Captain or Crew Account and Join the Fleet.
            </Text>
            <Button
              title="Create New Account"
              onPress={() => navigation.navigate('CreateAccountChoice')}
              variant="outline"
              fullWidth
              style={styles.createAccountButton}
            />
          </View>

          <View style={styles.footer}>
            <Ionicons name="shield-checkmark-outline" size={14} color={themeColors.textSecondary} />
            <Text style={[styles.footerText, { color: themeColors.textSecondary }]}> An App for Crew from Crew.</Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  keyboardView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: SPACING.xl,
    paddingTop: 56,
    paddingBottom: SPACING['2xl'],
  },
  hero: {
    alignItems: 'center',
    paddingTop: SPACING.xl,
    paddingBottom: SPACING.xl,
  },
  heroBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: 9999,
    marginBottom: SPACING.lg,
  },
  heroBadgeText: {
    fontSize: FONTS.sm,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  heroTitle: {
    fontSize: 36,
    fontWeight: '800',
    marginBottom: SPACING.sm,
    letterSpacing: -0.5,
  },
  heroSubtitle: {
    fontSize: FONTS.base,
    textAlign: 'center',
    lineHeight: 24,
    maxWidth: 300,
    marginBottom: SPACING.lg,
  },
  heroAccent: {
    width: 48,
    height: 4,
    borderRadius: 2,
    backgroundColor: ACCENT_GOLD,
    opacity: 0.9,
  },
  card: {
    borderRadius: BORDER_RADIUS.xl,
    padding: SPACING.xl,
    marginBottom: SPACING.xl,
    borderWidth: 1,
  },
  cardTitle: {
    fontSize: FONTS.xl,
    fontWeight: '700',
    marginBottom: SPACING.xs,
  },
  cardSubtitle: {
    fontSize: FONTS.sm,
    marginBottom: SPACING.lg,
  },
  signInButton: {
    marginTop: SPACING.md,
  },
  socialSection: { marginTop: 20 },
  socialHint: { fontSize: 13, textAlign: 'center', marginBottom: 10 },
  googleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    height: 48,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#dadce0',
    borderRadius: 8,
    marginBottom: 10,
  },
  googleButtonText: { fontSize: 15, fontWeight: '500', color: '#3c4043' },
  appleButton: { height: 48, width: '100%', marginBottom: 10 },
  socialDisabled: { opacity: 0.6 },
  forgotBtn: { marginTop: 14, alignItems: 'center', paddingVertical: 6 },
  forgotText: { fontSize: 14, fontWeight: '600' },
  loginError: {
    marginTop: SPACING.md,
    fontSize: FONTS.sm,
    color: COLORS.danger,
    textAlign: 'center',
  },
  createSection: {
    marginBottom: SPACING.xl,
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: SPACING.md,
  },
  dividerLine: {
    flex: 1,
    height: 1,
  },
  dividerText: {
    fontSize: FONTS.sm,
    marginHorizontal: SPACING.md,
    fontWeight: '600',
  },
  createAccountPrompt: {
    fontSize: FONTS.sm,
    textAlign: 'center',
    marginBottom: SPACING.md,
    lineHeight: 20,
  },
  createAccountButton: {},
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: SPACING.lg,
  },
  footerText: {
    fontSize: FONTS.xs,
  },
});
