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
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Button, Input } from '../components';
import { COLORS, FONTS, SPACING, BORDER_RADIUS } from '../constants/theme';
import { useThemeColors } from '../hooks/useThemeColors';
import authService from '../services/auth';
import { useAuthStore } from '../store';
import { usePostHog } from 'posthog-react-native';

const ACCENT_GOLD = '#c9a227';

export const LoginScreen = ({ navigation }: any) => {
  const themeColors = useThemeColors();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

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

  const handleLogin = async () => {
    setLoginError('');
    if (!validateForm()) return;

    setLoading(true);
    try {
      const { user } = await authService.signIn({ email, password });

      if (user) {
        // TODO: Re-enable subscription check once payment flow is set up
        // const isCaptain = user.role === 'HOD' || user.position?.toLowerCase().includes('captain');
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
