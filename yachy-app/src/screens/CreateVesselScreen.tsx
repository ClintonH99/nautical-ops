/**
 * Create Vessel Screen
 * Allows first-time users to create their vessel and get an invite code
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Alert,
  TouchableOpacity,
  Share,
  StatusBar,
} from 'react-native';
import { Asset } from 'expo-asset';
import { Ionicons } from '@expo/vector-icons';
import { Button, Input } from '../components';
import { COLORS, FONTS, SPACING, BORDER_RADIUS } from '../constants/theme';
import { useThemeColors } from '../hooks/useThemeColors';
import vesselService from '../services/vessel';
import authService from '../services/auth';
import { useAuthStore } from '../store';
import { usePostHog } from 'posthog-react-native';

const ACCENT_GOLD = '#c9a227';
const MARITIME_BACKGROUND = '#0f172a';
const MARITIME_SURFACE = '#1e293b';
const MARITIME_TEXT = '#f8fafc';
const MARITIME_TEXT_MUTED = '#cbd5e1';

export const CreateVesselScreen = ({ navigation }: any) => {
  const themeColors = useThemeColors();
  const isAuthenticated = useAuthStore((s) => !!s.user);
  const setUser = useAuthStore((state) => state.setUser);
  const setDeferUserUpdate = useAuthStore((state) => state.setDeferUserUpdate);
  const posthog = usePostHog();
  const [vesselName, setVesselName] = useState('');
  useEffect(() => {
    return () => setDeferUserUpdate(false);
  }, [setDeferUserUpdate]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [createdVessel, setCreatedVessel] = useState<any>(null);
  const [pendingUpdatedUser, setPendingUpdatedUser] = useState<any>(null);

  const handleCreateVessel = async () => {
    if (!vesselName.trim()) {
      setError('Vessel name is required');
      return;
    }

    setLoading(true);
    setError('');

    try {
      // The server creates the vessel and assigns this Captain atomically.
      // Defer auth-store realtime updates until the success screen is ready.
      setDeferUserUpdate(true);
      const vessel = await vesselService.createVessel({
        name: vesselName.trim(),
      });

      // The default banner is non-critical. Upload it behind the success screen
      // so users never wait on storage; Home falls back to the bundled image.
      void (async () => {
        try {
          const asset = Asset.fromModule(require('../../assets/default-vessel-banner.png'));
          await asset.downloadAsync();
          if (asset.localUri) {
            await vesselService.uploadBannerImage(vessel.id, asset.localUri);
          }
        } catch (bannerErr) {
          if (__DEV__) console.warn('Default vessel banner upload failed (non-fatal):', bannerErr);
        }
      })();

      const session = await authService.getSession();
      if (!session?.user) throw new Error('No authenticated user found');
      const updatedUser = await authService.getUserProfile(session.user.id);
      setPendingUpdatedUser(updatedUser);
      setCreatedVessel(vessel);
      posthog.capture('vessel_created', {
        vessel_id: vessel.id,
        vessel_name: vessel.name,
      });
    } catch (error: any) {
      console.error('Create vessel error:', error);
      setDeferUserUpdate(false);
      Alert.alert('Error', error.message || 'Failed to create vessel');
    } finally {
      setLoading(false);
    }
  };

  const handleContinue = () => {
    if (createdVessel) {
      setDeferUserUpdate(false);
      if (pendingUpdatedUser) {
        setUser(pendingUpdatedUser);
      }
      navigation.navigate('MainTabs');
    }
  };

  if (createdVessel) {
    return (
      <View style={[styles.container, { backgroundColor: MARITIME_BACKGROUND }]}>
        <StatusBar barStyle="light-content" backgroundColor={MARITIME_BACKGROUND} />
        <ScrollView
          contentContainerStyle={[styles.scrollContent, { paddingBottom: 120 }]}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.hero}>
            <View style={[styles.heroBadge, { backgroundColor: MARITIME_SURFACE }]}>
              <Ionicons name="boat-outline" size={20} color={ACCENT_GOLD} />
              <Text style={[styles.heroBadgeText, { color: MARITIME_TEXT }]}>Nautical Ops</Text>
            </View>
            <Text style={[styles.successTitle, { color: MARITIME_TEXT }]}>Vessel Created!</Text>
            <Text style={[styles.successSubtitle, { color: MARITIME_TEXT_MUTED }]}>
              {createdVessel.name} is ready to go
            </Text>
            <View style={styles.heroAccent} />
          </View>

          <View
            style={[
              styles.infoBox,
              {
                backgroundColor: 'rgba(14, 165, 233, 0.1)',
                borderColor: 'rgba(14, 165, 233, 0.3)',
              },
            ]}
          >
            <Text style={[styles.instructionsTitle, { color: MARITIME_TEXT }]}>Next Steps</Text>
            <Text style={[styles.instructionText, { color: MARITIME_TEXT_MUTED }]}>
              1. Open Settings and go to Vessel Plans to select a plan
            </Text>
            <Text style={[styles.instructionText, { color: MARITIME_TEXT_MUTED }]}>
              2. Complete payment to unlock your invite code
            </Text>
            <Text style={[styles.instructionText, { color: MARITIME_TEXT_MUTED }]}>
              3. Share the invite code with your crew members
            </Text>
            <Text style={[styles.instructionText, { color: MARITIME_TEXT_MUTED }]}>
              Invite Code is accessible in the settings menu.
            </Text>
          </View>

          <View style={styles.actions}>
            <Button
              title="Continue to Dashboard"
              onPress={handleContinue}
              fullWidth
              variant="outlineLight"
              style={styles.actionButton}
            />
          </View>

          {!isAuthenticated && (
            <TouchableOpacity
              onPress={() => navigation.navigate('Login')}
              style={styles.backButton}
            >
              <Text style={styles.backButtonText}>Back to Login</Text>
            </TouchableOpacity>
          )}
        </ScrollView>
      </View>
    );
  }

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
          <View style={styles.hero}>
            <View style={[styles.heroBadge, { backgroundColor: themeColors.surface }]}>
              <Ionicons name="boat-outline" size={20} color={ACCENT_GOLD} />
              <Text style={[styles.heroBadgeText, { color: themeColors.textPrimary }]}>
                Nautical Ops
              </Text>
            </View>
            <Text style={[styles.heroTitle, { color: themeColors.textPrimary }]}>
              Create your vessel
            </Text>
            <Text style={[styles.heroSubtitle, { color: themeColors.textSecondary }]}>
              Set up your yacht and get an invite code for your crew
            </Text>
            <View style={styles.heroAccent} />
          </View>

          <View
            style={[
              styles.card,
              {
                backgroundColor: themeColors.surface,
                borderColor: themeColors.isDark ? 'rgba(255,255,255,0.1)' : COLORS.border,
              },
            ]}
          >
            <Text style={[styles.cardTitle, { color: themeColors.textPrimary }]}>
              Create Vessel
            </Text>
            <Text style={[styles.cardSubtitle, { color: themeColors.textSecondary }]}>
              Enter your vessel name to get started
            </Text>

            <Input
              forceLight
              label="Vessel Name"
              placeholder="e.g., M/Y Excellence, S/Y Adventure"
              value={vesselName}
              onChangeText={(value) => {
                setVesselName(value);
                setError('');
              }}
              error={error}
              autoFocus
            />

            <View
              style={[
                styles.infoBox,
                {
                  backgroundColor: 'rgba(14, 165, 233, 0.1)',
                  borderColor: 'rgba(14, 165, 233, 0.3)',
                },
              ]}
            >
              <Text style={[styles.infoText, { color: themeColors.textSecondary }]}>
                ✓ Unique 8-character invite code
              </Text>
              <Text style={[styles.infoText, { color: themeColors.textSecondary }]}>
                ✓ Share with unlimited crew
              </Text>
            </View>

            <Button
              title="Create Vessel & Get Invite Code"
              onPress={handleCreateVessel}
              loading={loading}
              fullWidth
              variant="primary"
              style={styles.createButton}
            />
          </View>

          {!isAuthenticated && (
            <>
              <View style={styles.footer}>
                <Text style={[styles.footerText, { color: themeColors.textSecondary }]}>
                  Already have an invite code?{' '}
                </Text>
                <Button
                  title="Register"
                  onPress={() => navigation.navigate('Register')}
                  variant="outline"
                  size="small"
                />
              </View>
              <TouchableOpacity
                onPress={() => navigation.navigate('Login')}
                style={styles.backButton}
              >
                <Text style={styles.backButtonText}>Back to Login</Text>
              </TouchableOpacity>
            </>
          )}

          <View style={styles.footerSpacer} />
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
    paddingBottom: 100,
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
  infoBox: {
    padding: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    marginBottom: SPACING.lg,
    borderWidth: 1,
  },
  infoText: {
    fontSize: FONTS.sm,
    marginBottom: SPACING.xs,
    paddingLeft: SPACING.sm,
  },
  createButton: {
    marginTop: SPACING.sm,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: SPACING.lg,
  },
  footerText: {
    fontSize: FONTS.sm,
  },
  footerSpacer: {
    height: 40,
  },
  backButton: {
    marginTop: SPACING.lg,
    alignItems: 'center',
    padding: SPACING.sm,
  },
  backButtonText: {
    fontSize: FONTS.sm,
    color: COLORS.primary,
    textDecorationLine: 'underline',
  },
  successTitle: {
    fontSize: FONTS['2xl'],
    fontWeight: '700',
    marginBottom: SPACING.sm,
    letterSpacing: -0.5,
    textAlign: 'center',
  },
  successSubtitle: {
    fontSize: FONTS.base,
    textAlign: 'center',
    marginBottom: SPACING.lg,
  },
  instructionsTitle: {
    fontSize: FONTS.lg,
    fontWeight: '600',
    marginBottom: SPACING.md,
  },
  instructionText: {
    fontSize: FONTS.base,
    marginBottom: SPACING.sm,
    paddingLeft: SPACING.sm,
  },
  actions: {
    marginBottom: SPACING.lg,
  },
  actionButton: {
    marginBottom: SPACING.md,
  },
});
