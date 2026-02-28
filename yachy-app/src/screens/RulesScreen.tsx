/**
 * Rules On-Board Screen
 */

import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, RefreshControl, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SIZES } from '../constants/theme';
import { useThemeColors } from '../hooks/useThemeColors';
import { useAuthStore } from '../store';
import rulesService from '../services/rules';
import { Button } from '../components';
import { generateRulesPdf } from '../utils/rulesPdf';
import type { Rule } from '../services/rules';

function RulesPreview({ rules, themeColors }: { rules: string[]; themeColors: { textPrimary: string; textSecondary: string } }) {
  const items = (rules || []).filter(Boolean);
  if (items.length === 0) return <Text style={[styles.previewEmpty, { color: themeColors.textSecondary }]}>No rules added</Text>;

  return (
    <View style={styles.preview}>
      {items.slice(0, 4).map((r, i) => (
        <Text key={i} style={[styles.previewRow, { color: themeColors.textPrimary }]} numberOfLines={1}>
          {i + 1}. {r}
        </Text>
      ))}
      {items.length > 4 && (
        <Text style={[styles.previewMore, { color: themeColors.textSecondary }]}>+{items.length - 4} more rules</Text>
      )}
    </View>
  );
}

export const RulesScreen = ({ navigation }: any) => {
  const themeColors = useThemeColors();
  const { user } = useAuthStore();
  const vesselId = user?.vesselId ?? null;
  const [items, setItems] = useState<Rule[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [exportingId, setExportingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!vesselId) return;
    try {
      setItems(await rulesService.getByVessel(vesselId));
    } catch (e) {
      console.error('Load rules error:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [vesselId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onDownloadPdf = async (item: Rule) => {
    setExportingId(item.id);
    try {
      const fn = (item.data?.title || 'Rules').replace(/[^a-z0-9]/gi, '_') + '.pdf';
      await generateRulesPdf(item.data?.title || item.title, item.data?.rules || [], fn);
    } catch (e) {
      Alert.alert('Error', 'Could not export PDF');
    } finally {
      setExportingId(null);
    }
  };

  const onEdit = (item: Rule) => {
    navigation.navigate('CreateRules', { ruleId: item.id });
  };

  const onDelete = (item: Rule) => {
    const displayTitle = item.data?.title || item.title;
    Alert.alert(
      'Delete rules',
      `Delete "${displayTitle}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await rulesService.delete(item.id);
              load();
            } catch (e) {
              Alert.alert('Error', 'Could not delete');
            }
          },
        },
      ]
    );
  };

  if (!vesselId) return <View style={[styles.center, { backgroundColor: themeColors.background }]}><Text style={[styles.message, { color: themeColors.textSecondary }]}>Join a vessel to use Rules On-Board.</Text></View>;
  if (loading) return <View style={[styles.center, { backgroundColor: themeColors.background }]}><ActivityIndicator size="large" color={COLORS.primary} /></View>;

  return (
    <ScrollView style={[styles.container, { backgroundColor: themeColors.background }]} contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}>
      <Text style={[styles.sectionTitle, { color: themeColors.textSecondary }]}>Published</Text>
      {items.map((item) => (
        <TouchableOpacity
          key={item.id}
          style={[styles.card, { backgroundColor: themeColors.surface }]}
          onPress={() => onEdit(item)}
          activeOpacity={0.8}
        >
          <View style={styles.cardHeader}>
            <Text style={[styles.cardTitle, { color: themeColors.textPrimary }]} numberOfLines={1}>{item.data?.title || item.title}</Text>
            <TouchableOpacity onPress={() => onDelete(item)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Ionicons name="trash-outline" size={20} color={COLORS.danger} />
            </TouchableOpacity>
          </View>
          <RulesPreview rules={item.data?.rules ?? []} themeColors={themeColors} />
          <TouchableOpacity style={styles.downloadBtn} onPress={() => onDownloadPdf(item)} disabled={!!exportingId}>
            {exportingId === item.id ? <ActivityIndicator size="small" color={COLORS.primary} /> : <Text style={styles.downloadBtnText}>Download PDF</Text>}
          </TouchableOpacity>
        </TouchableOpacity>
      ))}
      {items.length === 0 && <Text style={[styles.emptyText, { color: themeColors.textSecondary }]}>No published rules yet. Create one below.</Text>}
      <View style={styles.createSection}>
        <Button title="Create" onPress={() => navigation.navigate('CreateRules')} variant="primary" fullWidth />
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: SPACING.lg, paddingBottom: SIZES.bottomScrollPadding },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: SPACING.lg },
  message: { fontSize: FONTS.base, textAlign: 'center' },
  sectionTitle: { fontSize: FONTS.sm, fontWeight: '600', marginBottom: SPACING.md },
  card: { borderRadius: BORDER_RADIUS.lg, padding: SPACING.lg, marginBottom: SPACING.md, shadowColor: COLORS.black, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 6, elevation: 3 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: SPACING.sm },
  cardTitle: { fontSize: FONTS.lg, fontWeight: '600', flex: 1 },
  preview: {
    marginTop: SPACING.sm,
    marginBottom: SPACING.md,
    paddingTop: SPACING.sm,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  previewRow: { fontSize: FONTS.sm, marginBottom: 2 },
  previewMore: { fontSize: FONTS.xs, marginTop: 2 },
  previewEmpty: { fontSize: FONTS.sm, fontStyle: 'italic', marginTop: SPACING.sm },
  downloadBtn: { alignSelf: 'flex-start', paddingVertical: SPACING.xs },
  downloadBtnText: { fontSize: FONTS.base, color: COLORS.primary, fontWeight: '600' },
  emptyText: { fontSize: FONTS.base, marginBottom: SPACING.xl, textAlign: 'center' },
  createSection: { marginTop: SPACING.lg },
});
