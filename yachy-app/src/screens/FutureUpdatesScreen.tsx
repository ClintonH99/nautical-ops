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
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SIZES, SHADOWS } from '../constants/theme';
import { useThemeColors } from '../hooks/useThemeColors';
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

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  released: { label: 'Released', color: '#16A34A' },
  coming_soon: { label: 'Coming Soon', color: '#D97706' },
  in_progress: { label: 'In Progress', color: '#0D9488' },
  planned: { label: 'Planned', color: '#6366F1' },
};

const STATUS_ORDER = ['in_progress', 'coming_soon', 'planned', 'released'];

export const FutureUpdatesScreen = () => {
  const themeColors = useThemeColors();

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
      style={[
        styles.card,
        {
          backgroundColor: themeColors.surface,
          borderColor: themeColors.border,
        },
      ]}
    >
      <View style={styles.cardTitleRow}>
        <View
          style={[
            styles.statusMarker,
            { backgroundColor: STATUS_LABELS[item.status]?.color ?? themeColors.accent },
          ]}
        />
        <Text
          style={[styles.cardTitle, { color: themeColors.isDark ? COLORS.white : COLORS.primary }]}
        >
          {item.title}
        </Text>
      </View>
      <Text style={[styles.cardDesc, { color: themeColors.textSecondary }]}>
        {item.description}
      </Text>
    </View>
  );

  return (
    <View style={[styles.pageWrap, { backgroundColor: themeColors.background }]}>
      <PageHeader title="Future Updates & Features" />
      <ScrollView
        style={[styles.container, { backgroundColor: themeColors.background }]}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <Text style={[styles.intro, { color: themeColors.textSecondary }]}>
          See what is coming next to Nautical Ops.
        </Text>

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
                  <Text
                    style={[
                      styles.sectionHeader,
                      { color: themeColors.isDark ? COLORS.white : COLORS.primary },
                    ]}
                  >
                    {statusStyle.label}
                  </Text>
                  <View style={[styles.badge, { backgroundColor: themeColors.accentSoft }]}>
                    <Text
                      style={[
                        styles.badgeText,
                        { color: themeColors.isDark ? '#DBE7FF' : COLORS.primary },
                      ]}
                    >
                      {itemsForStatus.length}
                    </Text>
                  </View>
                </View>
                <View style={styles.list}>{itemsForStatus.map(renderCard)}</View>
              </View>
            );
          })
        )}

        <View
          style={[
            styles.feedbackCard,
            {
              backgroundColor: themeColors.surface,
              borderColor: themeColors.border,
            },
          ]}
        >
          <Text
            style={[
              styles.feedbackTitle,
              { color: themeColors.isDark ? COLORS.white : COLORS.primary },
            ]}
          >
            Have a feature idea?
          </Text>
          <Text style={[styles.feedbackText, { color: themeColors.textSecondary }]}>
            We build Nautical Ops around feedback from real crew.
          </Text>
          <TouchableOpacity
            style={styles.emailRow}
            onPress={() => Linking.openURL('mailto:support@nautical-ops.com')}
            onLongPress={async () => {
              await Clipboard.setStringAsync('support@nautical-ops.com');
              Alert.alert('Copied', 'Email address copied to clipboard.');
            }}
            activeOpacity={0.7}
          >
            <Ionicons
              name="mail-outline"
              size={18}
              color={themeColors.isDark ? '#DBE7FF' : COLORS.primary}
            />
            <Text
              style={[styles.emailText, { color: themeColors.isDark ? '#DBE7FF' : COLORS.primary }]}
            >
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
    paddingBottom: SIZES.bottomScrollPadding,
  },
  intro: {
    fontSize: FONTS.sm,
    lineHeight: 20,
    marginBottom: SPACING.md,
  },
  section: { marginBottom: SPACING.lg },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SPACING.md,
    marginBottom: SPACING.sm,
  },
  sectionHeader: {
    fontSize: FONTS.lg,
    fontWeight: '600',
  },
  list: { gap: SPACING.sm },
  card: {
    padding: SPACING.md,
    borderRadius: BORDER_RADIUS.lg,
    borderWidth: 1,
    ...SHADOWS.md,
  },
  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    marginBottom: 6,
  },
  statusMarker: {
    width: 9,
    height: 9,
    borderRadius: BORDER_RADIUS.full,
  },
  cardTitle: {
    flex: 1,
    fontSize: FONTS.base,
    fontWeight: '600',
  },
  badge: {
    minWidth: 28,
    minHeight: 28,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 2,
    borderRadius: BORDER_RADIUS.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    fontSize: FONTS.sm,
    fontWeight: '600',
  },
  cardDesc: {
    fontSize: FONTS.sm,
    lineHeight: 20,
  },
  feedbackCard: {
    padding: SPACING.md,
    borderRadius: BORDER_RADIUS.lg,
    borderWidth: 1,
    ...SHADOWS.md,
  },
  feedbackTitle: {
    fontSize: FONTS.lg,
    fontWeight: '600',
    marginBottom: SPACING.xs,
  },
  feedbackText: {
    fontSize: FONTS.sm,
    lineHeight: 20,
  },
  emailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    marginTop: SPACING.sm,
    minHeight: 24,
  },
  emailText: {
    fontSize: FONTS.sm,
    fontWeight: '600',
  },
});
