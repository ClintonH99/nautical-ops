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
  Modal,
  Pressable,
  TouchableOpacity,
} from 'react-native';
import { Button, Input, ConsentCheckbox, LabeledDropdown } from '../components';
import { COLORS, FONTS, SPACING, BORDER_RADIUS } from '../constants/theme';
import { Department } from '../types';
import authService from '../services/auth';
import { useAuthStore } from '../store';
import { useThemeColors } from '../hooks/useThemeColors';
import { usePostHog } from 'posthog-react-native';

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
  });
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<any>({});
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [confirmSentEmail, setConfirmSentEmail] = useState<string | null>(null);
  const [departmentDropdownOpen, setDepartmentDropdownOpen] = useState(false);

  const setUser = useAuthStore((state) => state.setUser);
  const posthog = usePostHog();

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

    if (!acceptedTerms) {
      newErrors.terms = 'You must agree to the Terms & Conditions and Privacy Policy';
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
      });

      if (user) {
        if (!session) {
          setConfirmSentEmail(formData.email);
        } else {
          posthog.identify(user.id, {
            $set: {
              email: user.email,
              name: user.name,
              role: user.role,
              position: user.position,
              department: formData.department,
            },
            $set_once: { signup_date: new Date().toISOString() },
          });
          posthog.capture('user_signed_up', {
            role: user.role,
            department: formData.department,
            has_invite_code: !!formData.inviteCode,
          });
          setUser(user);
          Alert.alert('Success', 'Account created successfully! Welcome aboard!');
        }
      }
    } catch (error: any) {
      const msg = error?.message?.toLowerCase() || '';
      const isInviteCodeError =
        msg.includes('invite code') ||
        msg.includes('vessel not found') ||
        msg.includes('cannot coerce') ||
        msg.includes('expired');
      Alert.alert(
        'Invalid Invite Code',
        isInviteCodeError
          ? 'Request new code from the Captain.'
          : error.message || 'Failed to create account.'
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
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        <View style={styles.content}>
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.title}>Create Account</Text>
            <Text
              style={[
                styles.subtitle,
                { color: themeColors.isDark ? COLORS.white : themeColors.textSecondary },
              ]}
            >
              Join the crew
            </Text>
          </View>

          {confirmSentEmail ? (
            <View style={styles.confirmBanner}>
              <Text style={styles.confirmBannerText}>
                Confirmation email has been sent to {confirmSentEmail}. Please verify your email
                before signing in.
              </Text>
              <Button
                title="Go to Login"
                onPress={() => {
                  setConfirmSentEmail(null);
                  navigation.navigate('Login');
                }}
                variant="primary"
                fullWidth
                style={styles.confirmBannerButton}
              />
            </View>
          ) : (
            <>
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

                <Input
                  label="Position"
                  placeholder="e.g., Deckhand, Chief Stew, Engineer"
                  value={formData.position}
                  onChangeText={(value) => updateField('position', value)}
                  error={errors.position}
                />

                {/* Department Selection */}
                <View style={styles.departmentSection}>
                  <LabeledDropdown
                    label="Department"
                    value={
                      DEPARTMENTS.find((dept) => dept.value === formData.department)?.label ??
                      'Select department'
                    }
                    open={departmentDropdownOpen}
                    onPress={() => setDepartmentDropdownOpen(true)}
                    tightTop
                  />
                  {errors.department && <Text style={styles.error}>{errors.department}</Text>}
                </View>

                <Modal visible={departmentDropdownOpen} transparent animationType="fade">
                  <Pressable
                    style={styles.modalBackdrop}
                    onPress={() => setDepartmentDropdownOpen(false)}
                  >
                    <View
                      style={[styles.modalBox, { backgroundColor: themeColors.surface }]}
                      onStartShouldSetResponder={() => true}
                    >
                      {DEPARTMENTS.map((dept) => (
                        <TouchableOpacity
                          key={dept.value}
                          style={[
                            styles.modalItem,
                            formData.department === dept.value && styles.modalItemSelected,
                          ]}
                          onPress={() => {
                            updateField('department', dept.value);
                            setDepartmentDropdownOpen(false);
                          }}
                        >
                          <Text
                            style={[
                              styles.modalItemText,
                              { color: themeColors.textPrimary },
                              formData.department === dept.value && styles.modalItemTextSelected,
                            ]}
                          >
                            {dept.label}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </Pressable>
                </Modal>

                <View style={styles.inviteCodeInfo}>
                  <Text
                    style={[
                      styles.inviteCodeInfoText,
                      { color: themeColors.isDark ? COLORS.white : themeColors.textSecondary },
                    ]}
                  >
                    💡 You can join a vessel after creating your account
                  </Text>
                </View>

                <ConsentCheckbox
                  checked={acceptedTerms}
                  onToggle={() => setAcceptedTerms((v) => !v)}
                  onPressTerms={() => navigation.navigate('TermsConditions')}
                  onPressPrivacy={() => navigation.navigate('PrivacyPolicy')}
                  textColor={themeColors.textPrimary}
                  error={errors.terms}
                />

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
                <Text style={[styles.footerText, { color: themeColors.textSecondary }]}>
                  Already have an account?{' '}
                </Text>
                <Button
                  title="Sign In"
                  onPress={() => navigation.navigate('Login')}
                  variant="outline"
                  size="small"
                />
              </View>
            </>
          )}
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
  departmentSection: {
    marginBottom: SPACING.md,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.xl,
  },
  modalBox: {
    borderRadius: BORDER_RADIUS.lg,
    overflow: 'hidden',
    width: '100%',
    maxWidth: 320,
  },
  modalItem: {
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.lg,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  modalItemSelected: {
    backgroundColor: COLORS.primaryLight + '22',
  },
  modalItemText: {
    fontSize: FONTS.base,
    fontWeight: '500',
  },
  modalItemTextSelected: {
    color: COLORS.primary,
    fontWeight: '700',
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
  confirmBanner: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    borderWidth: 1,
    borderColor: COLORS.success,
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.lg,
    marginBottom: SPACING.xl,
  },
  confirmBannerText: {
    fontSize: FONTS.base,
    color: COLORS.textPrimary,
    marginBottom: SPACING.md,
    lineHeight: 22,
  },
  confirmBannerButton: {
    marginTop: 0,
  },
});
