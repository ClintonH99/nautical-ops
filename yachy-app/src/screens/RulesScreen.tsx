import { ScreenLoading } from '../components/ScreenLoading';
import { optimisticDelete } from '../utils/optimisticDelete';
import { QuietRefreshControl as RefreshControl } from '../components/QuietRefreshControl';
import { useScreenState, useScreenLoading } from '../hooks/useScreenState';
/**
 * Rules On-Board Screen
 */

import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, Alert } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { COLORS, FONTS, SPACING, SIZES } from '../constants/theme';
import { useThemeColors } from '../hooks/useThemeColors';
import { useAuthStore } from '../store';
import rulesService from '../services/rules';
import {
  Button,
  ButtonTagCard,
  ExportBar,
  ExportButton,
  LoadingSpinner,
  PageHeader,
} from '../components';
import { generateRulesDocumentsPdf } from '../utils/rulesPdf';
import type { Rule } from '../services/rules';

function RulesPreview({
  rules,
  themeColors,
}: {
  rules: string[];
  themeColors: { textPrimary: string; textSecondary: string; border: string };
}) {
  const items = (rules || []).filter(Boolean);
  if (items.length === 0)
    return (
      <Text style={[styles.previewEmpty, { color: themeColors.textSecondary }]}>
        No rules added
      </Text>
    );

  return (
    <View style={styles.preview}>
      {items.map((rule, index) => (
        <View
          key={`${index}-${rule}`}
          style={[styles.previewRow, { borderBottomColor: themeColors.border }]}
        >
          <Text style={[styles.ruleNumber, { color: themeColors.textSecondary }]}>{index + 1}</Text>
          <Text style={[styles.ruleText, { color: themeColors.textPrimary }]}>{rule}</Text>
        </View>
      ))}
    </View>
  );
}

const RULES_INFO = {
  title: 'Rules On-Board',
  description: "The vessel's standing rules and conduct guidelines.",
  features: [
    "Read the vessel's on-board rules",
    'Keep conduct expectations clear for all crew',
    'Reference standing policies at any time',
    'Update rules as they evolve',
  ],
};

