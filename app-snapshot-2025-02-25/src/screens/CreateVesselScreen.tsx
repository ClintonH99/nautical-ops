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
} from 'react-native';
import { Button, Input } from '../components';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SHADOWS } from '../constants/theme';
import vesselService from '../services/vessel';
import { supabase } from '../services/supabase';
import authService from '../services/auth';
import { useAuthStore } from '../store';
import { useThemeColors } from '../hooks/useThemeColors';
import { useFocusEffect } from '@react-navigation/native';

export const CreateVesselScreen = ({ navigation }: any) => {
  const themeColors = useThemeColors();
  const [vesselName, setVesselName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [createdVessel, setCreatedVessel] = useState<any>(null);
  const setUser = useAuthStore((state) => state.setUser);

  // Reset state when screen comes into focus (new user login)
  useFocusEffect(
    React.useCallback(() => {
      setCreatedVessel(null);
      setVesselName('');
      setError('');
    }, [])
  );

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

      // Get current user
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) {
        throw new Error('No authenticated user found');
      }

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

      // Refresh user data in the store
      const updatedUser = await authService.getUserProfile(user.id);
      if (updatedUser) {
        setUser(updatedUser);
      }

      setCreatedVessel(vessel);
      Alert.alert(
        'Success!',
        `Your vessel "${vessel.name}" has been created!\n\nYou are now the Head of Department.\n\nInvite Code: ${vessel.inviteCode}`,
        [{ text: 'OK' }]
      );
    } catch (error: any) {
      console.error('Create vessel error:', error);
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
      // Navigate to Home screen since user is already logged in
      navigation.navigate('Home');
    }
  };

  if (createdVessel) {
    // Success view - show invite code
    return (
      <View style={[styles.container, { backgroundColor: themeColors.background }]}>
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <View style={styles.content}>
            {/* Success Header */}
            <View style={styles.successHeader}>
              <Text style={styles.successIcon}>⚓</Text>
              <Text style={styles.successTitle}>Vessel Created!</Text>
              <Text style={styles.successSubtitle}>
                {createdVessel.name} is ready to go
              </Text>
            </View>

            {/* Invite Code Display */}
            <View style={styles.inviteCodeCard}>
              <Text style={styles.inviteCodeLabel}>Your Invite Code</Text>
              <View style={styles.inviteCodeBox}>
                <Text style={styles.inviteCode}>{createdVessel.inviteCode}</Text>
              </View>
              <Text style={styles.inviteCodeExpiry}>
                Valid until {new Date(createdVessel.inviteExpiry).toLocaleDateString()}
              </Text>
            </View>

            {/* Instructions */}
            <View style={styles.instructionsCard}>
              <Text style={styles.instructionsTitle}>Next Steps:</Text>
              <Text style={styles.instructionText}>
                1. Share this invite code with your crew members
              </Text>
              <Text style={styles.instructionText}>
                2. Crew can use this code to register and join your vessel
              </Text>
              <Text style={styles.instructionText}>
                3. Start managing your vessel operations!
              </Text>
            </View>

            {/* Action Buttons */}
            <View style={styles.actions}>
              <Button
                title="Share Invite Code"
                onPress={handleShareInviteCode}
                variant="outline"
                fullWidth
                style={styles.actionButton}
              />

              <Button
                title="Go to Home"
                onPress={handleContinue}
                fullWidth
                style={styles.actionButton}
              />
            </View>

            {/* Back to Login */}
            <TouchableOpacity
              onPress={() => navigation.navigate('Login')}
              style={styles.backButton}
            >
              <Text style={styles.backButtonText}>Back to Login</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </View>
    );
  }

  // Create vessel form
  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: themeColors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.content}>
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.icon}>🚢</Text>
            <Text style={styles.title}>Create Your Vessel</Text>
            <Text style={[styles.subtitle, { color: themeColors.textSecondary }]}>
              Set up your yacht and get an invite code for your crew
            </Text>
          </View>

          {/* Info Card */}
          <View style={[styles.infoCard, { backgroundColor: themeColors.surface }]}>
            <Text style={styles.infoTitle}>What you'll get:</Text>
            <Text style={[styles.infoText, { color: themeColors.textSecondary }]}>✓ Unique 8-character invite code</Text>
            <Text style={[styles.infoText, { color: themeColors.textSecondary }]}>✓ Valid for 1 year</Text>
            <Text style={[styles.infoText, { color: themeColors.textSecondary }]}>✓ Share with unlimited crew members</Text>
            <Text style={[styles.infoText, { color: themeColors.textSecondary }]}>✓ Manage all vessel operations</Text>
          </View>

          {/* Form */}
          <View style={styles.form}>
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

            <Button
              title="Create Vessel & Get Invite Code"
              onPress={handleCreateVessel}
              loading={loading}
              fullWidth
              style={styles.createButton}
            />
          </View>

          {/* Footer */}
          <View style={styles.footer}>
            <Text style={styles.footerText}>Already have an invite code? </Text>
            <Button
              title="Register"
              onPress={() => navigation.navigate('Register')}
              variant="outline"
              size="small"
            />
          </View>

          {/* Back to Login */}
          <TouchableOpacity
            onPress={() => navigation.navigate('Login')}
            style={styles.backButton}
          >
            <Text style={styles.backButtonText}>Back to Login</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
  },
  content: {
    flex: 1,
    padding: SPACING.lg,
    paddingTop: SPACING.xl,
  },
  header: {
    marginBottom: SPACING.xl,
    alignItems: 'center',
  },
  icon: {
    fontSize: 64,
    marginBottom: SPACING.md,
  },
  title: {
    fontSize: FONTS['3xl'],
    fontWeight: 'bold',
    color: COLORS.primary,
    marginBottom: SPACING.xs,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: FONTS.base,
    textAlign: 'center',
    paddingHorizontal: SPACING.md,
  },
  infoCard: {
    backgroundColor: COLORS.primaryLight,
    padding: SPACING.lg,
    borderRadius: BORDER_RADIUS.lg,
    marginBottom: SPACING.xl,
    ...SHADOWS.sm,
  },
  infoTitle: {
    fontSize: FONTS.lg,
    fontWeight: '600',
    color: COLORS.primary,
    marginBottom: SPACING.md,
  },
  infoText: {
    fontSize: FONTS.sm,
    color: COLORS.textPrimary,
    marginBottom: SPACING.xs,
    paddingLeft: SPACING.sm,
  },
  form: {
    marginBottom: SPACING.lg,
  },
  createButton: {
    marginTop: SPACING.md,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: SPACING.lg,
  },
  footerText: {
    fontSize: FONTS.sm,
    color: COLORS.textSecondary,
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
  // Success view styles
  successHeader: {
    alignItems: 'center',
    marginBottom: SPACING.xl,
  },
  successIcon: {
    fontSize: 72,
    marginBottom: SPACING.md,
  },
  successTitle: {
    fontSize: FONTS['3xl'],
    fontWeight: 'bold',
    color: COLORS.success,
    marginBottom: SPACING.xs,
  },
  successSubtitle: {
    fontSize: FONTS.lg,
    color: COLORS.textSecondary,
    textAlign: 'center',
  },
  inviteCodeCard: {
    backgroundColor: COLORS.white,
    padding: SPACING.xl,
    borderRadius: BORDER_RADIUS.lg,
    marginBottom: SPACING.xl,
    alignItems: 'center',
    ...SHADOWS.md,
  },
  inviteCodeLabel: {
    fontSize: FONTS.sm,
    color: COLORS.textSecondary,
    marginBottom: SPACING.md,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  inviteCodeBox: {
    backgroundColor: COLORS.primaryLight,
    paddingVertical: SPACING.lg,
    paddingHorizontal: SPACING.xl,
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 2,
    borderColor: COLORS.primary,
    borderStyle: 'dashed',
  },
  inviteCode: {
    fontSize: 32,
    fontWeight: 'bold',
    color: COLORS.primary,
    letterSpacing: 4,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  inviteCodeExpiry: {
    fontSize: FONTS.xs,
    color: COLORS.textSecondary,
    marginTop: SPACING.md,
  },
  instructionsCard: {
    backgroundColor: COLORS.gray50,
    padding: SPACING.lg,
    borderRadius: BORDER_RADIUS.md,
    marginBottom: SPACING.xl,
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
