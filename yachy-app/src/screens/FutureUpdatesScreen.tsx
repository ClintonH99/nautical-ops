/**
 * Future Updates & Features Screen
 * Shows what's coming next in Nautical Ops
 */

import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
} from 'react-native';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SIZES, SHADOWS } from '../constants/theme';
import { useThemeStore, BACKGROUND_THEMES } from '../store';

const UPCOMING: { icon: string; title: string; description: string; status: 'soon' | 'planned' | 'in-progress' }[] = [
  {
    icon: '🤖',
    title: 'AI Crew Assistant',
    description: 'Ask questions about your vessel, get maintenance reminders, and receive smart task suggestions powered by AI.',
    status: 'planned',
  },
  {
    icon: '📄',
    title: 'Document Storage',
    description: 'Upload and store vessel certificates, crew documents, and insurance papers securely in the app.',
    status: 'planned',
  },
  {
    icon: '🌦️',
    title: 'Weather Integration',
    description: 'Real-time weather and sea state forecasts linked to your upcoming trips and departure checklists.',
    status: 'planned',
  },
  {
    icon: '🤝',
    title: 'Guest Management',
    description: 'Track guest preferences, dietary requirements, and trip history across multiple charters.',
    status: 'planned',
  },
  {
    icon: '🤖',
    title: 'Android App',
    description: 'A native Android app so the full crew can use Nautical Ops regardless of their device.',
    status: 'in-progress',
  },
  {
    icon: '📊',
    title: 'Reporting & Analytics',
    description: 'Monthly and annual reports for maintenance hours, trip summaries, and crew task performance.',
    status: 'planned',
  },
  {
    icon: '🔗',
    title: 'Calendar Sync',
    description: 'Sync your vessel trips and tasks with Apple Calendar, Google Calendar, and Outlook.',
    status: 'planned',
  },
  {
    icon: '💬',
    title: 'Crew Messaging',
    description: 'In-app messaging between crew members, with department-specific channels and announcements.',
    status: 'planned',
  },
];

const STATUS_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  'in-progress': { label: 'In Progress', color: '#0d9488', bg: 'rgba(13,148,136,0.1)' },
  soon: { label: 'Coming Soon', color: '#d97706', bg: 'rgba(217,119,6,0.1)' },
  planned: { label: 'Planned', color: '#6366f1', bg: 'rgba(99,102,241,0.1)' },
};

export const FutureUpdatesScreen = () => {
  const backgroundTheme = useThemeStore((s) => s.backgroundTheme);
  const themeColors = BACKGROUND_THEMES[backgroundTheme];

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: themeColors.background }]}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.header}>
        <Text style={[styles.title, { color: themeColors.textPrimary }]}>
          What's Coming Next
        </Text>
        <Text style={[styles.subtitle, { color: themeColors.textSecondary }]}>
          Nautical Ops is always evolving. Here's what we're working on.
        </Text>
      </View>

      <View style={styles.list}>
        {UPCOMING.map((item, i) => {
          const statusStyle = STATUS_LABELS[item.status];
          return (
            <View
              key={i}
              style={[styles.card, { backgroundColor: themeColors.surface }]}
            >
              <View style={styles.cardTop}>
                <Text style={styles.cardIcon}>{item.icon}</Text>
                <View style={styles.cardMeta}>
                  <Text style={[styles.cardTitle, { color: themeColors.textPrimary }]}>
                    {item.title}
                  </Text>
                  <View style={[styles.badge, { backgroundColor: statusStyle.bg }]}>
                    <Text style={[styles.badgeText, { color: statusStyle.color }]}>
                      {statusStyle.label}
                    </Text>
                  </View>
                </View>
              </View>
              <Text style={[styles.cardDesc, { color: themeColors.textSecondary }]}>
                {item.description}
              </Text>
            </View>
          );
        })}
      </View>

      <View style={[styles.feedbackCard, { backgroundColor: themeColors.surface }]}>
        <Text style={[styles.feedbackTitle, { color: themeColors.textPrimary }]}>
          💡 Have a feature idea?
        </Text>
        <Text style={[styles.feedbackText, { color: themeColors.textSecondary }]}>
          We build Nautical Ops based on feedback from real crew. Send your ideas to{' '}
          <Text style={{ color: COLORS.primary }}>support@nautical-ops.com</Text>
        </Text>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: {
    padding: SPACING.lg,
    paddingTop: SPACING.xl * 2,
    paddingBottom: SIZES.bottomScrollPadding,
  },
  header: { marginBottom: SPACING.xl },
  title: {
    fontSize: FONTS['2xl'],
    fontWeight: '700',
    marginBottom: SPACING.sm,
  },
  subtitle: {
    fontSize: FONTS.base,
    lineHeight: 22,
  },
  list: { gap: SPACING.md, marginBottom: SPACING.xl },
  card: {
    padding: SPACING.lg,
    borderRadius: BORDER_RADIUS.lg,
    ...SHADOWS.sm,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: SPACING.sm,
    gap: SPACING.md,
  },
  cardIcon: { fontSize: 28, marginTop: 2 },
  cardMeta: { flex: 1, gap: 6 },
  cardTitle: {
    fontSize: FONTS.lg,
    fontWeight: '700',
  },
  badge: {
    alignSelf: 'flex-start',
    paddingHorizontal: SPACING.sm,
    paddingVertical: 3,
    borderRadius: BORDER_RADIUS.sm,
  },
  badgeText: {
    fontSize: FONTS.xs,
    fontWeight: '600',
  },
  cardDesc: {
    fontSize: FONTS.sm,
    lineHeight: 20,
  },
  feedbackCard: {
    padding: SPACING.lg,
    borderRadius: BORDER_RADIUS.lg,
    ...SHADOWS.sm,
  },
  feedbackTitle: {
    fontSize: FONTS.lg,
    fontWeight: '700',
    marginBottom: SPACING.sm,
  },
  feedbackText: {
    fontSize: FONTS.sm,
    lineHeight: 20,
  },
});
