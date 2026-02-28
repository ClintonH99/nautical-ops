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

const MARITIME = {
  bgDark: '#0f172a',
  textOnDark: '#f8fafc',
  textMuted: '#94a3b8',
  accentGold: '#c9a227',
  accentTeal: '#0d9488',
  captainCard: 'rgba(201, 162, 39, 0.12)',
  captainBorder: 'rgba(201, 162, 39, 0.4)',
  crewCard: 'rgba(13, 148, 136, 0.12)',
  crewBorder: 'rgba(13, 148, 136, 0.4)',
};

const CAPTAIN_BENEFITS = ['Create & manage your vessel', 'Generate invite codes for crew', 'Full operations control'];
const CREW_BENEFITS = ['Join with captain\'s invite code', 'Access tasks & maintenance logs', 'Stay connected onboard'];

export const CreateAccountChoiceScreen = ({ navigation }: any) => {
  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={MARITIME.bgDark} />
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="chevron-back" size={28} color={MARITIME.textOnDark} />
        </TouchableOpacity>

        <Text style={styles.title}>Welcome aboard</Text>
        <Text style={styles.subtitle}>
          Nautical Ops helps yacht crews manage trips, tasks, maintenance, and more. Choose your role to get started.
        </Text>

        <View style={styles.cardsContainer}>
          <View style={[styles.optionCard, styles.captainCard]}>
            <View style={[styles.iconBadge, { backgroundColor: MARITIME.captainBorder }]}>
              <Ionicons name="boat-outline" size={28} color={MARITIME.accentGold} />
            </View>
            <Text style={styles.optionTitle}>Captain</Text>
            <Text style={styles.optionSubtitle}>Vessel owner or person in charge</Text>
            <Text style={styles.optionDescription}>
              Set up your vessel, add your crew, and manage day‑to‑day operations from one place.
            </Text>
            <View style={styles.benefitsList}>
              {CAPTAIN_BENEFITS.map((item, i) => (
                <View key={i} style={styles.benefitRow}>
                  <Ionicons name="checkmark-circle" size={16} color={MARITIME.accentGold} style={styles.benefitIcon} />
                  <Text style={styles.benefitText}>{item}</Text>
                </View>
              ))}
            </View>
            <Button
              title="Create captain account"
              onPress={() => navigation.navigate('RegisterCaptain')}
              variant="primary"
              fullWidth
              style={styles.optionButton}
            />
          </View>

          <View style={[styles.optionCard, styles.crewCard]}>
            <View style={[styles.iconBadge, { backgroundColor: MARITIME.crewBorder }]}>
              <Ionicons name="people-outline" size={28} color={MARITIME.accentTeal} />
            </View>
            <Text style={styles.optionTitle}>Crew member</Text>
            <Text style={styles.optionSubtitle}>Joining an existing vessel</Text>
            <Text style={styles.optionDescription}>
              Connect to your vessel using the invite code from your captain. Access your duties and stay in sync.
            </Text>
            <View style={styles.benefitsList}>
              {CREW_BENEFITS.map((item, i) => (
                <View key={i} style={styles.benefitRow}>
                  <Ionicons name="checkmark-circle" size={16} color={MARITIME.accentTeal} style={styles.benefitIcon} />
                  <Text style={styles.benefitText}>{item}</Text>
                </View>
              ))}
            </View>
            <Button
              title="Create crew account"
              onPress={() => navigation.navigate('RegisterCrew')}
              variant="outline"
              fullWidth
              style={styles.optionButtonOutline}
            />
          </View>
        </View>

        <Text style={styles.footerHint}>
          Not sure? Captains create vessels and invite others. Crew join with a code.
        </Text>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: MARITIME.bgDark,
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
    color: MARITIME.textOnDark,
    textAlign: 'center',
    marginTop: SPACING.lg,
    marginBottom: SPACING.sm,
    letterSpacing: -0.3,
  },
  subtitle: {
    fontSize: FONTS.base,
    color: MARITIME.textMuted,
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
  captainCard: {
    backgroundColor: MARITIME.captainCard,
    borderColor: MARITIME.captainBorder,
  },
  crewCard: {
    backgroundColor: MARITIME.crewCard,
    borderColor: MARITIME.crewBorder,
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
    color: MARITIME.textOnDark,
    marginBottom: 2,
    textAlign: 'center',
    letterSpacing: -0.2,
  },
  optionSubtitle: {
    fontSize: FONTS.xs,
    color: MARITIME.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: SPACING.sm,
  },
  optionDescription: {
    fontSize: FONTS.sm,
    color: MARITIME.textMuted,
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
    color: MARITIME.textOnDark,
    flex: 1,
  },
  optionButton: {
    marginTop: 0,
  },
  optionButtonOutline: {
    marginTop: 0,
    borderColor: MARITIME.accentTeal,
  },
  footerHint: {
    fontSize: FONTS.xs,
    color: MARITIME.textMuted,
    textAlign: 'center',
    fontStyle: 'italic',
    lineHeight: 18,
  },
});
