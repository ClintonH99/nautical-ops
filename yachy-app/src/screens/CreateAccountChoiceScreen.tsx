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
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Button } from '../components';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SHADOWS } from '../constants/theme';
import { useThemeColors } from '../hooks/useThemeColors';

const ROLE_COLORS = {
  captainAccent: '#c9a227',
  captainCardBg: 'rgba(201, 162, 39, 0.12)',
  captainCardBorder: 'rgba(201, 162, 39, 0.4)',
  crewAccent: '#0d9488',
  crewCardBg: 'rgba(13, 148, 136, 0.12)',
  crewCardBorder: 'rgba(13, 148, 136, 0.4)',
};

const CAPTAIN_BENEFITS = ['Master of Vessel (MOV)', 'Create & manage your vessel', 'Generate invite codes for crew', 'Full operations control'];
const CREW_BENEFITS = ['Join with captain\'s invite code', 'Access tasks & maintenance logs', 'Stay connected onboard'];

export const CreateAccountChoiceScreen = ({ navigation }: any) => {
  const themeColors = useThemeColors();

  return (
    <View style={[styles.container, { backgroundColor: themeColors.background }]}>
      <StatusBar
        barStyle={themeColors.isDark ? 'light-content' : 'dark-content'}
        backgroundColor={themeColors.background}
      />
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="chevron-back" size={28} color={themeColors.textPrimary} />
        </TouchableOpacity>

        <Text style={[styles.title, { color: themeColors.textPrimary }]}>Welcome aboard</Text>
        <Text style={[styles.subtitle, { color: themeColors.textSecondary }]}>
          Nautical Ops helps yacht crews manage trips, tasks, maintenance, and more. Choose your role to get started.
        </Text>

        <View style={styles.cardsContainer}>
          <View style={[styles.optionCard, { backgroundColor: ROLE_COLORS.captainCardBg, borderColor: ROLE_COLORS.captainCardBorder }]}>
            <View style={[styles.iconBadge, { backgroundColor: ROLE_COLORS.captainCardBorder }]}>
              <Ionicons name="boat-outline" size={28} color={ROLE_COLORS.captainAccent} />
            </View>
            <Text style={[styles.optionTitle, { color: themeColors.textPrimary }]}>Captain (MOV)</Text>
            <Text style={[styles.optionSubtitle, { color: themeColors.textSecondary }]}>Vessel owner or person in charge</Text>
            <Text style={[styles.optionDescription, { color: themeColors.textSecondary }]}>
              Set up your vessel, add your crew, and manage day‑to‑day operations from one place.
            </Text>
            <View style={styles.benefitsList}>
              {CAPTAIN_BENEFITS.map((item, i) => (
                <View key={i} style={styles.benefitRow}>
                  <Ionicons name="checkmark-circle" size={16} color={ROLE_COLORS.captainAccent} style={styles.benefitIcon} />
                  <Text style={[styles.benefitText, { color: themeColors.textPrimary }]}>{item}</Text>
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

          <View style={[styles.optionCard, { backgroundColor: ROLE_COLORS.crewCardBg, borderColor: ROLE_COLORS.crewCardBorder }]}>
            <View style={[styles.iconBadge, { backgroundColor: ROLE_COLORS.crewCardBorder }]}>
              <Ionicons name="people-outline" size={28} color={ROLE_COLORS.crewAccent} />
            </View>
            <Text style={[styles.optionTitle, { color: themeColors.textPrimary }]}>Crew member</Text>
            <Text style={[styles.optionSubtitle, { color: themeColors.textSecondary }]}>Joining an existing vessel</Text>
            <Text style={[styles.optionDescription, { color: themeColors.textSecondary }]}>
              Connect to your vessel using the invite code from your captain. Access your duties and stay in sync.
            </Text>
            <View style={styles.benefitsList}>
              {CREW_BENEFITS.map((item, i) => (
                <View key={i} style={styles.benefitRow}>
                  <Ionicons name="checkmark-circle" size={16} color={ROLE_COLORS.crewAccent} style={styles.benefitIcon} />
                  <Text style={[styles.benefitText, { color: themeColors.textPrimary }]}>{item}</Text>
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

        <Text style={[styles.footerHint, { color: themeColors.textSecondary }]}>
          Not sure? Captains (MOV) create vessels and invite others. Crew join with a code.
        </Text>
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
    paddingHorizontal: SPACING.xl,
    paddingTop: 60,
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
    marginTop: SPACING.lg,
    marginBottom: SPACING.sm,
    letterSpacing: -0.3,
  },
  subtitle: {
    fontSize: FONTS.base,
    textAlign: 'center',
    marginBottom: SPACING.xl,
    lineHeight: 24,
    maxWidth: 320,
    alignSelf: 'center',
  },
  cardsContainer: {
    marginBottom: SPACING.lg,
  },
  optionCard: {
    borderRadius: BORDER_RADIUS.xl,
    padding: SPACING.xl,
    marginBottom: SPACING.lg,
    borderWidth: 1.5,
    alignItems: 'center',
    ...(Platform.OS === 'ios' ? SHADOWS.md : { elevation: 6 }),
  },
  iconBadge: {
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: SPACING.md,
  },
  optionTitle: {
    fontSize: FONTS.xl,
    fontWeight: '700',
    marginBottom: 2,
    textAlign: 'center',
    letterSpacing: -0.2,
  },
  optionSubtitle: {
    fontSize: FONTS.xs,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: SPACING.sm,
  },
  optionDescription: {
    fontSize: FONTS.sm,
    marginBottom: SPACING.md,
    textAlign: 'center',
    lineHeight: 20,
  },
  benefitsList: {
    alignSelf: 'stretch',
    marginBottom: SPACING.lg,
  },
  benefitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: SPACING.xs,
  },
  benefitIcon: {
    marginRight: SPACING.sm,
  },
  benefitText: {
    fontSize: FONTS.sm,
    flex: 1,
  },
  optionButton: {
    marginTop: 0,
  },
  footerHint: {
    fontSize: FONTS.xs,
    textAlign: 'center',
    fontStyle: 'italic',
    lineHeight: 18,
  },
});
