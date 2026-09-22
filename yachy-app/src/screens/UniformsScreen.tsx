/**
 * Uniforms Screen
 * Create button, department filter, list of uniform labels. Export mode:
 * select labels → Export to PDF.
 */
import React, { useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
  Alert,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SIZES } from '../constants/theme';
import { useAuthStore } from '../store';
import { useThemeColors } from '../hooks/useThemeColors';
import uniformsService, { Uniform } from '../services/uniforms';
import { Department } from '../types';
import { exportUniformsToPdf } from '../utils/uniformsPdf';
import {
  Button,
  Input,
  ButtonTagCard,
  PageHeader,
  ExportButton,
  ExportBar,
  DepartmentMultiSelector,
} from '../components';
import { DEPARTMENT_OPTIONS as DEPARTMENTS } from '../utils/departmentSelection';

export const UniformsScreen = ({ navigation }: any) => {
  const themeColors = useThemeColors();
  const { user } = useAuthStore();
  const [uniforms, setUniforms] = useState<Uniform[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [visibleDepartments, setVisibleDepartments] = useState<Record<Department, boolean>>({
    BRIDGE: true,
    ENGINEERING: true,
    EXTERIOR: true,
    INTERIOR: true,
    GALLEY: true,
  });
  const [exportMode, setExportMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const loadedVesselIdRef = useRef<string | null>(null);

  const vesselId = user?.vesselId ?? null;

  const matchesSearch = (u: Uniform) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase().trim();
    if ((u.label ?? '').toLowerCase().includes(q)) return true;
    for (const e of u.entries ?? []) {
      if ((e.size ?? '').toLowerCase().includes(q)) return true;
      if ((e.color ?? '').toLowerCase().includes(q)) return true;
    }
    return false;
  };

  const filteredUniforms = (uniforms ?? [])
    .filter((u) => visibleDepartments[u.department ?? 'INTERIOR'])
    .filter(matchesSearch);

  const uniqueValues = (values: Array<string | undefined>) => {
    const unique = Array.from(
      new Set(values.map((value) => value?.trim()).filter((value): value is string => !!value))
    );
    return unique.length ? unique.join(', ') : 'Not specified';
  };

  const uniformUse = (uniform: Uniform) => {
    const combined = (uniform.entries ?? [])
      .map((entry) => entry.dayNight?.trim().toLowerCase() ?? '')
      .join(' ');
    const hasDay = combined.includes('day');
    const hasNight = combined.includes('night');
    if (hasDay && hasNight) return 'Day & Night';
    if (hasDay) return 'Day';
    if (hasNight) return 'Night';
    return 'Not specified';
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectedUniforms = filteredUniforms.filter((u) => selectedIds.has(u.id));

  const handleExportPdf = async () => {
    if (selectedUniforms.length === 0) {
      Alert.alert('No selection', 'Select at least one label to export.');
      return;
    }
    setExporting(true);
    try {
      await exportUniformsToPdf(selectedUniforms);
      setExportMode(false);
      setSelectedIds(new Set());
    } catch (e) {
      console.error('Export PDF error:', e);
      Alert.alert('Error', 'Could not export PDF.');
    } finally {
      setExporting(false);
    }
  };

  const handleDelete = (u: Uniform) => {
    Alert.alert('Delete Uniform Label', `Delete "${u.label}" and all its entries?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await uniformsService.delete(u.id);
            setUniforms((prev) => prev.filter((i) => i.id !== u.id));
          } catch (e) {
            console.error('Delete uniform error:', e);
            Alert.alert('Error', 'Could not delete uniform label.');
          }
        },
      },
    ]);
  };

  const loadUniforms = useCallback(async () => {
    if (!vesselId) return;
    if (loadedVesselIdRef.current !== vesselId) {
      loadedVesselIdRef.current = vesselId;
      setUniforms([]);
      setLoading(true);
    }
    try {
      const data = await uniformsService.getByVessel(vesselId);
      setUniforms(data);
    } catch (e) {
      console.error('Load uniforms error:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [vesselId]);

  useFocusEffect(
    useCallback(() => {
      loadUniforms();
    }, [loadUniforms])
  );

  const onRefresh = () => {
    setRefreshing(true);
    loadUniforms();
  };

  if (!vesselId) {
    return (
      <View style={[styles.center, { backgroundColor: themeColors.background }]}>
        <Text style={[styles.message, { color: themeColors.textSecondary }]}>
          Join a vessel to use Uniforms.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.pageWrap}>
      <PageHeader
        title="Uniforms"
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
          count={selectedUniforms.length}
          onConfirm={handleExportPdf}
          exporting={exporting}
          hint="Tap uniforms to select"
        />
      )}
      <ScrollView
        style={[styles.container, { backgroundColor: themeColors.background }]}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[COLORS.primary]} />
        }
      >
        <View style={styles.createRow}>
          <Button
            title="Create Uniform Label"
            onPress={() => navigation.navigate('AddEditUniform')}
            variant="primary"
            fullWidth
          />
        </View>
        <View style={styles.searchRow}>
          <Input
            variant="search"
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search label, size or colour…"
            style={styles.searchInput}
            returnKeyType="search"
          />
        </View>
        <DepartmentMultiSelector
          value={DEPARTMENTS.filter((department) => visibleDepartments[department])}
          onChange={(departments) =>
            setVisibleDepartments(
              DEPARTMENTS.reduce(
                (next, department) => ({ ...next, [department]: departments.includes(department) }),
                {} as Record<Department, boolean>
              )
            )
          }
          includeAll
          minSelections={1}
          layout="stacked"
          tightTop
        />

        <View style={styles.listHeading}>
          <Text
            style={[
              styles.listHeadingTitle,
              { color: themeColors.isDark ? themeColors.textPrimary : COLORS.primary },
            ]}
          >
            Uniform Labels
          </Text>
          <Text style={[styles.recordCount, { color: themeColors.textSecondary }]}>
            {filteredUniforms.length} {filteredUniforms.length === 1 ? 'label' : 'labels'}
          </Text>
        </View>

        {loading ? (
          <ActivityIndicator size="small" color={COLORS.primary} style={styles.loader} />
        ) : filteredUniforms.length === 0 ? (
          <Text style={[styles.empty, { color: themeColors.textSecondary }]}>
            {uniforms.length === 0
              ? 'No uniform labels yet. Tap Create Uniform Label to add one.'
              : 'No labels match your search or department filter.'}
          </Text>
        ) : (
          filteredUniforms.map((u) => {
            const selected = selectedIds.has(u.id);
            const use = uniformUse(u);
            const sizes = uniqueValues((u.entries ?? []).map((entry) => entry.size));
            const colours = uniqueValues((u.entries ?? []).map((entry) => entry.color));
            const entryCount = u.entries?.length ?? 0;
            return (
              <ButtonTagCard
                key={u.id}
                headerTitle={u.label ?? ''}
                minimal
                showCheckbox={exportMode}
                checked={selected}
                onToggleSelect={() => toggleSelect(u.id)}
                selected={exportMode && selected}
                onEdit={() => navigation.navigate('AddEditUniform', { uniformId: u.id })}
                onDelete={() => handleDelete(u)}
                collapsible={!exportMode}
                expanded={expandedId === u.id}
                onToggleExpand={() => setExpandedId(expandedId === u.id ? null : u.id)}
                summary={
                  <View style={styles.cardMetaLine}>
                    <View
                      style={[styles.departmentBadge, { backgroundColor: themeColors.accentSoft }]}
                    >
                      <Text
                        style={[
                          styles.departmentBadgeText,
                          { color: themeColors.isDark ? themeColors.textPrimary : COLORS.primary },
                        ]}
                      >
                        {u.department ?? 'INTERIOR'}
                      </Text>
                    </View>
                    <Text style={[styles.cardMetaText, { color: themeColors.textSecondary }]}>
                      {entryCount} {entryCount === 1 ? 'entry' : 'entries'}
                    </Text>
                    <Text style={[styles.cardMetaDivider, { color: themeColors.textMuted }]}>
                      •
                    </Text>
                    <Text style={[styles.cardMetaText, { color: themeColors.textSecondary }]}>
                      {use}
                    </Text>
                  </View>
                }
              >
                <View style={[styles.uniformSummary, { backgroundColor: themeColors.surfaceAlt }]}>
                  <View style={styles.summaryColumn}>
                    <Text style={[styles.summaryLabel, { color: themeColors.textSecondary }]}>
                      Sizes
                    </Text>
                    <Text style={[styles.summaryValue, { color: themeColors.textPrimary }]}>
                      {sizes}
                    </Text>
                  </View>
                  <View style={styles.summaryColumn}>
                    <Text style={[styles.summaryLabel, { color: themeColors.textSecondary }]}>
                      Colours
                    </Text>
                    <Text style={[styles.summaryValue, { color: themeColors.textPrimary }]}>
                      {colours}
                    </Text>
                  </View>
                  <View style={styles.summaryColumn}>
                    <Text style={[styles.summaryLabel, { color: themeColors.textSecondary }]}>
                      Use
                    </Text>
                    <Text style={[styles.summaryValue, { color: themeColors.textPrimary }]}>
                      {use}
                    </Text>
                  </View>
                </View>
              </ButtonTagCard>
            );
          })
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
  searchRow: { marginBottom: SPACING.sm },
  searchInput: {},
  createRow: { marginBottom: SPACING.sm },
  loader: { marginVertical: SPACING.xl },
  empty: { fontSize: FONTS.base, paddingVertical: SPACING.xl },
  listHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: SPACING.md,
    marginBottom: SPACING.sm,
  },
  listHeadingTitle: { fontSize: FONTS.base, fontWeight: '700' },
  recordCount: { fontSize: FONTS.sm },
  cardMetaLine: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: SPACING.xs,
  },
  departmentBadge: {
    paddingHorizontal: SPACING.sm,
    paddingVertical: 4,
    borderRadius: BORDER_RADIUS.sm,
    alignSelf: 'flex-start',
  },
  departmentBadgeText: { fontSize: 11, fontWeight: '700', letterSpacing: 0.4 },
  cardMetaText: { fontSize: FONTS.xs },
  cardMetaDivider: { fontSize: FONTS.xs },
  uniformSummary: {
    flexDirection: 'row',
    gap: SPACING.sm,
    padding: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    marginTop: SPACING.sm,
  },
  summaryColumn: { flex: 1, minWidth: 0 },
  summaryLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    marginBottom: 3,
  },
  summaryValue: { fontSize: FONTS.sm, fontWeight: '600' },
});
