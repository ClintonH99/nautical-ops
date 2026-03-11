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
import vesselService from '../services/vessel';
import { supabase } from '../services/supabase';
import authService from '../services/auth';
import { useAuthStore } from '../store';

const MARITIME = {
  bgDark: '#0f172a',
  textOnDark: '#f8fafc',
  textMuted: '#94a3b8',
  accent: '#0ea5e9',
  gold: '#c9a227',
  cardBg: 'rgba(255, 255, 255, 0.96)',
  cardBorder: 'rgba(255, 255, 255, 0.4)',
};

export const CreateVesselScreen = ({ navigation }: any) => {
  const isAuthenticated = useAuthStore((s) => !!s.user);
  const setUser = useAuthStore((state) => state.setUser);
  const setDeferUserUpdate = useAuthStore((state) => state.setDeferUserUpdate);
  const [vesselName, setVesselName] = useState('');
  useEffect(() => {
    return () => setDeferUserUpdate(false);
  }, []);
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
      // Create the vessel
      const vessel = await vesselService.createVessel({
        name: vesselName.trim(),
      });

      // Per ADMIN/Rules/DEFAULT_VESSEL_BANNER.md: upload default banner for new vessels
      try {
        const asset = Asset.fromModule(require('../../assets/default-vessel-banner.png'));
        await asset.downloadAsync();
        if (asset.localUri) {
          await vesselService.uploadBannerImage(vessel.id, asset.localUri);
        }
      } catch (bannerErr) {
        if (__DEV__) console.warn('Default vessel banner upload failed (non-fatal):', bannerErr);
      }

      // Get current user
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        throw new Error('No authenticated user found');
      }

      // Defer realtime sync from calling setUser until "Go to Home" - prevents stack remount
      setDeferUserUpdate(true);

      // Update user's vessel_id and role to HOD
      const { error: updateError } = await supabase
        .from('users')
        .update({
          vessel_id: vessel.id,
          role: 'HOD',
          updated_at: new Date().toISOString(),
        })
        .eq('id', user.id);

      if (updateError) {
        console.error('Update user error:', updateError);
        throw updateError;
      }

      // Store updated user but defer setUser until "Go to Home" - prevents RootNavigator remount
      // (which clears the form) when user gains vesselId. Per ADMIN rule: show success screen first.
      const updatedUser = await authService.getUserProfile(user.id);
      setPendingUpdatedUser(updatedUser);
      setCreatedVessel(vessel);
    } catch (error: any) {
      console.error('Create vessel error:', error);
      setDeferUserUpdate(false);
      Alert.alert('Error', error.message || 'Failed to create vessel');
    } finally {
      setLoading(false);
    }
  };

  const handleShareInviteCode = async () => {
    if (!createdVessel) return;

    try {
      await Share.share({
        message: `Join ${createdVessel.name} on Nautical Ops!\n\nInvite Code: ${createdVessel.inviteCode}\n\nValid until: ${new Date(createdVessel.inviteExpiry).toLocaleDateString()}`,
        title: `Join ${createdVessel.name}`,
      });
    } catch (error) {
      console.error('Share error:', error);
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
    // Success view – maritime theme
    return (
      <View style={styles.container}>
        <StatusBar barStyle="light-content" backgroundColor={MARITIME.bgDark} />
        <ScrollView
          contentContainerStyle={[styles.scrollContent, { paddingBottom: 120 }]}
          showsVerticalScrollIndicator={false}
        >
          {/* Hero – matches Login/Welcome theme */}
          <View style={styles.hero}>
            <View style={styles.heroBadge}>
              <Ionicons name="boat-outline" size={20} color={MARITIME.gold} />
              <Text style={styles.heroBadgeText}>Nautical Ops</Text>
            </View>
            <Text style={styles.successTitle}>Vessel Created!</Text>
            <Text style={styles.successSubtitle}>{createdVessel.name} is ready to go</Text>
            <View style={styles.heroAccent} />
          </View>

          {/* Instructions - No invite code until subscription paid */}
          <View style={[styles.card, styles.cardTransparent]}>
            <Text style={[styles.successMessage, { color: MARITIME.textOnDark }]}>
              Your vessel is ready. Go to Vessel Settings to choose a plan and get your invite code.
            </Text>
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
            <Text style={[styles.instructionsTitle, { color: MARITIME.textOnDark }]}>
              Next Steps
            </Text>
            <Text style={[styles.instructionText, { color: MARITIME.textOnDark }]}>
              1. Go to Vessel Settings and select a plan
            </Text>
            <Text style={[styles.instructionText, { color: MARITIME.textOnDark }]}>
              2. Complete payment to unlock your invite code
            </Text>
            <Text style={[styles.instructionText, { color: MARITIME.textOnDark }]}>
              3. Share the invite code with your crew members
            </Text>
          </View>

          {/* Action Buttons */}
          <View style={styles.actions}>
            <Button
              title="Go to Vessel Settings"
              onPress={() => navigation.navigate('VesselSettings')}
              fullWidth
              variant="primary"
              style={styles.actionButton}
            />
            <Button
              title="Go to Home"
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

  // Create vessel form – Login-style theme
  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={MARITIME.bgDark} />
      <KeyboardAvoidingView
        style={styles.keyboardView}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Hero – matches Login */}
          <View style={styles.hero}>
            <View style={styles.heroBadge}>
              <Ionicons name="boat-outline" size={20} color={MARITIME.gold} />
              <Text style={styles.heroBadgeText}>Nautical Ops</Text>
            </View>
            <Text style={styles.heroTitle}>Create your vessel</Text>
            <Text style={styles.heroSubtitle}>
              Set up your yacht and get an invite code for your crew
            </Text>
            <View style={styles.heroAccent} />
          </View>

          {/* Form card – matches Login */}
          <View style={[styles.card, styles.cardTransparent]}>
            <Text style={styles.cardTitle}>Create Vessel</Text>
            <Text style={styles.cardSubtitle}>Enter your vessel name to get started</Text>

            <Input
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
              <Text style={[styles.infoText, { color: MARITIME.textMuted }]}>
                ✓ Unique 8-character invite code
              </Text>
              <Text style={[styles.infoText, { color: MARITIME.textMuted }]}>
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

          {/* Footer – only show when unauthenticated (auth stack flow) */}
          {!isAuthenticated && (
            <>
              <View style={styles.footer}>
                <Text style={styles.footerText}>Already have an invite code? </Text>
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
    backgroundColor: MARITIME.bgDark,
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
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: 9999,
    marginBottom: SPACING.lg,
  },
  heroBadgeText: {
    fontSize: FONTS.sm,
    fontWeight: '600',
    color: MARITIME.textOnDark,
    letterSpacing: 0.5,
  },
  heroTitle: {
    fontSize: 36,
    fontWeight: '800',
    color: MARITIME.textOnDark,
    marginBottom: SPACING.sm,
    letterSpacing: -0.5,
  },
  heroSubtitle: {
    fontSize: FONTS.base,
    color: MARITIME.textMuted,
    textAlign: 'center',
    lineHeight: 24,
    maxWidth: 300,
    marginBottom: SPACING.lg,
  },
  heroAccent: {
    width: 48,
    height: 4,
    borderRadius: 2,
    backgroundColor: MARITIME.gold,
    opacity: 0.9,
  },
  card: {
    borderRadius: BORDER_RADIUS.xl,
    padding: SPACING.xl,
    marginBottom: SPACING.xl,
    shadowColor: COLORS.black,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2,
    shadowRadius: 24,
    elevation: 8,
  },
  cardTransparent: {
    backgroundColor: MARITIME.cardBg,
    borderWidth: 1,
    borderColor: MARITIME.cardBorder,
  },
  cardTitle: {
    fontSize: FONTS.xl,
    fontWeight: '700',
    color: COLORS.textPrimary,
    marginBottom: SPACING.xs,
  },
  cardSubtitle: {
    fontSize: FONTS.sm,
    color: COLORS.textSecondary,
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
    color: MARITIME.textMuted,
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
    color: MARITIME.accent,
    textDecorationLine: 'underline',
  },
  // Success view styles – matches Login theme
  successTitle: {
    fontSize: FONTS['2xl'],
    fontWeight: '700',
    color: MARITIME.textOnDark,
    marginBottom: SPACING.sm,
    letterSpacing: -0.5,
    textAlign: 'center',
  },
  successSubtitle: {
    fontSize: FONTS.base,
    color: MARITIME.textMuted,
    textAlign: 'center',
    marginBottom: SPACING.lg,
  },
  successMessage: {
    fontSize: FONTS.lg,
    textAlign: 'center',
    lineHeight: 26,
  },
  inviteCodeLabel: {
    fontSize: FONTS.sm,
    color: COLORS.textSecondary,
    marginBottom: SPACING.md,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  inviteCodeBox: {
    backgroundColor: 'rgba(14, 165, 233, 0.12)',
    paddingVertical: SPACING.lg,
    paddingHorizontal: SPACING.xl,
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 2,
    borderColor: MARITIME.accent,
    borderStyle: 'dashed',
    alignItems: 'center',
  },
  inviteCode: {
    fontSize: 32,
    fontWeight: 'bold',
    color: MARITIME.accent,
    letterSpacing: 4,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  inviteCodeExpiry: {
    fontSize: FONTS.xs,
    marginTop: SPACING.md,
  },
  instructionsTitle: {
    fontSize: FONTS.lg,
    fontWeight: '600',
    color: COLORS.textPrimary,
    marginBottom: SPACING.md,
  },
  instructionText: {
    fontSize: FONTS.base,
    color: COLORS.textSecondary,
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
