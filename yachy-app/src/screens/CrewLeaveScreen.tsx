import { QuietRefreshControl as RefreshControl } from '../components/QuietRefreshControl';
import { useScreenState, useScreenLoading } from '../hooks/useScreenState';
/**
 * Crew Leave
 * Vessel-wide leave calendar/list. Everyone onboard may view it; only an HOD
 * or Captain/MOV may create, edit, or delete entries.
 */

import React, { useCallback, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import {
  Button,
  ButtonTagCard,
  ButtonTagRow,
  DepartmentSelector,
  LabeledDropdown,
  LoadingSpinner,
  PageHeader,
} from '../components';
import { BORDER_RADIUS, COLORS, FONTS, SHADOWS, SPACING, SIZES } from '../constants/theme';
import { CREW_LEAVE_LABELS, CREW_LEAVE_TYPES } from '../constants/crewLeave';
import { useThemeColors } from '../hooks/useThemeColors';
import crewLeaveService from '../services/crewLeave';
import { getDepartmentColor, useAuthStore, useDepartmentColorStore } from '../store';
import type { CrewLeave, CrewLeaveType, Department } from '../types';
import { formatLocalDateString, toYYYYMMDD } from '../utils';
import {
  getCrewLeaveStatus,
  getCrewLeaveStatusLabel,
  sortCrewLeave,
  type CrewLeaveStatusFilter,
} from '../utils/crewLeave';
import { formatDepartmentLabel } from '../utils/departmentSelection';

const PAGE_SIZE = 40;

type LeaveTypeFilter = CrewLeaveType | 'ALL';
type PickerMode = 'status' | 'type' | null;

const STATUS_OPTIONS: Array<{ value: CrewLeaveStatusFilter; label: string }> = [
  { value: 'ACTIVE', label: 'Current & Upcoming' },
  { value: 'CURRENT', label: 'Currently on Leave' },
  { value: 'UPCOMING', label: 'Upcoming' },
  { value: 'COMPLETED', label: 'Completed / History' },
  { value: 'ALL', label: 'All Records' },
];

const TYPE_OPTIONS: Array<{ value: LeaveTypeFilter; label: string }> = [
  { value: 'ALL', label: 'All Leave Types' },
  ...CREW_LEAVE_TYPES.map((value) => ({ value, label: CREW_LEAVE_LABELS[value] })),
];

const CREW_LEAVE_INFO = {
  title: 'Crew Leave',
  description: 'See scheduled leave for everyone onboard.',
  features: [
    'View annual, sick, rotation and other leave on the vessel calendar',
    'Filter leave by status, leave type and department',
    'Completed leave remains available under Completed / History',
    'Captain/MOV and HODs can allocate leave to any onboard crew member',
    'The selected crew member is notified when leave is published or updated',
  ],
};

function formatDateRange(startDate: string, endDate: string): string {
  const start = formatLocalDateString(startDate);
  const end = formatLocalDateString(endDate);
  return startDate === endDate ? start : `${start} – ${end}`;
}

export const CrewLeaveScreen = ({ navigation }: any) => {
  const themeColors = useThemeColors();
  const { user } = useAuthStore();
  const departmentOverrides = useDepartmentColorStore((state) => state.overrides);
  const [leave, setLeave] = useScreenState<CrewLeave[]>('leave', []);
  const [loading, setLoading] = useScreenLoading();
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useScreenState('hasMore', false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useScreenState<CrewLeaveStatusFilter>(
    'statusFilter',
    'ACTIVE'
  );
  const [leaveTypeFilter, setLeaveTypeFilter] = useScreenState<LeaveTypeFilter>(
    'leaveTypeFilter',
    'ALL'
  );
  const [departmentFilter, setDepartmentFilter] = useScreenState<Department | null>(
    'departmentFilter',
    null
  );
  const [pickerMode, setPickerMode] = useState<PickerMode>(null);
  const requestIdRef = useRef(0);
  const offsetRef = useRef(leave.length);
  const loadingMoreRef = useRef(false);
  const loadedVesselIdRef = useRef<string | null>(user?.vesselId ?? null);

  const vesselId = user?.vesselId ?? null;
  const canManage = user?.role === 'CAPTAIN_MOV' || user?.role === 'HOD';
  const today = toYYYYMMDD(new Date());
  const statusLabel =
    STATUS_OPTIONS.find((option) => option.value === statusFilter)?.label ?? 'Current & Upcoming';
  const leaveTypeLabel =
    TYPE_OPTIONS.find((option) => option.value === leaveTypeFilter)?.label ?? 'All Leave Types';
  const activeFilterCount =
    Number(statusFilter !== 'ACTIVE') +
    Number(leaveTypeFilter !== 'ALL') +
    Number(departmentFilter !== null);
  const filterTriggerColor = themeColors.isDark ? themeColors.textPrimary : COLORS.primary;

  const loadLeave = useCallback(
    async (mode: 'replace' | 'append' = 'replace') => {
      if (!vesselId) {
        setLoading(false);
        setRefreshing(false);
        return;
      }
      if (mode === 'append' && loadingMoreRef.current) return;

      const requestId = mode === 'replace' ? ++requestIdRef.current : requestIdRef.current;
      const offset = mode === 'append' ? offsetRef.current : 0;
      if (mode === 'replace') {
        if (loadedVesselIdRef.current !== vesselId) {
          loadedVesselIdRef.current = vesselId;
          setLeave([]);
          setLoading(true);
        }
      } else {
        loadingMoreRef.current = true;
        setLoadingMore(true);
      }

      try {
        const page = await crewLeaveService.getPage(
          vesselId,
          {
            status: statusFilter,
            leaveType: leaveTypeFilter === 'ALL' ? undefined : leaveTypeFilter,
            departments: departmentFilter ? [departmentFilter] : undefined,
            asOfDate: today,
          },
          offset,
          PAGE_SIZE
        );
        if (requestId !== requestIdRef.current) return;

        if (mode === 'append') {
          setLeave((current) => sortCrewLeave([...current, ...page.items], today));
          offsetRef.current += page.items.length;
        } else {
          setLeave(page.items);
          offsetRef.current = page.items.length;
          setExpandedId(null);
        }
        setHasMore(page.hasMore);
      } catch (error) {
        console.error('Load crew leave error:', error);
        Alert.alert('Unable to load crew leave', 'Check your connection and try again.');
      } finally {
        if (requestId === requestIdRef.current) {
          setLoading(false);
          setRefreshing(false);
          loadingMoreRef.current = false;
          setLoadingMore(false);
        }
      }
    },
    [
      departmentFilter,
      leaveTypeFilter,
      setHasMore,
      setLeave,
      setLoading,
      statusFilter,
      today,
      vesselId,
    ]
  );

  useFocusEffect(
    useCallback(() => {
      void loadLeave('replace');
      return () => {
        requestIdRef.current += 1;
      };
    }, [loadLeave])
  );

  const handleDelete = (item: CrewLeave) => {
    Alert.alert(
      'Delete crew leave',
      `Delete ${CREW_LEAVE_LABELS[item.leaveType].toLowerCase()} for ${item.crewMemberName}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await crewLeaveService.delete(item.id);
              await loadLeave('replace');
            } catch {
              Alert.alert('Error', 'Crew leave could not be deleted.');
            }
          },
        },
      ]
    );
  };

  const resetFilters = () => {
    setStatusFilter('ACTIVE');
    setLeaveTypeFilter('ALL');
    setDepartmentFilter(null);
  };

  const renderDepartments = (departments: Department[]) => {
    if (!departments.length) return null;
    return (
      <View style={styles.cardRow}>
        <Text style={[styles.cardLabel, { color: themeColors.textSecondary }]}>Departments</Text>
        <View style={styles.departmentBadges}>
          {departments.map((department) => (
            <View
              key={department}
              style={[
                styles.departmentBadge,
                { backgroundColor: getDepartmentColor(department, departmentOverrides) },
              ]}
            >
              <Text style={styles.departmentBadgeText}>{formatDepartmentLabel(department)}</Text>
            </View>
          ))}
        </View>
      </View>
    );
  };

  const renderItem = ({ item }: { item: CrewLeave }) => (
    <ButtonTagCard
      headerTitle={item.crewMemberName}
      minimal
      collapsible
      expanded={expandedId === item.id}
      onToggleExpand={() => setExpandedId(expandedId === item.id ? null : item.id)}
      onEdit={
        canManage && item.crewMemberId
          ? () => navigation.navigate('AddEditCrewLeave', { leaveId: item.id })
          : undefined
      }
      onDelete={canManage ? () => handleDelete(item) : undefined}
      summary={<ButtonTagRow label="Dates" value={formatDateRange(item.startDate, item.endDate)} />}
    >
      <ButtonTagRow label="Leave type" value={CREW_LEAVE_LABELS[item.leaveType]} />
      <ButtonTagRow
        label="Status"
        value={getCrewLeaveStatusLabel(getCrewLeaveStatus(item, today))}
      />
      <ButtonTagRow label="Position" value={item.crewMemberPosition ?? ''} />
      {renderDepartments(item.crewMemberDepartments)}
      <ButtonTagRow label="Notes" value={item.notes} />
    </ButtonTagCard>
  );

  const pickerOptions = pickerMode === 'status' ? STATUS_OPTIONS : TYPE_OPTIONS;

  const filterHeader = (
    <>
      {canManage ? (
        <Button
          title="Create Crew Leave"
          onPress={() => navigation.navigate('AddEditCrewLeave')}
          variant="primary"
          fullWidth
          style={styles.createButton}
        />
      ) : null}
      <View
        style={[
          styles.filterPanel,
          { backgroundColor: themeColors.surface, borderColor: themeColors.border },
        ]}
      >
        <View style={styles.filterTitleRow}>
          <Text style={[styles.filterTitle, { color: themeColors.textPrimary }]}>
            Filter Crew Leave
          </Text>
          <Text
            style={[styles.resultCount, { color: themeColors.textSecondary }]}
            accessibilityLiveRegion="polite"
          >
            {leave.length}
            {hasMore ? '+' : ''} {leave.length === 1 ? 'record' : 'records'}
          </Text>
        </View>
        <LabeledDropdown
          label="Status"
          value={statusLabel}
          open={pickerMode === 'status'}
          onPress={() => setPickerMode('status')}
          tightTop
          valueColor={filterTriggerColor}
          iconColor={filterTriggerColor}
        />
        <LabeledDropdown
          label="Leave Type"
          value={leaveTypeLabel}
          open={pickerMode === 'type'}
          onPress={() => setPickerMode('type')}
          tightTop
          valueColor={filterTriggerColor}
          iconColor={filterTriggerColor}
        />
        <DepartmentSelector
          value={departmentFilter}
          onChange={setDepartmentFilter}
          includeAll
          tightTop
        />
        {activeFilterCount > 0 ? (
          <View style={styles.filterFooter}>
            <TouchableOpacity
              onPress={resetFilters}
              style={styles.resetFiltersButton}
              accessibilityRole="button"
              accessibilityLabel="Reset crew leave filters"
            >
              <Text style={[styles.resetFiltersText, { color: filterTriggerColor }]}>
                Reset filters
              </Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </View>
    </>
  );

  const emptyMessage =
    activeFilterCount > 0
      ? 'No crew leave matches the selected filters.'
      : statusFilter === 'ACTIVE'
        ? 'No current or upcoming crew leave.'
        : 'No crew leave has been published yet.';

  return (
    <View style={[styles.page, { backgroundColor: themeColors.background }]}>
      <PageHeader title="Crew Leave" info={CREW_LEAVE_INFO} infoScreenKey="crew-leave" />
      {loading ? (
        <View style={styles.center}>
          <LoadingSpinner />
        </View>
      ) : !vesselId ? (
        <View style={styles.center}>
          <Text style={[styles.message, { color: themeColors.textSecondary }]}>
            Join a vessel to view crew leave.
          </Text>
        </View>
      ) : (
        <FlatList
          data={leave}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          ListHeaderComponent={filterHeader}
          contentContainerStyle={[styles.list, leave.length === 0 && styles.emptyList]}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                void loadLeave('replace');
              }}
              tintColor={themeColors.accent}
              colors={[themeColors.accent]}
            />
          }
          onEndReached={() => {
            if (hasMore) void loadLeave('append');
          }}
          onEndReachedThreshold={0.35}
          ListFooterComponent={loadingMore ? <LoadingSpinner /> : null}
          ListEmptyComponent={
            <Text
              style={[styles.message, styles.emptyMessage, { color: themeColors.textSecondary }]}
            >
              {emptyMessage}
            </Text>
          }
        />
      )}

      <Modal
        visible={pickerMode !== null}
        transparent
        statusBarTranslucent
        animationType="fade"
        onRequestClose={() => setPickerMode(null)}
      >
        <View style={styles.modalRoot}>
          <Pressable
            style={styles.modalBackdrop}
            onPress={() => setPickerMode(null)}
            accessibilityRole="button"
            accessibilityLabel="Close leave filter"
          />
          <View
            style={[
              styles.modalBox,
              {
                backgroundColor: themeColors.surfaceElevated,
                borderColor: themeColors.border,
                shadowColor: themeColors.isDark ? COLORS.black : '#22324a',
              },
            ]}
            accessibilityRole="menu"
            accessibilityViewIsModal
          >
            <View style={[styles.modalHeader, { borderBottomColor: themeColors.border }]}>
              <Text style={[styles.modalTitle, { color: themeColors.textPrimary }]}>
                {pickerMode === 'status' ? 'Select status' : 'Select leave type'}
              </Text>
              <TouchableOpacity
                style={styles.modalClose}
                onPress={() => setPickerMode(null)}
                accessibilityRole="button"
                accessibilityLabel="Close leave filter"
              >
                <Ionicons name="close" size={22} color={themeColors.textPrimary} />
              </TouchableOpacity>
            </View>
            <ScrollView
              style={styles.modalList}
              contentContainerStyle={styles.modalListContent}
              showsVerticalScrollIndicator
            >
              {pickerOptions.map((option) => {
                const selected =
                  pickerMode === 'status'
                    ? option.value === statusFilter
                    : option.value === leaveTypeFilter;
                return (
                  <TouchableOpacity
                    key={option.value}
                    style={[styles.modalOption, selected && styles.modalOptionSelected]}
                    onPress={() => {
                      if (pickerMode === 'status') {
                        setStatusFilter(option.value as CrewLeaveStatusFilter);
                      } else {
                        setLeaveTypeFilter(option.value as LeaveTypeFilter);
                      }
                      setPickerMode(null);
                    }}
                    activeOpacity={0.72}
                    accessibilityRole="menuitem"
                    accessibilityState={{ selected }}
                    accessibilityLabel={option.label}
                  >
                    <View style={styles.selectionMark}>
                      {selected ? (
                        <Ionicons name="checkmark" size={22} color={COLORS.white} />
                      ) : null}
                    </View>
                    <Text
                      style={[
                        styles.modalOptionText,
                        { color: selected ? COLORS.white : themeColors.textPrimary },
                        selected && styles.modalOptionTextSelected,
                      ]}
                    >
                      {option.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  page: { flex: 1 },
  list: {
    padding: SPACING.lg,
    paddingBottom: SIZES.bottomScrollPadding,
  },
  emptyList: { flexGrow: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: SPACING.xl },
  message: { fontSize: FONTS.base, textAlign: 'center', lineHeight: 22 },
  emptyMessage: { paddingVertical: SPACING.xl },
  createButton: { marginBottom: SPACING.lg },
  filterPanel: {
    borderWidth: 1,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.md,
    marginBottom: SPACING.lg,
  },
  filterTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SPACING.md,
    marginBottom: SPACING.md,
  },
  filterTitle: { fontSize: FONTS.lg, fontWeight: '700' },
  filterFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    minHeight: 32,
    gap: SPACING.sm,
    marginTop: SPACING.xs,
  },
  resultCount: { fontSize: FONTS.xs },
  resetFiltersButton: { minHeight: 32, justifyContent: 'center', paddingHorizontal: SPACING.xs },
  resetFiltersText: { fontSize: FONTS.sm, fontWeight: '700' },
  cardRow: { marginBottom: SPACING.sm },
  cardLabel: {
    fontSize: FONTS.xs,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  departmentBadges: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs },
  departmentBadge: {
    paddingHorizontal: SPACING.sm,
    paddingVertical: 4,
    borderRadius: BORDER_RADIUS.sm,
  },
  departmentBadgeText: { fontSize: FONTS.xs, fontWeight: '600', color: COLORS.white },
  modalRoot: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.md,
  },
  modalBackdrop: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.46)',
  },
  modalBox: {
    width: '100%',
    maxWidth: 460,
    maxHeight: '80%',
    alignSelf: 'center',
    borderWidth: 1,
    borderRadius: BORDER_RADIUS.md,
    overflow: 'hidden',
    ...(Platform.OS === 'ios' ? SHADOWS.md : { elevation: 8 }),
  },
  modalHeader: {
    minHeight: 56,
    paddingLeft: SPACING.md,
    paddingRight: SPACING.xs,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
  },
  modalTitle: { fontSize: FONTS.base, fontWeight: '700' },
  modalClose: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  modalList: { flexGrow: 0, flexShrink: 1, maxHeight: 326 },
  modalListContent: { paddingVertical: SPACING.xs },
  modalOption: {
    minHeight: 52,
    marginHorizontal: SPACING.xs,
    paddingHorizontal: SPACING.md,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: BORDER_RADIUS.sm,
  },
  modalOptionSelected: { backgroundColor: COLORS.primary },
  selectionMark: { width: 30, alignItems: 'flex-start' },
  modalOptionText: { fontSize: FONTS.base, fontWeight: '500' },
  modalOptionTextSelected: { fontWeight: '700' },
});
