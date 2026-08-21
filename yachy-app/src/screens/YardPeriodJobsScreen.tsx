/**
 * Yard Period Jobs Screen
 * Flat, view-only list of every yard period job for the vessel (populated
 * via Excel import). Not tied to a specific period - periods are pure
 * calendar bookings. No in-app job creation.
 */

import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  Alert,
  Modal,
  Pressable,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SIZES } from '../constants/theme';
import { useAuthStore, useDepartmentColorStore, getDepartmentColor } from '../store';
import { useThemeColors } from '../hooks/useThemeColors';
import yardJobsService from '../services/yardJobs';
import { YardPeriodJob, Department } from '../types';

const DEPARTMENTS: Department[] = ['BRIDGE', 'ENGINEERING', 'EXTERIOR', 'INTERIOR', 'GALLEY'];
import { Button, ButtonTagCard, ButtonTagRow, LoadingSpinner } from '../components';
import { getTaskUrgencyColor } from '../utils/taskUrgency';
import { PageHeader, ExportButton, ExportBar } from '../components';
import { exportYardJobsToPdf } from '../utils/yardJobsPdf';

const SHIPYARD_INFO = {
  title: 'Shipyard List',
  description: 'Track defects and jobs for your yard period, from first report through to sign-off.',
  features: [
    'Add jobs with defect details, location and equipment serial number',
    'Set a priority - green, yellow or red - so the yard knows what is urgent',
    'Assign a contractor and yard location to each job',
    'Mark jobs complete and see who signed them off',
    'Export selected jobs to PDF to send to the yard or management',
  ],
};

