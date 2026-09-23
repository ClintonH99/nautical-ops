/**
 * Settings Screen
 * Main hub for profile and vessel management
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  Platform,
  Linking,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SIZES } from '../constants/theme';
import { useFocusEffect } from '@react-navigation/native';
import { useAuthStore, useThemeStore, BACKGROUND_THEMES } from '../store';
import { supabase } from '../services/supabase';
import { Button, PageHeader } from '../components';
import authService from '../services/auth';
import userService from '../services/user';
import { canAccessDepartmentColorSettings, canAccessVesselManagement } from '../utils/access';
import Constants from 'expo-constants';
import { formatDepartmentLabel } from '../utils/departmentSelection';

// Read from app.json at build time, so it can never drift from the
// version actually shipped.
const APP_VERSION = Constants.expoConfig?.version ?? '';

type SettingsIconName = React.ComponentProps<typeof Ionicons>['name'];

type SettingsItem = {
  icon: string;
  label: string;
  description: string;
  onPress: () => void;
  disabled: boolean;
  destructive?: boolean;
};

type SettingsSection = {
  title: string;
  items: SettingsItem[];
};

export const SettingsScreen = ({ navigation }: any) => {
  const { user, logout, setUser } = useAuthStore();
  const backgroundTheme = useThemeStore((s) => s.backgroundTheme);
  const themeColors = BACKGROUND_THEMES[backgroundTheme];
  const canDeptColors = canAccessDepartmentColorSettings(user);
  const canVesselAdmin = canAccessVesselManagement(user);
  const displaysAsCaptain =
    user?.role === 'CAPTAIN_MOV' || user?.position?.toLowerCase().includes('captain') === true;
  const [photoLoadFailed, setPhotoLoadFailed] = useState(false);
  const profilePhotoUrl =
    user?.profilePhoto || (user?.id ? userService.getProfilePhotoUrl(user.id) : null);

  useEffect(() => {
    if (user?.profilePhoto) setPhotoLoadFailed(false);
  }, [user?.profilePhoto]);

  useFocusEffect(
    React.useCallback(() => {
      if (user?.profilePhoto) setPhotoLoadFailed(false);
      if (user?.id) {
        authService.getUserProfile(user.id).then((fresh) => {
          if (fresh) setUser(fresh);
        });
      }
    }, [user?.id, user?.profilePhoto, setUser])
  );

  const handleDeleteAccount = () => {
    Alert.alert(
      'Delete Account',
      "This permanently deletes your account and removes you from your vessel. It does not cancel an Apple App Store or Google Play subscription; cancel that in your device's subscription settings first. This cannot be undone.",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete Account',
          style: 'destructive',
          onPress: async () => {
            try {
              const { data: sessionData } = await supabase.auth.getSession();
              const accessToken = sessionData?.session?.access_token;
              if (!accessToken) {
                Alert.alert('Error', 'Could not verify your session. Please try again.');
                return;
              }
              const { data, error } = await supabase.functions.invoke('delete-account', {
                headers: { Authorization: `Bearer ${accessToken}` },
              });
              if (error || data?.error) {
                const msg =
                  data?.error ||
                  'Could not delete account. Please contact support@nautical-ops.com';
                if (msg.includes('only Captain/MOV')) {
                  Alert.alert("You're the only Captain", msg, [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: 'Go to Crew Management',
                      onPress: () => navigation.navigate('CrewManagement'),
                    },
                  ]);
                } else {
                  Alert.alert('Error', msg);
                }
                return;
              }
              logout();
              await authService.signOut();
            } catch {
              Alert.alert(
                'Error',
                'Could not delete account. Please contact support@nautical-ops.com'
              );
            }
          },
        },
      ]
    );
  };

  const settingsSections: SettingsSection[] = [
    {
      title: 'Account',
      items: [
        {
          icon: 'person-outline',
          label: 'My Profile',
          description: 'Edit your personal information, join another vessel here',
          onPress: () => navigation.navigate('Profile'),
          disabled: false,
        },
      ],
    },
    ...(canVesselAdmin
      ? [
          {
            title: 'Vessel Management',
            items: [
              {
                icon: 'card-outline',
                label: 'Vessel Plans',
                description: 'Subscription plans and payment options',
                onPress: () => navigation.navigate('VesselPlans'),
                disabled: false,
              },
              {
                icon: 'boat-outline',
                label: 'Vessel Settings',
                description: 'Vessel name, invite code, change photo',
                onPress: () => navigation.navigate('VesselSettings'),
                disabled: false,
              },
              {
                icon: 'people-outline',
                label: 'Crew Management',
                description: 'View and manage crew members',
                onPress: () => navigation.navigate('CrewManagement'),
                disabled: false,
              },
            ],
          },
        ]
      : []),
    {
      title: 'App',
      items: [
        {
          icon: 'moon-outline',
          label: 'Appearance',
          description: 'Background theme: Day or Night Mode',
          onPress: () => navigation.navigate('ThemeSettings'),
          disabled: false,
        },
        ...(canDeptColors
          ? [
              {
                icon: 'color-palette-outline',
                label: 'Department colors',
                description: 'Choose color scheme or no color per crew department',
                onPress: () => navigation.navigate('DepartmentColorSettings'),
                disabled: false,
              },
            ]
          : []),
        ...(Platform.OS !== 'web'
          ? [
              {
                icon: 'notifications-outline',
                label: 'Notifications',
                description: 'Manage notification preferences',
                onPress: () => navigation.navigate('NotificationSettings'),
                disabled: false,
              },
            ]
          : []),
        {
          icon: 'sparkles-outline',
          label: 'Future Updates & Features',
          description: "See what's coming next to Nautical Ops",
          onPress: () => navigation.navigate('FutureUpdates'),
          disabled: false,
        },
        ...(Platform.OS !== 'web'
          ? [
              {
                icon: 'open-outline',
                label: 'Link website',
                description: 'Open website in your browser to sign in',
                onPress: () =>
                  Linking.openURL('https://www.nautical-ops.com').catch(() =>
                    Alert.alert('Error', 'Could not open website')
                  ),
                disabled: false,
              },
            ]
          : []),
        {
          icon: 'information-circle-outline',
          label: 'About',
          description: 'App version and information',
          onPress: () => {
            if (__DEV__) console.log('About screen coming soon');
          },
          disabled: true,
        },
      ],
    },
    {
      title: 'Support',
      items: [
        {
          icon: 'help-circle-outline',
          label: 'FAQ & Help',
          description: 'Frequently asked questions and guides',
          onPress: () => navigation.navigate('FAQHelp'),
          disabled: false,
        },
        {
          icon: 'chatbubble-outline',
          label: 'Contact Support',
          description: 'Email us for help or to report issues',
          onPress: () => {
            const url = 'mailto:support@nautical-ops.com';
            Linking.openURL(url).catch(() =>
              Alert.alert('Contact Support', 'Email: support@nautical-ops.com')
            );
          },
          disabled: false,
        },
      ],
    },
    {
      title: 'Legal',
      items: [
        {
          icon: 'document-text-outline',
          label: 'Terms & Conditions',
          description: 'Terms of use for Nautical Ops',
          onPress: () => navigation.navigate('TermsConditions'),
          disabled: false,
        },
        {
          icon: 'shield-checkmark-outline',
          label: 'Privacy Policy',
          description: 'How we collect and protect your data',
          onPress: () => navigation.navigate('PrivacyPolicy'),
          disabled: false,
        },
        {
          icon: 'receipt-outline',
          label: 'Refund Policy',
          description: 'Subscription refund terms and conditions',
          onPress: () => navigation.navigate('RefundPolicy'),
          disabled: false,
        },
      ],
    },
    {
      title: 'Account Actions',
      items: [
        {
          icon: 'trash-outline',
          label: 'Delete Account',
          description: 'Permanently delete your account and data',
          onPress: handleDeleteAccount,
          disabled: false,
          destructive: true,
        },
      ],
    },
  ];

  return (
    <View style={[styles.container, { backgroundColor: themeColors.background }]}>
      <PageHeader title="Settings" />
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* User Header */}
        <TouchableOpacity
          style={[
            styles.userHeader,
            {
              backgroundColor: themeColors.surface,
              borderColor: themeColors.border,
            },
          ]}
          onPress={() => navigation.navigate('Profile')}
          activeOpacity={0.75}
          accessibilityRole="button"
          accessibilityLabel="Open my profile"
        >
          <View style={styles.avatarContainer}>
            {profilePhotoUrl && !photoLoadFailed ? (
              <Image
                source={{ uri: profilePhotoUrl }}
                style={styles.avatar}
                onError={() => setPhotoLoadFailed(true)}
              />
            ) : (
              <View style={styles.avatarPlaceholder}>
                <Text style={styles.avatarText}>{user?.name?.charAt(0).toUpperCase() || '?'}</Text>
              </View>
            )}
          </View>
          <View style={styles.userInfo}>
            <Text style={[styles.userName, { color: themeColors.textPrimary }]}>{user?.name}</Text>
            <Text style={[styles.userDetails, { color: themeColors.textSecondary }]}>
              {user?.position} · {formatDepartmentLabel(user?.department ?? 'BRIDGE')}
            </Text>
            <View style={styles.roleBadge}>
              <Text style={[styles.roleText, { textTransform: 'none' }]}>
                {displaysAsCaptain
                  ? 'MOV (Master of Vessel)'
                  : user?.role === 'HOD'
                    ? 'HOD (Head of Department)'
                    : 'Crew'}
              </Text>
            </View>
          </View>
          <Ionicons name="chevron-forward" size={20} color={themeColors.textSecondary} />
        </TouchableOpacity>

        {/* Settings Sections */}
        {settingsSections.map((section) => (
          <View key={section.title} style={styles.section}>
            <Text style={[styles.sectionTitle, { color: themeColors.textSecondary }]}>
              {section.title}
            </Text>
            <View
              style={[
                styles.sectionContent,
                {
                  backgroundColor: themeColors.surface,
                  borderColor: themeColors.border,
                },
              ]}
            >
              {section.items.map((item, itemIndex) => (
                <TouchableOpacity
                  key={item.label}
                  style={[
                    styles.settingsItem,
                    { borderBottomColor: themeColors.border },
                    item.disabled && styles.settingsItemDisabled,
                    itemIndex === section.items.length - 1 && styles.settingsItemLast,
                  ]}
                  onPress={item.onPress}
                  disabled={item.disabled}
                  activeOpacity={0.7}
                >
                  <View style={styles.settingsItemLeft}>
                    <View
                      style={[
                        styles.settingsIconContainer,
                        {
                          backgroundColor: item.destructive
                            ? 'rgba(239, 68, 68, 0.1)'
                            : themeColors.accentSoft,
                        },
                      ]}
                    >
                      <Ionicons
                        name={item.icon as SettingsIconName}
                        size={20}
                        color={item.destructive ? COLORS.danger : COLORS.primary}
                      />
                    </View>
                    <View style={styles.settingsTextContainer}>
                      <Text
                        style={[
                          styles.settingsLabel,
                          {
                            color: item.destructive ? COLORS.danger : themeColors.textPrimary,
                          },
                        ]}
                      >
                        {item.label}
                      </Text>
                      <Text
                        style={[styles.settingsDescription, { color: themeColors.textSecondary }]}
                      >
                        {item.description}
                      </Text>
                    </View>
                  </View>
                  <Ionicons name="chevron-forward" size={19} color={themeColors.textSecondary} />
                </TouchableOpacity>
              ))}
            </View>
          </View>
        ))}

        {/* Sign Out */}
        <Button
          title="Sign Out"
          onPress={async () => {
            await authService.signOut();
            logout();
          }}
          variant={themeColors.isDark ? 'outlineLight' : 'outline'}
          fullWidth
          style={styles.signOutButton}
        />

        {/* Version Info */}
        <View style={styles.versionInfo}>
          <Text style={[styles.versionText, { color: themeColors.textSecondary }]}>
            Nautical Ops v{APP_VERSION}
          </Text>
          <Text style={[styles.versionSubtext, { color: themeColors.textSecondary }]}>
            Professional yacht operations management
          </Text>
        </View>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollView: { flex: 1 },
  content: {
    padding: SPACING.lg,
    paddingTop: SPACING.lg,
    paddingBottom: SIZES.bottomScrollPadding,
  },
  userHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: SPACING.md,
    borderRadius: BORDER_RADIUS.lg,
    marginBottom: SPACING.xl,
    shadowColor: '#0D0D0D',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 3,
    borderWidth: 1,
  },
  avatarContainer: { marginRight: SPACING.md },
  avatar: { width: 60, height: 60, borderRadius: 30 },
  avatarPlaceholder: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: COLORS.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    fontSize: FONTS['2xl'],
    fontWeight: 'bold',
    color: COLORS.white,
  },
  userInfo: { flex: 1 },
  userName: {
    fontSize: FONTS.xl,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  userDetails: {
    fontSize: FONTS.sm,
    marginBottom: SPACING.xs,
  },
  roleBadge: {
    alignSelf: 'flex-start',
    backgroundColor: COLORS.primary,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 4,
    borderRadius: BORDER_RADIUS.sm,
  },
  roleText: {
    fontSize: FONTS.xs,
    fontWeight: 'bold',
    color: COLORS.white,
    textTransform: 'uppercase',
  },
  section: { marginBottom: SPACING.lg },
  sectionTitle: {
    fontSize: FONTS.xs,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: SPACING.sm,
    marginLeft: SPACING.xs,
  },
  sectionContent: {
    borderRadius: BORDER_RADIUS.lg,
    overflow: 'hidden',
    shadowColor: '#0D0D0D',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 3,
    borderWidth: 1,
  },
  settingsItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 70,
    paddingVertical: 13,
    paddingHorizontal: SPACING.md,
    borderBottomWidth: 1,
  },
  settingsItemLast: { borderBottomWidth: 0 },
  settingsItemDisabled: { opacity: 0.5 },
  settingsItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  settingsIconContainer: {
    width: 38,
    height: 38,
    borderRadius: BORDER_RADIUS.md,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: SPACING.md,
  },
  settingsTextContainer: { flex: 1 },
  settingsLabel: {
    fontSize: FONTS.base,
    fontWeight: '600',
    marginBottom: 2,
  },
  settingsDescription: { fontSize: FONTS.sm },
  versionInfo: {
    alignItems: 'center',
    paddingTop: SPACING.md,
    paddingBottom: SPACING.xl,
  },
  versionText: { fontSize: FONTS.sm, marginBottom: 4 },
  versionSubtext: { fontSize: FONTS.xs },
  signOutButton: {
    marginTop: SPACING.xs,
    marginBottom: SPACING.sm,
  },
});
