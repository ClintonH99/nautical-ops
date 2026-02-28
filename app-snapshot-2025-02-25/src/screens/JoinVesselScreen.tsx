/**
 * Join Vessel Screen
 * Allows users to join a vessel using an invite code
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
} from 'react-native';
import { Button, Input } from '../components';
import { COLORS, FONTS, SPACING, BORDER_RADIUS } from '../constants/theme';
import authService from '../services/auth';
import { useAuthStore } from '../store';
import { useThemeColors } from '../hooks/useThemeColors';

export const JoinVesselScreen = ({ navigation }: any) => {
  const themeColors = useThemeColors();
  const [inviteCode, setInviteCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const { user, setUser } = useAuthStore();

  const handleJoinVessel = async () => {
    if (!inviteCode.trim()) {
      setError('Please enter an invite code');
      return;
    }

    if (!user?.id) {
      Alert.alert('Error', 'User not found. Please log in again.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const updatedUser = await authService.joinVessel(user.id, inviteCode.trim());
      
      if (updatedUser) {
        setUser(updatedUser);
        Alert.alert(
          'Success!',
          'You have successfully joined the vessel.',
          [
            {
              text: 'OK',
              onPress: () => navigation.goBack(),
            },
          ]
        );
      }
    } catch (error: any) {
      console.error('Join vessel error:', error);
      Alert.alert(
        'Error',
        error.message || 'Failed to join vessel. Please check your invite code and try again.'
      );
    } finally {
      setLoading(false);
    }
  };

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
            <Text style={styles.icon}>⚓</Text>
            <Text style={styles.title}>Join a Vessel</Text>
            <Text style={[styles.subtitle, { color: themeColors.textSecondary }]}>
              Enter the invite code provided by your vessel captain
            </Text>
          </View>

          {/* Info Card */}
          <View style={[styles.infoCard, { backgroundColor: themeColors.surface }]}>
            <Text style={styles.infoTitle}>How to get an invite code:</Text>
            <Text style={[styles.infoText, { color: themeColors.textSecondary }]}>
              • Ask your vessel captain for an 8-character invite code
            </Text>
            <Text style={[styles.infoText, { color: themeColors.textSecondary }]}>
              • The code is case-sensitive and expires after 1 year
            </Text>
            <Text style={[styles.infoText, { color: themeColors.textSecondary }]}>
              • Once joined, you'll have access to all vessel features
            </Text>
          </View>

          {/* Form */}
          <View style={styles.form}>
            <Input
              label="Invite Code"
              placeholder="e.g., ABC12345"
              value={inviteCode}
              onChangeText={(value) => {
                setInviteCode(value);
                setError('');
              }}
              autoCapitalize="characters"
              maxLength={8}
              error={error}
            />

            <Button
              title="Join Vessel"
              onPress={handleJoinVessel}
              loading={loading}
              fullWidth
              style={styles.joinButton}
            />
          </View>

          {/* Alternative Option */}
          <View style={styles.alternative}>
            <Text style={[styles.alternativeText, { color: themeColors.textSecondary }]}>
              Don't have a vessel yet?
            </Text>
            <Button
              title="Create Your Own Vessel"
              onPress={() => navigation.navigate('CreateVessel')}
              variant="outline"
              fullWidth
              style={styles.createButton}
            />
          </View>

          {/* Back Button */}
          <Button
            title="Back to Home"
            onPress={() => navigation.goBack()}
            variant="text"
            fullWidth
          />
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
    paddingTop: SPACING.xl * 2,
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
    paddingHorizontal: SPACING.lg,
  },
  infoCard: {
    padding: SPACING.lg,
    borderRadius: BORDER_RADIUS.lg,
    marginBottom: SPACING.xl,
    shadowColor: COLORS.black,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  infoTitle: {
    fontSize: FONTS.base,
    fontWeight: '600',
    color: COLORS.primary,
    marginBottom: SPACING.sm,
  },
  infoText: {
    fontSize: FONTS.sm,
    marginBottom: SPACING.xs,
    lineHeight: 20,
  },
  form: {
    marginBottom: SPACING.xl,
  },
  joinButton: {
    marginTop: SPACING.md,
  },
  alternative: {
    marginBottom: SPACING.xl,
    paddingTop: SPACING.xl,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  alternativeText: {
    fontSize: FONTS.base,
    textAlign: 'center',
    marginBottom: SPACING.md,
  },
  createButton: {
    marginBottom: SPACING.md,
  },
});
