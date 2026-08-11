/**
 * Register Crew Screen
 * For crew members joining with an invite code
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
  TouchableOpacity,
  StatusBar,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Button, Input, ConsentCheckbox } from '../components';
import { COLORS, FONTS, SPACING, BORDER_RADIUS } from '../constants/theme';
import { useThemeColors } from '../hooks/useThemeColors';
import { Department } from '../types';
import authService from '../services/auth';
import { useAuthStore } from '../store';

const INFO_BG = 'rgba(14, 165, 233, 0.12)';
const INFO_BORDER = 'rgba(14, 165, 233, 0.3)';

const DEPARTMENTS = [
  { label: 'Bridge', value: 'BRIDGE' },
  { label: 'Engineering', value: 'ENGINEERING' },
  { label: 'Exterior', value: 'EXTERIOR' },
  { label: 'Interior', value: 'INTERIOR' },
  { label: 'Galley', value: 'GALLEY' },
];

export const RegisterCrewScreen = ({ navigation }: any) => {
  const themeColors = useThemeColors();
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: '',
    confirmPassword: '',
    contractType: 'permanent' as 'permanent' | 'temporary' | 'rotational',
    position: '',
    departments: [] as Department[], // Up to 2 departments for dual-role (e.g. deck/stew)
    inviteCode: '',
  });
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<any>({});
  const [acceptedTerms, setAcceptedTerms] = useState(false);

  const setUser = useAuthStore((state) => state.setUser);

  const updateField = (field: string, value: string) => {
    setFormData({ ...formData, [field]: value });
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

    if (formData.departments.length === 0) {
      newErrors.department = 'Select at least one department';
      valid = false;
    } else if (formData.departments.length > 2) {
      newErrors.department = 'Select up to 2 departments';
      valid = false;
    }

    // Invite code is now optional - a crew member can create a bare account
    // and use Join Vessel later once they have a real code from a paying vessel.
    if (!acceptedTerms) {
      newErrors.terms = 'You must agree to the Terms & Conditions and Privacy Policy';
      valid = false;
    }

    setErrors(newErrors);
    return valid;
  };

  const handleRegister = async () => {
    if (!validateForm()) return;

    setLoading(true);
    try {
      const { user } = await authService.signUp({
        email: formData.email,
        password: formData.password,
        name: formData.name,
        position: formData.position,
        department: formData.departments[0],
        department2: formData.departments[1] || null,
        contractType: formData.contractType,
        inviteCode: formData.inviteCode,
      });

      if (user) {
        setUser(user);
        Alert.alert('Success', 'Welcome aboard! Your crew account has been created.', [
          { text: 'OK' },
        ]);
      }
    } catch (error: any) {
      const msg = error?.message?.toLowerCase() || '';
      const isInviteCodeError =
        msg.includes('invite code') ||
        msg.includes('vessel not found') ||
        msg.includes('cannot coerce') ||
        msg.includes('expired');
      if (!isInviteCodeError) console.error('Crew registration error:', error);
      Alert.alert(
        isInviteCodeError ? 'Invalid Invite Code' : 'Error',
        isInviteCodeError
          ? 'Request new code from the Captain.'
          : error.message || 'Failed to create account.'
      );
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
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => navigation.goBack()}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="chevron-back" size={28} color={themeColors.textPrimary} />
          </TouchableOpacity>

          <Text style={[styles.title, { color: themeColors.textPrimary }]}>Create Crew Account</Text>
          <Text style={[styles.subtitle, { color: themeColors.textSecondary }]}>
            Join your vessel using an invite code
          </Text>

          <View style={styles.infoBanner}>
            <Text style={[styles.infoBannerText, { color: themeColors.textPrimary }]}>
              You'll need an 8-character invite code from your captain to create a crew account.
            </Text>
          </View>

          <>
            <View
              style={[
                styles.formCard,
                {
                  backgroundColor: themeColors.surface,
                  borderColor: themeColors.isDark ? 'rgba(255,255,255,0.1)' : COLORS.border,
                },
              ]}
            >
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
                showPasswordToggle
                autoCapitalize="none"
                error={errors.password}
              />

              <Input
                label="Confirm Password"
                placeholder="Re-enter password"
                value={formData.confirmPassword}
                onChangeText={(value) => updateField('confirmPassword', value)}
                secureTextEntry
                showPasswordToggle
                autoCapitalize="none"
                error={errors.confirmPassword}
              />

              {/* Contract Type */}
              <View style={styles.contractTypeSection}>
                <Text style={[styles.label, { color: themeColors.textPrimary }]}>Contract Type</Text>
                <View style={styles.contractTypeButtons}>
                  {(
                    [
                      { label: 'Permanent', value: 'permanent' },
                      { label: 'Rotational', value: 'rotational' },
                      { label: 'Temporary', value: 'temporary' },
                    ] as const
                  ).map((ct) => {
                    const isSelected = formData.contractType === ct.value;
                    return (
                      <Button
                        key={ct.value}
                        title={ct.label}
                        variant={isSelected ? 'primary' : 'outline'}
                        size="small"
                        style={styles.contractTypeButton}
                        onPress={() => setFormData({ ...formData, contractType: ct.value })}
                      />
                    );
                  })}
                </View>
                <Text style={[styles.departmentHint, { color: themeColors.textSecondary }]}>
                  Crew in a probation period should fall under Permanent.
                </Text>
              </View>

              <View style={styles.departmentSection}>
                <Text style={[styles.label, { color: themeColors.textPrimary }]}>Department</Text>
                <Text style={[styles.departmentHint, { color: themeColors.textSecondary }]}>
                  Select the department you report to. i.e. If you're Deck/Stew, choose
                  Exterior/Interior.
                </Text>
                <View style={styles.departmentButtons}>
                  {DEPARTMENTS.map((dept) => {
                    const isSelected = formData.departments.includes(dept.value as Department);
                    const canSelect = isSelected || formData.departments.length < 2;
                    return (
                      <Button
                        key={dept.value}
                        title={dept.label}
                        variant={isSelected ? 'primary' : 'outline'}
                        size="small"
                        style={styles.departmentButton}
                        onPress={() => {
                          if (isSelected) {
                            setFormData({
                              ...formData,
                              departments: formData.departments.filter((d) => d !== dept.value),
                            });
                            if (errors.department) setErrors({ ...errors, department: '' });
                          } else if (canSelect) {
                            setFormData({
                              ...formData,
                              departments: [...formData.departments, dept.value as Department],
                            });
                            if (errors.department) setErrors({ ...errors, department: '' });
                          }
                        }}
                      />
                    );
                  })}
                </View>
                {formData.departments.length > 0 && (
                  <Text style={[styles.selectedDepts, { color: themeColors.textSecondary }]}>
                    Selected:{' '}
                    {formData.departments
                      .map((d) => DEPARTMENTS.find((x) => x.value === d)?.label ?? d)
                      .join(', ')}
                  </Text>
                )}
                {errors.department && <Text style={styles.error}>{errors.department}</Text>}
              </View>

              <Input
                label="Position"
                placeholder="e.g., Deckhand, Chief Stew, Engineer"
                value={formData.position}
                onChangeText={(value) => updateField('position', value)}
                error={errors.position}
              />

              {/* Invite Code - REQUIRED for crew */}
              <Input
                label="Invite Code *"
                placeholder="e.g., ABC12345"
                value={formData.inviteCode}
                onChangeText={(value) => updateField('inviteCode', value.toUpperCase())}
                autoCapitalize="characters"
                maxLength={8}
                error={errors.inviteCode}
              />

              <ConsentCheckbox
                checked={acceptedTerms}
                onToggle={() => setAcceptedTerms((v) => !v)}
                onPressTerms={() => navigation.navigate('TermsConditions')}
                onPressPrivacy={() => navigation.navigate('PrivacyPolicy')}
                textColor={themeColors.textPrimary}
                error={errors.terms}
              />

              <Button
                title="Create Crew Account"
                onPress={handleRegister}
                loading={loading}
                fullWidth
                style={styles.registerButton}
              />
            </View>

            <View style={styles.footer}>
              <Text style={[styles.footerText, { color: themeColors.textSecondary }]}>Already have an account? </Text>
              <TouchableOpacity onPress={() => navigation.navigate('Login')}>
                <Text style={styles.footerLink}>Sign In</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.helpSection}>
              <Text style={[styles.helpText, { color: themeColors.textPrimary }]}>Don't have an invite code?</Text>
              <Text style={[styles.helpSubtext, { color: themeColors.textSecondary }]}>
                Ask your captain for the vessel's invite code, or create a captain account if you're
                starting your own vessel.
              </Text>
            </View>
          </>
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
  backButton: {
    position: 'absolute',
    top: 56,
    left: SPACING.lg,
    zIndex: 10,
  },
  title: {
    fontSize: FONTS['2xl'],
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: SPACING.xs,
    letterSpacing: -0.3,
  },
  subtitle: {
    fontSize: FONTS.sm,
    textAlign: 'center',
    marginBottom: SPACING.lg,
  },
  infoBanner: {
    backgroundColor: INFO_BG,
    borderWidth: 1,
    borderColor: INFO_BORDER,
    padding: SPACING.lg,
    borderRadius: BORDER_RADIUS.lg,
    marginBottom: SPACING.xl,
  },
  infoBannerText: {
    fontSize: FONTS.sm,
    fontWeight: '500',
    textAlign: 'center',
    lineHeight: 22,
  },
  formCard: {
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.xl,
    marginBottom: SPACING.lg,
    borderWidth: 1,
  },
  label: {
    fontSize: FONTS.sm,
    fontWeight: '600',
    marginBottom: SPACING.sm,
  },
  contractTypeSection: {
    marginBottom: SPACING.md,
  },
  contractTypeButtons: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.sm,
    marginBottom: SPACING.sm,
  },
  contractTypeButton: {
    flexShrink: 0,
  },
  departmentSection: {
    marginBottom: SPACING.md,
  },
  departmentHint: {
    fontSize: FONTS.xs,
    marginBottom: SPACING.sm,
    lineHeight: 18,
  },
  selectedDepts: {
    fontSize: FONTS.xs,
    marginTop: SPACING.xs,
    fontStyle: 'italic',
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
  registerButton: {
    marginTop: SPACING.md,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: SPACING.xl,
    gap: SPACING.xs,
  },
  footerText: {
    fontSize: FONTS.sm,
  },
  footerLink: {
    fontSize: FONTS.sm,
    fontWeight: '600',
    color: COLORS.primary,
  },
  helpSection: {
    backgroundColor: INFO_BG,
    borderColor: INFO_BORDER,
    padding: SPACING.lg,
    borderRadius: BORDER_RADIUS.lg,
    marginBottom: SPACING.xl,
    borderWidth: 1,
  },
  helpText: {
    fontSize: FONTS.sm,
    fontWeight: '600',
    marginBottom: SPACING.xs,
    textAlign: 'center',
  },
  helpSubtext: {
    fontSize: FONTS.xs,
    textAlign: 'center',
    lineHeight: 20,
  },
  error: {
    fontSize: FONTS.xs,
    color: COLORS.danger,
    marginTop: SPACING.xs,
  },
});
