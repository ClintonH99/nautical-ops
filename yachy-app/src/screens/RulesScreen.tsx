/**
 * Rules On-Board Screen
 */

import React, { useState, useCallback, useLayoutEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SIZES } from '../constants/theme';
import { useThemeColors } from '../hooks/useThemeColors';
import { useAuthStore } from '../store';
import rulesService from '../services/rules';
import {
  Button,
  Checkbox,
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
  themeColors: { textPrimary: string; textSecondary: string };
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
      {items.slice(0, 4).map((r, i) => (
        <Text
          key={i}
          style={[styles.previewRow, { color: themeColors.textPrimary }]}
          numberOfLines={1}
        >
          {i + 1}. {r}
        </Text>
      ))}
      {items.length > 4 && (
        <Text style={[styles.previewMore, { color: themeColors.textSecondary }]}>
          +{items.length - 4} more rules
        </Text>
      )}
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
  const [items, setItems] = useState<Rule[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [exportMode, setExportMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);

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
            await rulesService.delete(item.id);
            load();
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
  if (loading)
    return (
      <View style={[styles.center, { backgroundColor: themeColors.background }]}>
        <LoadingSpinner />
      </View>
    );

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
        contentContainerStyle={styles.content}
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
        <Text style={[styles.sectionTitle, { color: themeColors.textSecondary }]}>Published</Text>
        {items.map((item) => (
          <TouchableOpacity
            key={item.id}
            style={[styles.card, { backgroundColor: themeColors.surface }]}
            onPress={() => (exportMode ? toggleSelect(item.id) : onEdit(item))}
            activeOpacity={isHOD || exportMode ? 0.8 : 1}
            disabled={!isHOD && !exportMode}
          >
            <View style={styles.cardHeader}>
              {exportMode && (
                <Checkbox
                  checked={selectedIds.has(item.id)}
                  onPress={() => toggleSelect(item.id)}
                  surface={themeColors.surface}
                />
              )}
              <Text
                style={[styles.cardTitle, { color: themeColors.textPrimary }]}
                numberOfLines={1}
              >
                {item.data?.title || item.title}
              </Text>
              {isHOD && !exportMode && (
                <TouchableOpacity
                  onPress={() => onDelete(item)}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                  <Ionicons name="trash-outline" size={20} color={COLORS.danger} />
                </TouchableOpacity>
              )}
            </View>
            <RulesPreview rules={item.data?.rules ?? []} themeColors={themeColors} />
          </TouchableOpacity>
        ))}
        {items.length === 0 && (
          <Text style={[styles.emptyText, { color: themeColors.textSecondary }]}>
            No published rules yet.{isHOD ? ' Create one below.' : ''}
          </Text>
        )}
        {isHOD && (
          <View style={styles.createSection}>
            <Button
              title="Create"
              onPress={() => navigation.navigate('CreateRules')}
              variant="primary"
              fullWidth
            />
          </View>
        )}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  pageWrap: { flex: 1 },
  container: { flex: 1 },
  content: { padding: SPACING.lg, paddingBottom: SIZES.bottomScrollPadding },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: SPACING.lg },
  message: { fontSize: FONTS.base, textAlign: 'center' },
  sectionTitle: { fontSize: FONTS.sm, fontWeight: '600', marginBottom: SPACING.md },
  card: {
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.lg,
    marginBottom: SPACING.md,
    shadowColor: COLORS.black,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 3,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SPACING.sm,
    marginBottom: SPACING.sm,
  },
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
  emptyText: { fontSize: FONTS.base, marginBottom: SPACING.xl, textAlign: 'center' },
  createSection: { marginTop: SPACING.lg },
});
