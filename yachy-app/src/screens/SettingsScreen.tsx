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
} from 'react-native';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SIZES } from '../constants/theme';
import { useFocusEffect } from '@react-navigation/native';
import { useAuthStore, useThemeStore, BACKGROUND_THEMES } from '../store';
import { Button } from '../components';
import authService from '../services/auth';
import userService from '../services/user';

export const SettingsScreen = ({ navigation }: any) => {
  const { user, logout, setUser } = useAuthStore();
  const backgroundTheme = useThemeStore((s) => s.backgroundTheme);
  const themeColors = BACKGROUND_THEMES[backgroundTheme];
  const isHOD = user?.role === 'HOD';
  const [photoLoadFailed, setPhotoLoadFailed] = useState(false);
  const profilePhotoUrl = user?.profilePhoto || (user?.id ? userService.getProfilePhotoUrl(user.id) : null);

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
    }, [user?.id, setUser])
  );

  const settingsSections = [
    {
      title: 'Account',
      items: [
        {
          icon: '👤',
          label: 'My Profile',
          description: 'Edit your personal information',
          onPress: () => navigation.navigate('Settings'),
          disabled: false,
        },
      ],
    },
    ...(isHOD
      ? [
          {
            title: 'Vessel Management',
            items: [
              {
                icon: '⚓',
                label: 'Vessel Settings',
                description: 'Vessel name, invite code, change photo',
                onPress: () => navigation.navigate('VesselSettings'),
                disabled: false,
              },
              {
                icon: '👥',
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
          icon: '🖼️',
          label: 'Appearance',
          description: 'Background theme: Day or Night Mode',
          onPress: () => navigation.navigate('ThemeSettings'),
          disabled: false,
        },
        {
          icon: '🎨',
          label: 'Department colors',
          description: 'Choose color scheme or no color per crew department',
          onPress: () => navigation.navigate('DepartmentColorSettings'),
          disabled: false,
        },
        {
          icon: '🔔',
          label: 'Notifications',
          description: 'Manage notification preferences',
          onPress: () => navigation.navigate('NotificationSettings'),
          disabled: false,
        },
        ...(Platform.OS !== 'web'
          ? [
              {
                icon: '🔗',
                label: 'Link website',
                description: 'Scan QR on website to sign in from your laptop',
                onPress: () => navigation.navigate('LinkWebsiteScan'),
                disabled: false,
              },
            ]
          : []),
        {
          icon: '📱',
          label: 'About',
          description: 'App version and information',
          onPress: () => {
            // TODO: Implement about screen
            console.log('About screen coming soon');
          },
          disabled: true,
        },
      ],
    },
  ];

  return (
    <ScrollView style={[styles.container, { backgroundColor: themeColors.background }]}>
      <View style={styles.content}>
        {/* User Header */}
        <View style={[styles.userHeader, { backgroundColor: themeColors.surface }]}>
          <View style={styles.avatarContainer}>
            {profilePhotoUrl && !photoLoadFailed ? (
              <Image
                source={{ uri: profilePhotoUrl }}
                style={styles.avatar}
                onError={() => setPhotoLoadFailed(true)}
              />
            ) : (
              <View style={styles.avatarPlaceholder}>
                <Text style={styles.avatarText}>
                  {user?.name?.charAt(0).toUpperCase()}
                </Text>
              </View>
            )}
          </View>
          <View style={styles.userInfo}>
            <Text style={[styles.userName, { color: themeColors.textPrimary }]}>{user?.name}</Text>
            <Text style={[styles.userDetails, { color: themeColors.textSecondary }]}>
              {user?.position} • {user?.department}
            </Text>
            <View style={styles.roleBadge}>
              <Text style={styles.roleText}>{user?.role}</Text>
            </View>
          </View>
        </View>

        {/* Settings Sections */}
        {settingsSections.map((section, sectionIndex) => (
          <View key={sectionIndex} style={styles.section}>
            <Text style={[styles.sectionTitle, { color: themeColors.textSecondary }]}>{section.title}</Text>
            <View style={[styles.sectionContent, { backgroundColor: themeColors.surface }]}>
              {section.items.map((item, itemIndex) => (
                <TouchableOpacity
                  key={itemIndex}
                  style={[
                    styles.settingsItem,
                    { borderBottomColor: themeColors.surfaceAlt },
                    item.disabled && styles.settingsItemDisabled,
                    itemIndex === section.items.length - 1 && styles.settingsItemLast,
                  ]}
                  onPress={item.onPress}
                  disabled={item.disabled}
                  activeOpacity={0.7}
                >
                  <View style={styles.settingsItemLeft}>
                    <Text style={styles.settingsIcon}>{item.icon}</Text>
                    <View style={styles.settingsTextContainer}>
                      <Text style={[styles.settingsLabel, { color: themeColors.textPrimary }]}>{item.label}</Text>
                      <Text style={[styles.settingsDescription, { color: themeColors.textSecondary }]}>
                        {item.description}
                      </Text>
                    </View>
                  </View>
                  <Text style={[styles.chevron, { color: themeColors.textSecondary }]}>›</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        ))}

        {/* Version Info */}
        <View style={styles.versionInfo}>
          <Text style={[styles.versionText, { color: themeColors.textSecondary }]}>Nautical Ops v1.0.0</Text>
          <Text style={[styles.versionSubtext, { color: themeColors.textSecondary }]}>
            Professional yacht operations management
          </Text>
        </View>

        {/* Sign Out */}
        <Button
          title="Sign Out"
          onPress={async () => {
            await authService.signOut();
            logout();
          }}
          variant={themeColors.isDark ? 'outlineLight' : 'outline'}
          shape="pill"
          fullWidth
          style={styles.signOutButton}
        />
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: SPACING.lg,
    paddingTop: SPACING.xl * 2,
    paddingBottom: SIZES.bottomScrollPadding,
  },
  userHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: SPACING.lg,
    borderRadius: BORDER_RADIUS.lg,
    marginBottom: SPACING.xl,
    shadowColor: '#0D0D0D',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 3,
  },
  avatarContainer: {
    marginRight: SPACING.md,
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
  },
  avatarPlaceholder: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: COLORS.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    fontSize: FONTS['2xl'],
    fontWeight: 'bold',
    color: COLORS.white,
  },
  userInfo: {
    flex: 1,
  },
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
  section: {
    marginBottom: SPACING.xl,
  },
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
  },
  settingsItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: SPACING.lg,
    borderBottomWidth: 1,
  },
  settingsItemLast: {
    borderBottomWidth: 0,
  },
  settingsItemDisabled: {
    opacity: 0.5,
  },
  settingsItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  settingsIcon: {
    fontSize: 24,
    marginRight: SPACING.md,
  },
  settingsTextContainer: {
    flex: 1,
  },
  settingsLabel: {
    fontSize: FONTS.base,
    fontWeight: '600',
    marginBottom: 2,
  },
  settingsDescription: {
    fontSize: FONTS.sm,
  },
  chevron: {
    fontSize: 24,
    fontWeight: '300',
  },
  versionInfo: {
    alignItems: 'center',
    paddingVertical: SPACING.xl,
  },
  versionText: {
    fontSize: FONTS.sm,
    marginBottom: 4,
  },
  versionSubtext: {
    fontSize: FONTS.xs,
  },
  signOutButton: {
    marginTop: SPACING.md,
    marginBottom: SPACING.lg,
  },
});
