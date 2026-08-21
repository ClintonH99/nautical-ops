/**
 * Future Updates & Features Screen
 * Shows what's coming next in Nautical Ops — pulled live from the admin-managed
 * app_updates table, grouped by status, so this screen reflects whatever is
 * added/edited/removed via admin.nautical-ops.com.
 */

import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  TouchableOpacity,
  Linking,
  Alert,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SIZES, SHADOWS } from '../constants/theme';
import { useThemeStore, BACKGROUND_THEMES } from '../store';
import { supabase } from '../services/supabase';
import { PageHeader } from '../components';

interface AppUpdate {
  id: string;
  title: string;
  description: string;
  category: string | null;
  status: string;
  created_at: string;
}

const STATUS_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  released: { label: 'Released', color: '#16a34a', bg: 'rgba(22,163,74,0.1)' },
  coming_soon: { label: 'Coming Soon', color: '#d97706', bg: 'rgba(217,119,6,0.1)' },
  in_progress: { label: 'In Progress', color: '#0d9488', bg: 'rgba(13,148,136,0.1)' },
  planned: { label: 'Planned', color: '#6366f1', bg: 'rgba(99,102,241,0.1)' },
};

// Section display order
const STATUS_ORDER = ['released', 'coming_soon', 'in_progress', 'planned'];

export const FutureUpdatesScreen = () => {
  const backgroundTheme = useThemeStore((s) => s.backgroundTheme);
  const themeColors = BACKGROUND_THEMES[backgroundTheme];

  const [updates, setUpdates] = useState<AppUpdate[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadUpdates = async () => {
      const { data, error } = await supabase
        .from('app_updates')
        .select('*')
        .order('created_at', { ascending: false });

      if (!error && data) {
        setUpdates(data);
      }
      setLoading(false);
    };

    loadUpdates();
  }, []);

  const renderCard = (item: AppUpdate) => (
    <View
      key={item.id}
      style={[styles.card, { backgroundColor: themeColors.surface }]}
    >
      <Text style={[styles.cardTitle, { color: themeColors.textPrimary }]}>
        {item.title}
      </Text>
      <Text style={[styles.cardDesc, { color: themeColors.textSecondary }]}>
        {item.description}
      </Text>
    </View>
  );

  return (
    <View style={styles.pageWrap}>
      <PageHeader title="Future Updates" />
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

        {loading ? (
          <ActivityIndicator color={COLORS.primary} style={{ marginTop: SPACING.xl }} />
        ) : updates.length === 0 ? (
          <Text style={[styles.cardDesc, { color: themeColors.textSecondary }]}>
            No updates posted yet — check back soon.
          </Text>
        ) : (
          STATUS_ORDER.map((statusKey) => {
            const itemsForStatus = updates.filter((u) => u.status === statusKey);
            if (itemsForStatus.length === 0) return null;
            const statusStyle = STATUS_LABELS[statusKey];

            return (
              <View key={statusKey} style={styles.section}>
                <View style={styles.sectionHeaderRow}>
                  <Text style={[styles.sectionHeader, { color: themeColors.textPrimary }]}>
                    {statusStyle.label}
                  </Text>
                  <View style={[styles.badge, { backgroundColor: statusStyle.bg }]}>
                    <Text style={[styles.badgeText, { color: statusStyle.color }]}>
                      {itemsForStatus.length}
                    </Text>
                  </View>
                </View>
                <View style={styles.list}>
                  {itemsForStatus.map(renderCard)}
                </View>
              </View>
            );
          })
        )}

        <View style={[styles.feedbackCard, { backgroundColor: themeColors.surface }]}>
          <Text style={[styles.feedbackTitle, { color: themeColors.textPrimary }]}>
            Have a feature idea?
          </Text>
          <Text style={[styles.feedbackText, { color: themeColors.textSecondary }]}>
            We build Nautical Ops based on feedback from real crew. Send your ideas to:
          </Text>
          <TouchableOpacity
            onPress={() => Linking.openURL('mailto:support@nautical-ops.com')}
            onLongPress={async () => {
              await Clipboard.setStringAsync('support@nautical-ops.com');
              Alert.alert('Copied', 'Email address copied to clipboard.');
            }}
            activeOpacity={0.7}
          >
            <Text style={{ color: COLORS.primary, fontWeight: '600', marginTop: SPACING.xs }}>
              support@nautical-ops.com
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  pageWrap: { flex: 1 },
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
  section: { marginBottom: SPACING.xl },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    marginBottom: SPACING.md,
  },
  sectionHeader: {
    fontSize: FONTS.lg,
    fontWeight: '700',
  },
  list: { gap: SPACING.md },
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
