/**
 * Register Screen
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
import { Department } from '../types';
import authService from '../services/auth';
import { useAuthStore } from '../store';
import { useThemeColors } from '../hooks/useThemeColors';

const DEPARTMENTS = [
  { label: 'Bridge', value: 'BRIDGE' },
  { label: 'Engineering', value: 'ENGINEERING' },
  { label: 'Exterior', value: 'EXTERIOR' },
  { label: 'Interior', value: 'INTERIOR' },
  { label: 'Galley', value: 'GALLEY' },
];

export const RegisterScreen = ({ navigation, route }: any) => {
  const themeColors = useThemeColors();
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: '',
    confirmPassword: '',
    position: '',
    department: '' as Department | '',
    inviteCode: route.params?.inviteCode || '',
    vesselId: route.params?.vesselId || '', // Hidden field for vessel creator
  });
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<any>({});

  const setUser = useAuthStore((state) => state.setUser);

  // Check if user is creating their own vessel (came from CreateVessel screen)
  const isVesselCreator = !!formData.vesselId;

  const updateField = (field: string, value: string) => {
    setFormData({ ...formData, [field]: value });
    // Clear error for this field
    if (errors[field]) {
      setErrors({ ...errors, [field]: '' });
    }
  };

  const validateForm = () => {
    let valid = true;
    const newErrors: any = {};

    if (!formData.name.trim()) {
      newErrors.name = 'Name is required';
      valid = false;
    }

    if (!formData.email) {
      newErrors.email = 'Email is required';
      valid = false;
    } else if (!/\S+@\S+\.\S+/.test(formData.email)) {
      newErrors.email = 'Email is invalid';
      valid = false;
    }

    if (!formData.password) {
      newErrors.password = 'Password is required';
      valid = false;
    } else if (formData.password.length < 6) {
      newErrors.password = 'Password must be at least 6 characters';
      valid = false;
    }

    if (formData.password !== formData.confirmPassword) {
      newErrors.confirmPassword = 'Passwords do not match';
      valid = false;
    }

    if (!formData.position.trim()) {
      newErrors.position = 'Position is required';
      valid = false;
    }

    if (!formData.department) {
      newErrors.department = 'Department is required';
      valid = false;
    }

    // Invite code is now completely optional
    // Users can register without it and join a vessel later

    setErrors(newErrors);
    return valid;
  };

  const handleRegister = async () => {
    if (!validateForm()) return;

    setLoading(true);
    try {
      const { user, session } = await authService.signUp({
        email: formData.email,
        password: formData.password,
        name: formData.name,
        position: formData.position,
        department: formData.department as string,
        inviteCode: formData.inviteCode,
        vesselId: formData.vesselId || undefined,
      });

      if (user) {
        setUser(user);
        const roleMessage = formData.vesselId 
          ? 'Your vessel is ready! You are the Head of Department.'
          : 'Welcome aboard!';
        Alert.alert('Success', `Account created successfully! ${roleMessage}`);
      }
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to create account');
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
            <Text style={styles.title}>Create Account</Text>
            <Text style={[styles.subtitle, { color: themeColors.textSecondary }]}>
              {isVesselCreator ? 'Set up your captain account' : 'Join the crew'}
            </Text>
          </View>

          {/* Form */}
          <View style={styles.form}>
            <Input
              label="Full Name"
              placeholder="John Doe"
              value={formData.name}
              onChangeText={(value) => updateField('name', value)}
              error={errors.name}
            />

            <Input
              label="Email"
              placeholder="your@email.com"
              value={formData.email}
              onChangeText={(value) => updateField('email', value)}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              error={errors.email}
            />

            <Input
              label="Password"
              placeholder="Minimum 6 characters"
              value={formData.password}
              onChangeText={(value) => updateField('password', value)}
              secureTextEntry
              autoCapitalize="none"
              error={errors.password}
            />

            <Input
              label="Confirm Password"
              placeholder="Re-enter password"
              value={formData.confirmPassword}
              onChangeText={(value) => updateField('confirmPassword', value)}
              secureTextEntry
              autoCapitalize="none"
              error={errors.confirmPassword}
            />

            <Input
              label="Position"
              placeholder="e.g., Deckhand, Chief Stew, Engineer"
              value={formData.position}
              onChangeText={(value) => updateField('position', value)}
              error={errors.position}
            />

            {/* Department Selection - simplified for now */}
            <View style={styles.departmentSection}>
              <Text style={[styles.label, { color: themeColors.textPrimary }]}>Department</Text>
              <View style={styles.departmentButtons}>
                {DEPARTMENTS.map((dept) => (
                  <Button
                    key={dept.value}
                    title={dept.label}
                    variant={
                      formData.department === dept.value ? 'primary' : 'outline'
                    }
                    size="small"
                    onPress={() => updateField('department', dept.value)}
                    style={styles.departmentButton}
                  />
                ))}
              </View>
              {errors.department && (
                <Text style={styles.error}>{errors.department}</Text>
              )}
            </View>

            {/* Only show invite code for vessel creators */}
            {isVesselCreator && (
              <Input
                label="Invite Code"
                placeholder="Auto-generated for your vessel"
                value={formData.inviteCode}
                onChangeText={(value) => updateField('inviteCode', value)}
                autoCapitalize="characters"
                error={errors.inviteCode}
                editable={false}
              />
            )}

            {/* Info message for regular users */}
            {!isVesselCreator && (
              <View style={styles.inviteCodeInfo}>
                <Text style={[styles.inviteCodeInfoText, { color: themeColors.textSecondary }]}>
                  💡 You can join a vessel after creating your account
                </Text>
              </View>
            )}

            {/* Show vessel creator badge */}
            {isVesselCreator && (
              <View style={[styles.creatorBadge, { backgroundColor: themeColors.surface }]}>
                <Text style={styles.creatorBadgeText}>⚓ Vessel Creator - You'll be assigned as Head of Department</Text>
              </View>
            )}

            <Button
              title="Create Account"
              onPress={handleRegister}
              loading={loading}
              fullWidth
              style={styles.registerButton}
            />
          </View>

          {/* Footer */}
          <View style={styles.footer}>
            <Text style={[styles.footerText, { color: themeColors.textSecondary }]}>Already have an account? </Text>
            <Button
              title="Sign In"
              onPress={() => navigation.navigate('Login')}
              variant="outline"
              size="small"
            />
          </View>
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
  title: {
    fontSize: FONTS['3xl'],
    fontWeight: 'bold',
    color: COLORS.primary,
    marginBottom: SPACING.xs,
  },
  subtitle: {
    fontSize: FONTS.base,
    color: COLORS.textSecondary,
  },
  form: {
    marginBottom: SPACING.lg,
  },
  label: {
    fontSize: FONTS.sm,
    fontWeight: '600',
    marginBottom: SPACING.sm,
  },
  departmentSection: {
    marginBottom: SPACING.md,
  },
  departmentButtons: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.sm,
  },
  departmentButton: {
    flex: 1,
    minWidth: '45%',
    marginBottom: SPACING.sm,
  },
  inviteCodeInfo: {
    backgroundColor: COLORS.primaryLight,
    padding: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    marginBottom: SPACING.md,
  },
  inviteCodeInfoText: {
    fontSize: FONTS.sm,
    color: COLORS.primary,
    fontWeight: '500',
    textAlign: 'center',
  },
  inviteCodeHelp: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -SPACING.sm,
    marginBottom: SPACING.sm,
  },
  inviteCodeHelpText: {
    fontSize: FONTS.xs,
    color: COLORS.textSecondary,
  },
  creatorBadge: {
    padding: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    marginTop: SPACING.sm,
    marginBottom: SPACING.md,
  },
  creatorBadgeText: {
    fontSize: FONTS.sm,
    color: COLORS.primary,
    fontWeight: '600',
    textAlign: 'center',
  },
  registerButton: {
    marginTop: SPACING.md,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: SPACING.lg,
    marginBottom: SPACING.xl,
  },
  footerText: {
    fontSize: FONTS.sm,
  },
  error: {
    fontSize: FONTS.xs,
    color: COLORS.danger,
    marginTop: SPACING.xs,
  },
});
