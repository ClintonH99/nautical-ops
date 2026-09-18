/**
 * Create Account Choice Screen
 * User selects Captain or Crew member to create an account
 */

import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  StatusBar,
  Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '../components';
import { FONTS, SPACING, BORDER_RADIUS, SHADOWS } from '../constants/theme';
import { useThemeColors } from '../hooks/useThemeColors';

const CAPTAIN_BENEFITS = [
  'Set up vessel operations',
  'Invite and manage crew',
  'Review vessel records',
];
const CREW_BENEFITS = [
  'Track your own records',
  'Join with an invite code anytime',
  'Access assigned vessel duties',
];
// React Native resolves bundled bitmap assets through a static require.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const APP_ICON = require('../../assets/icon.png');
const MIN_CONTENT_TOP_PADDING = 52;
const MIN_BACK_BUTTON_TOP = 48;

export const CreateAccountChoiceScreen = ({ navigation }: any) => {
  const themeColors = useThemeColors();
  const insets = useSafeAreaInsets();
  const contentTopPadding = Math.max(MIN_CONTENT_TOP_PADDING, insets.top + SPACING.md);
  const backButtonTop = Math.max(MIN_BACK_BUTTON_TOP, insets.top + SPACING.sm);
  const contentBottomPadding = Math.max(SPACING['2xl'], insets.bottom + SPACING.md);

  return (
    <View style={[styles.container, { backgroundColor: themeColors.background }]}>
      <StatusBar
        barStyle={themeColors.isDark ? 'light-content' : 'dark-content'}
        backgroundColor={themeColors.background}
      />
      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          { paddingTop: contentTopPadding, paddingBottom: contentBottomPadding },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <TouchableOpacity
          style={[styles.backButton, { top: backButtonTop }]}
          onPress={() => navigation.goBack()}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="chevron-back" size={28} color={themeColors.textPrimary} />
        </TouchableOpacity>

        <View style={styles.brand}>
          <Image source={APP_ICON} style={styles.appIcon} />
          <Text style={[styles.appName, { color: themeColors.accent }]}>Nautical Ops</Text>
        </View>

        <Text style={[styles.title, { color: themeColors.textPrimary }]}>Welcome aboard</Text>
        <Text style={[styles.subtitle, { color: themeColors.textSecondary }]}>
          Choose how you’ll use Nautical Ops
        </Text>

        <View style={styles.cardsContainer}>
          <View
            style={[
              styles.optionCard,
              styles.optionCardUpdated,
              { backgroundColor: themeColors.surface, borderColor: themeColors.border },
            ]}
          >
            <View style={styles.roleHeader}>
              <View
                style={[
                  styles.iconBadge,
                  styles.iconBadgeUpdated,
                  { backgroundColor: themeColors.accentSoft },
                ]}
              >
                <Ionicons name="boat-outline" size={36} color={themeColors.accent} />
              </View>
              <View style={styles.roleText}>
                <Text style={[styles.optionTitle, { color: themeColors.textPrimary }]}>
                  Captain (MOV)
                </Text>
                <Text
                  style={[
                    styles.optionSubtitle,
                    styles.optionSubtitleUpdated,
                    { color: themeColors.textSecondary },
                  ]}
                >
                  Create and manage a vessel
                </Text>
              </View>
            </View>
            <View style={styles.benefitsList}>
              {CAPTAIN_BENEFITS.map((item, i) => (
                <View key={i} style={styles.benefitRow}>
                  <View style={[styles.checkBadge, { backgroundColor: themeColors.accentSoft }]}>
                    <Ionicons name="checkmark" size={16} color={themeColors.accent} />
                  </View>
                  <Text style={[styles.benefitText, { color: themeColors.textPrimary }]}>
                    {item}
                  </Text>
                </View>
              ))}
            </View>
            <Button
              title="Create Captain Account"
              onPress={() => navigation.navigate('RegisterCaptain')}
              variant="primary"
              fullWidth
              style={styles.optionButton}
            />
          </View>

          <View
            style={[
              styles.optionCard,
              styles.optionCardUpdated,
              { backgroundColor: themeColors.surface, borderColor: themeColors.border },
            ]}
          >
            <View style={styles.roleHeader}>
              <View
                style={[
                  styles.iconBadge,
                  styles.iconBadgeUpdated,
                  { backgroundColor: themeColors.accentSoft },
                ]}
              >
                <Ionicons name="people-outline" size={36} color={themeColors.accent} />
              </View>
              <View style={styles.roleText}>
                <Text style={[styles.optionTitle, { color: themeColors.textPrimary }]}>
                  Crew Member
                </Text>
                <Text
                  style={[
                    styles.optionSubtitle,
                    styles.optionSubtitleUpdated,
                    { color: themeColors.textSecondary },
                  ]}
                >
                  Start independently or join a vessel later
                </Text>
              </View>
            </View>
            <View style={styles.benefitsList}>
              {CREW_BENEFITS.map((item, i) => (
                <View key={i} style={styles.benefitRow}>
                  <View style={[styles.checkBadge, { backgroundColor: themeColors.accentSoft }]}>
                    <Ionicons name="checkmark" size={16} color={themeColors.accent} />
                  </View>
                  <Text style={[styles.benefitText, { color: themeColors.textPrimary }]}>
                    {item}
                  </Text>
                </View>
              ))}
            </View>
            <Button
              title="Create Crew Account"
              onPress={() => navigation.navigate('RegisterCrew')}
              variant="primary"
              fullWidth
              style={styles.optionButton}
            />
          </View>
        </View>

        <View style={[styles.signInSection, { borderTopColor: themeColors.border }]}>
          <Text style={[styles.signInPrompt, { color: themeColors.textSecondary }]}>
            Already have an account?
          </Text>
          <TouchableOpacity
            onPress={() => navigation.navigate('Login')}
            accessibilityRole="button"
            accessibilityLabel="Sign in"
          >
            <Text style={[styles.signInLink, { color: themeColors.accent }]}>Sign In</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: SPACING.md,
  },
  backButton: {
    position: 'absolute',
    left: SPACING.md,
    zIndex: 10,
  },
  title: {
    fontSize: FONTS['3xl'],
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: SPACING.xs,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: FONTS.lg,
    textAlign: 'center',
    marginBottom: SPACING.xl,
    alignSelf: 'center',
  },
  cardsContainer: {
    gap: SPACING.md,
  },
  optionCard: {
    borderRadius: BORDER_RADIUS.xl,
    padding: SPACING.md,
    borderWidth: 1,
    ...SHADOWS.md,
  },
  optionCardUpdated: {
    marginBottom: 0,
  },
  iconBadge: {
    width: 72,
    height: 72,
    borderRadius: 36,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: SPACING.md,
  },
  iconBadgeUpdated: {
    marginBottom: 0,
  },
  brand: {
    alignItems: 'center',
    marginTop: SPACING.sm,
    marginBottom: SPACING.lg,
  },
  appIcon: {
    width: 62,
    height: 62,
    borderRadius: BORDER_RADIUS.lg,
    marginBottom: SPACING.xs,
  },
  appName: {
    fontSize: FONTS.lg,
    fontWeight: '700',
  },
  roleHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: SPACING.md,
  },
  roleText: {
    flex: 1,
  },
  optionTitle: {
    fontSize: FONTS.xl,
    fontWeight: '700',
    marginBottom: 4,
    letterSpacing: -0.2,
  },
  optionSubtitle: {
    fontSize: FONTS.base,
    lineHeight: 21,
  },
  optionSubtitleUpdated: {
    textTransform: 'none',
    letterSpacing: 0,
    marginBottom: 0,
  },
  benefitsList: {
    alignSelf: 'stretch',
    marginBottom: SPACING.md,
    gap: SPACING.sm,
  },
  benefitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 0,
  },
  checkBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: SPACING.md,
  },
  benefitText: {
    fontSize: FONTS.sm,
    flex: 1,
  },
  optionButton: {
    marginTop: SPACING.xs,
  },
  signInSection: {
    borderTopWidth: 1,
    alignItems: 'center',
    marginTop: SPACING.xl,
    paddingTop: SPACING.lg,
  },
  signInPrompt: {
    fontSize: FONTS.base,
    marginBottom: SPACING.xs,
  },
  signInLink: {
    fontSize: FONTS.lg,
    fontWeight: '700',
  },
});