export const YardPeriodJobsScreen = ({ navigation }: any) => {
  const themeColors = useThemeColors();
  const [exportMode, setExportMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);
  const { user } = useAuthStore();
  const overrides = useDepartmentColorStore((s) => s.overrides);
  const [jobs, setJobs] = useState<YardPeriodJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [visibleDepartments, setVisibleDepartments] = useState<Record<Department, boolean>>({
    BRIDGE: true,
    ENGINEERING: true,
    EXTERIOR: true,
    INTERIOR: true,
    GALLEY: true,
  });
  const [departmentDropdownOpen, setDepartmentDropdownOpen] = useState(false);

  const vesselId = user?.vesselId ?? null;

  const selectDepartment = (dept: Department) => {
    setVisibleDepartments({
      BRIDGE: dept === 'BRIDGE',
      ENGINEERING: dept === 'ENGINEERING',
      EXTERIOR: dept === 'EXTERIOR',
      INTERIOR: dept === 'INTERIOR',
      GALLEY: dept === 'GALLEY',
    });
  };

  const selectAllDepartments = () => {
    setVisibleDepartments({
      BRIDGE: true,
      ENGINEERING: true,
      EXTERIOR: true,
      INTERIOR: true,
      GALLEY: true,
    });
  };

  const filteredJobs = jobs.filter((j) => visibleDepartments[j.department ?? 'INTERIOR']);
  const isHOD = user?.role === 'HOD' || user?.role === 'CAPTAIN_MOV';

  const loadJobs = useCallback(async () => {
    if (!vesselId) return;
    try {
      const data = await yardJobsService.getByVessel(vesselId);
      setJobs(data);
    } catch (e) {
      console.error('Load yard jobs error:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [vesselId]);

  useFocusEffect(
    useCallback(() => {
      loadJobs();
    }, [loadJobs])
  );

  const onRefresh = () => {
    setRefreshing(true);
    loadJobs();
  };

  const formatDate = (d: string) =>
    new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

  const onCreate = () => {
    navigation.navigate('AddEditYardJob');
  };

  const onEdit = (job: YardPeriodJob) => {
    navigation.navigate('AddEditYardJob', { jobId: job.id });
  };

  const onDelete = (job: YardPeriodJob) => {
    Alert.alert('Delete job', `Delete "${job.jobTitle}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await yardJobsService.delete(job.id);
            loadJobs();
          } catch (e) {
            Alert.alert('Error', 'Could not delete job');
          }
        },
      },
    ]);
  };

  const onMarkComplete = (job: YardPeriodJob) => {
    if (job.status === 'COMPLETED') return;
    if (!user?.id || !user?.name) {
      Alert.alert('Error', 'Could not identify user');
      return;
    }
    yardJobsService
      .markComplete(job.id, user.id, user.name)
      .then(() => loadJobs())
      .catch(() => Alert.alert('Error', 'Could not update job'));
  };

  const getPriorityColor = (p?: string) => {
    if (p === 'RED') return COLORS.danger;
    if (p === 'YELLOW') return COLORS.warning;
    return COLORS.success;
  };

  const renderItem = ({ item }: { item: YardPeriodJob }) => {
    const borderColor = item.priority
      ? getPriorityColor(item.priority)
      : getTaskUrgencyColor(item.doneByDate, item.createdAt, item.status);
    const isComplete = item.status === 'COMPLETED';
    const deptLabel = item.department
      ? item.department.charAt(0) + item.department.slice(1).toLowerCase()
      : '';

    const dateVal = item.doneByDate
      ? `${formatDate(item.doneByDate)}${isComplete ? ' \u2713' : ''}`
      : item.createdAt
        ? formatDate(item.createdAt)
        : '';
    return (
      <ButtonTagCard
        headerTitle={item.jobTitle ?? ''}
        accentColor={borderColor}
        showCheckbox={exportMode}
        checked={selectedIds.has(item.id)}
        selected={exportMode && selectedIds.has(item.id)}
        onToggleSelect={() => toggleSelect(item.id)}
        onEdit={() => onEdit(item)}
        onDelete={() => onDelete(item)}
        onPress={!exportMode ? () => onEdit(item) : undefined}
        footer={
          isComplete && item.completedByName ? `Completed by ${item.completedByName}` : undefined
        }
      >
        {dateVal ? <ButtonTagRow label="Date" value={dateVal} /> : null}
        <ButtonTagRow
          label="Department"
          value={deptLabel}
          badgeColor={getDepartmentColor(item.department ?? 'INTERIOR', overrides)}
        />
        <ButtonTagRow label="Yard Location" value={item.yardLocation ?? ''} />
        <ButtonTagRow label="Contractor" value={item.contractorCompanyName ?? ''} />
        <ButtonTagRow label="Description" value={item.jobDescription ?? ''} />
        {!isComplete && (
          <TouchableOpacity
            style={styles.completeBtn}
            onPress={(e) => {
              e?.stopPropagation?.();
              onMarkComplete(item);
            }}
          >
            <Text style={styles.completeBtnText}>Mark complete</Text>
          </TouchableOpacity>
        )}
      </ButtonTagCard>
    );
  };

  if (!vesselId) {
    return (
      <View style={[styles.center, { backgroundColor: themeColors.background }]}>
        <Text style={[styles.message, { color: themeColors.textSecondary }]}>
          Join a vessel to see yard period jobs.
        </Text>
      </View>
    );
  }

  const departmentDisplayText = DEPARTMENTS.every((d) => visibleDepartments[d])
    ? 'All departments'
    : DEPARTMENTS.filter((d) => visibleDepartments[d])
        .map((d) => d.charAt(0) + d.slice(1).toLowerCase())
        .join(', ');

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectedJobs = filteredJobs.filter((j) => selectedIds.has(j.id));

  const handleExportPdf = async () => {
    if (selectedJobs.length === 0) {
      Alert.alert('Nothing selected', 'Tap the jobs you want to include, then export.');
      return;
    }
    setExporting(true);
    try {
      await exportYardJobsToPdf(selectedJobs);
      setExportMode(false);
      setSelectedIds(new Set());
    } catch (e: any) {
      Alert.alert('Export failed', e?.message ?? 'Could not create the PDF. Please try again.');
    } finally {
      setExporting(false);
    }
  };

  const TopBar = () => (
    <>
      <PageHeader
        title="Shipyard List"
        info={SHIPYARD_INFO}
        infoScreenKey="shipyard"
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
          count={selectedJobs.length}
          onConfirm={handleExportPdf}
          exporting={exporting}
          hint="Tap jobs to select"
        />
      )}
    </>
  );

  const ListHeader = () => (
    <>
      <View style={styles.createRow}>
        <Button title="Create" onPress={onCreate} variant="primary" fullWidth />
      </View>
      <View style={styles.filterBar}>
        <View style={styles.filterBarContent}>
          <Text style={[styles.filterLabel, { color: themeColors.textPrimary }]}>Department</Text>
          <TouchableOpacity
            style={[styles.dropdown, { backgroundColor: themeColors.surface }]}
            onPress={() => setDepartmentDropdownOpen(!departmentDropdownOpen)}
            activeOpacity={0.7}
          >
            <Text style={[styles.dropdownText, { color: themeColors.textPrimary }]}>
              {departmentDisplayText}
            </Text>
            <Text style={[styles.dropdownChevron, { color: themeColors.textSecondary }]}>
              {departmentDropdownOpen ? '\u25b2' : '\u25bc'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
      {departmentDropdownOpen && (
        <Modal visible transparent animationType="fade">
          <Pressable style={styles.modalBackdrop} onPress={() => setDepartmentDropdownOpen(false)}>
            <View
              style={[styles.modalBox, { backgroundColor: themeColors.surface }]}
              onStartShouldSetResponder={() => true}
            >
              <TouchableOpacity
                style={[
                  styles.modalItem,
                  DEPARTMENTS.every((d) => visibleDepartments[d]) && styles.modalItemSelected,
                ]}
                onPress={() => {
                  selectAllDepartments();
                  setDepartmentDropdownOpen(false);
                }}
              >
                <Text
                  style={[
                    styles.modalItemText,
                    { color: themeColors.textPrimary },
                    DEPARTMENTS.every((d) => visibleDepartments[d]) && styles.modalItemTextAll,
                  ]}
                >
                  All
                </Text>
              </TouchableOpacity>
              {DEPARTMENTS.map((dept) => (
                <TouchableOpacity
                  key={dept}
                  style={[styles.modalItem, visibleDepartments[dept] && styles.modalItemSelected]}
                  onPress={() => {
                    selectDepartment(dept);
                    setDepartmentDropdownOpen(false);
                  }}
                >
                  <Text
                    style={[
                      styles.modalItemText,
                      { color: themeColors.textPrimary },
                      visibleDepartments[dept] && styles.modalItemTextAll,
                    ]}
                  >
                    {dept.charAt(0) + dept.slice(1).toLowerCase()}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </Pressable>
        </Modal>
      )}
    </>
  );

  return (
    <View style={[styles.container, { backgroundColor: themeColors.background }]}>
      <TopBar />
      {loading ? null : jobs.length === 0 ? (
        <ScrollView
          style={[styles.container, { backgroundColor: themeColors.background }]}
          contentContainerStyle={styles.emptyWrapper}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              colors={[COLORS.primary]}
            />
          }
        >
          <ListHeader />
          <View style={styles.empty}>
            <Text style={styles.emptyEmoji}>{'\ud83d\udd27'}</Text>
            <Text style={[styles.emptyText, { color: themeColors.textSecondary }]}>
              No yard period jobs yet
            </Text>
          </View>
        </ScrollView>
      ) : (
        <FlatList
          data={filteredJobs}
          keyExtractor={(j) => j.id}
          renderItem={renderItem}
          ListHeaderComponent={<ListHeader />}
          ListEmptyComponent={
            jobs.length > 0 ? (
              <View style={styles.emptyFilter}>
                <Text
                  style={[
                    styles.emptyFilterText,
                    { color: themeColors.isDark ? COLORS.white : themeColors.textSecondary },
                  ]}
                >
                  No jobs in selected departments
                </Text>
                <Text
                  style={[
                    styles.emptyFilterHint,
                    { color: themeColors.isDark ? COLORS.white : themeColors.textSecondary },
                  ]}
                >
                  Tap the Department dropdown to choose
                </Text>
              </View>
            ) : null
          }
          contentContainerStyle={[
            styles.list,
            filteredJobs.length === 0 && jobs.length > 0 && styles.listFlex,
          ]}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              colors={[COLORS.primary]}
            />
          }
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: SPACING.lg },
  message: { fontSize: FONTS.base, textAlign: 'center' },
  createRow: { paddingHorizontal: SPACING.lg, paddingTop: SPACING.md },
  filterBar: {
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.lg,
    paddingBottom: SPACING.xs,
    marginBottom: SPACING.lg,
  },
  filterBarContent: { flex: 1 },
  filterLabel: { fontSize: FONTS.sm, fontWeight: '600', marginBottom: SPACING.sm },
  dropdown: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.lg,
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  dropdownText: { fontSize: FONTS.base, fontWeight: '500' },
  dropdownChevron: { fontSize: 10 },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.lg,
  },
  modalBox: { borderRadius: BORDER_RADIUS.lg, paddingVertical: SPACING.sm, minWidth: 200 },
  modalItem: { paddingVertical: SPACING.md, paddingHorizontal: SPACING.lg },
  modalItemSelected: { backgroundColor: COLORS.primaryLight + '20' },
  modalItemText: { fontSize: FONTS.base },
  modalItemTextAll: { fontWeight: '600' },
  emptyWrapper: { flexGrow: 1, paddingBottom: SIZES.bottomScrollPadding },
  list: { padding: SPACING.lg, paddingTop: SPACING.sm, paddingBottom: SIZES.bottomScrollPadding },
  listFlex: { flexGrow: 1 },
  emptyFilter: { padding: SPACING.xl, alignItems: 'center' },
  emptyFilterText: { fontSize: FONTS.base },
  emptyFilterHint: { fontSize: FONTS.sm, marginTop: SPACING.xs },
  completeBtn: {
    marginTop: SPACING.sm,
    alignSelf: 'flex-start',
    paddingVertical: SPACING.xs,
    paddingHorizontal: SPACING.sm,
    backgroundColor: COLORS.primaryLight,
    borderRadius: BORDER_RADIUS.sm,
  },
  completeBtnText: { fontSize: FONTS.sm, color: COLORS.white, fontWeight: '600' },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: SPACING.xl },
  emptyEmoji: { fontSize: 48, marginBottom: SPACING.md },
  emptyText: { fontSize: FONTS.lg, marginBottom: SPACING.lg },
});