export const RulesScreen = ({ navigation }: any) => {
  const themeColors = useThemeColors();
  const { user } = useAuthStore();
  const vesselId = user?.vesselId ?? null;
  const isHOD = user?.role === 'HOD' || user?.role === 'CAPTAIN_MOV';
  const [items, setItems] = useScreenState<Rule[]>('items', []);
  const [loading, setLoading] = useScreenLoading();
  const [refreshing, setRefreshing] = useState(false);
  const [exportMode, setExportMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

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
  }, [setItems, setLoading, vesselId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const toggleSelect = (id: string) => {
    setSelectedIds((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectedRules = items.filter((item) => selectedIds.has(item.id));

  const onExportSelected = async () => {
    if (selectedRules.length === 0) {
      Alert.alert('Nothing selected', 'Tap the Rules boards you want to include, then export.');
      return;
    }
    setExporting(true);
    try {
      await generateRulesDocumentsPdf(
        selectedRules.map((item) => ({
          title: item.data?.title || item.title,
          rules: item.data?.rules || [],
        })),
        `Rules_On_Board_${new Date().toISOString().slice(0, 10)}.pdf`
      );
      setExportMode(false);
      setSelectedIds(new Set());
    } catch (e) {
      Alert.alert('Error', 'Could not export PDF');
    } finally {
      setExporting(false);
    }
  };

  const onEdit = (item: Rule) => {
    if (!isHOD) return;
    navigation.navigate('CreateRules', { ruleId: item.id });
  };

  const onDelete = (item: Rule) => {
    if (!isHOD) return;
    const displayTitle = item.data?.title || item.title;
    Alert.alert('Delete rules', `Delete "${displayTitle}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await optimisticDelete(item, setItems, () => rulesService.delete(item.id));
          } catch (e) {
            Alert.alert('Error', 'Could not delete');
          }
        },
      },
    ]);
  };

  if (!vesselId)
    return (
      <View style={[styles.center, { backgroundColor: themeColors.background }]}>
        <Text style={[styles.message, { color: themeColors.textSecondary }]}>
          Join a vessel to use Rules On-Board.
        </Text>
      </View>
    );
  if (loading) return <ScreenLoading title="Rules On-Board" />;

  return (
    <View style={styles.pageWrap}>
      <PageHeader
        title="Rules On-Board"
        info={RULES_INFO}
        infoScreenKey="rules_on_board"
        actions={
          <ExportButton
            active={exportMode}
            onPress={() => {
              if (exportMode) setSelectedIds(new Set());
              setExportMode(!exportMode);
            }}
          />
        }
      />
      {exportMode && (
        <ExportBar
          count={selectedRules.length}
          onConfirm={onExportSelected}
          exporting={exporting}
          hint="Tap Rules boards to select"
        />
      )}
      <ScrollView
        style={[styles.container, { backgroundColor: themeColors.background }]}
        contentContainerStyle={[styles.content, items.length === 0 && styles.contentEmpty]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              load();
            }}
          />
        }
      >
        {isHOD && (
          <View style={styles.createSection}>
            <Button
              title="Create Rules"
              onPress={() => navigation.navigate('CreateRules')}
              variant="primary"
              fullWidth
            />
          </View>
        )}
        <View style={styles.listHeading}>
          <Text
            style={[
              styles.sectionTitle,
              { color: themeColors.isDark ? themeColors.textPrimary : COLORS.primary },
            ]}
          >
            Published Rules
          </Text>
          <Text style={[styles.recordCount, { color: themeColors.textSecondary }]}>
            {items.length} {items.length === 1 ? 'record' : 'records'}
          </Text>
        </View>
        {items.map((item) => {
          const rules = (item.data?.rules ?? []).filter(Boolean);
          return (
            <ButtonTagCard
              key={item.id}
              headerTitle={item.data?.title || item.title}
              minimal
              showCheckbox={exportMode}
              checked={selectedIds.has(item.id)}
              onToggleSelect={exportMode ? () => toggleSelect(item.id) : undefined}
              collapsible={!exportMode}
              expanded={expandedId === item.id}
              onToggleExpand={() =>
                setExpandedId((current) => (current === item.id ? null : item.id))
              }
              onEdit={isHOD && !exportMode ? () => onEdit(item) : undefined}
              onDelete={isHOD && !exportMode ? () => onDelete(item) : undefined}
              summary={
                <Text style={[styles.cardSummary, { color: themeColors.textSecondary }]}>
                  {rules.length} {rules.length === 1 ? 'rule' : 'rules'}
                </Text>
              }
            >
              <RulesPreview rules={rules} themeColors={themeColors} />
            </ButtonTagCard>
          );
        })}
        {items.length === 0 && (
          <Text style={[styles.emptyText, { color: themeColors.textSecondary }]}>
            No published rules yet.
          </Text>
        )}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  pageWrap: { flex: 1 },
  container: { flex: 1 },
  content: { padding: SPACING.lg, paddingBottom: SIZES.bottomScrollPadding },
  contentEmpty: { flexGrow: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: SPACING.lg },
  message: { fontSize: FONTS.base, textAlign: 'center' },
  listHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: SPACING.sm,
    paddingHorizontal: 2,
  },
  sectionTitle: { fontSize: FONTS.base, fontWeight: '700' },
  recordCount: { fontSize: FONTS.sm },
  cardSummary: { fontSize: FONTS.sm, lineHeight: 19 },
  preview: {
    marginBottom: SPACING.sm,
  },
  previewRow: {
    flexDirection: 'row',
    gap: SPACING.sm,
    paddingVertical: SPACING.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  ruleNumber: { width: 24, fontSize: FONTS.xs, fontWeight: '700' },
  ruleText: { flex: 1, fontSize: FONTS.sm, lineHeight: 19 },
  previewEmpty: { fontSize: FONTS.sm, fontStyle: 'italic', marginTop: SPACING.sm },
  emptyText: { fontSize: FONTS.base, marginBottom: SPACING.xl, textAlign: 'center' },
  createSection: { marginBottom: SPACING.lg },
});
