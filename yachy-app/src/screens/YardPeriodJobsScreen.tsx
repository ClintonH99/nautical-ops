/**
 * Shipyard List
 * Active work stays separate from the permanent, folder-organised Shipyard Records archive.
 */

import React, { useCallback, useMemo, useState } from 'react';
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import {
  Button,
  ButtonTagCard,
  ButtonTagRow,
  ExportBar,
  ExportButton,
  DepartmentMultiSelector,
  Input,
  LabeledDropdown,
  LoadingSpinner,
  PageHeader,
} from '../components';
import { BORDER_RADIUS, COLORS, FONTS, SPACING, SIZES } from '../constants/theme';
import { useThemeColors } from '../hooks/useThemeColors';
import yardJobsService from '../services/yardJobs';
import { getDepartmentColor, useAuthStore, useDepartmentColorStore } from '../store';
import type { Department, ShipyardRecordFolder, YardPeriodJob } from '../types';
import { formatLocalDateString } from '../utils';
import { DEPARTMENT_OPTIONS as DEPARTMENTS } from '../utils/departmentSelection';
import { exportYardJobsToPdf } from '../utils/yardJobsPdf';
import {
  ALL_SHIPYARD_RECORDS,
  countShipyardRecords,
  filterShipyardRecords,
  type ShipyardRecordFolderFilter,
  UNFILED_SHIPYARD_RECORDS,
} from '../utils/shipyardRecords';

type PageView = 'ACTIVE' | 'RECORDS';
type FolderEditorMode = 'create' | 'rename' | null;

const SHIPYARD_INFO = {
  title: 'Shipyard List',
  description: 'Track current shipyard work and retain a permanent record after completion.',
  features: [
    'All vessel users can create jobs and mark work complete',
    'Completed jobs move into Shipyard Records with the name and time of completion',
    'All vessel users can create folders and move records between them',
    'Captain/MOV and HOD users can unmark an accidental completion',
    'Only the Captain/MOV can edit a completed record',
    'Captain/MOV and HOD users can permanently delete completed records',
  ],
};

const allDepartments = (): Record<Department, boolean> => ({
  BRIDGE: true,
  ENGINEERING: true,
  EXTERIOR: true,
  INTERIOR: true,
  GALLEY: true,
});

const departmentLabel = (department: Department) =>
  department.charAt(0) + department.slice(1).toLocaleLowerCase();

const sortFolders = (folders: ShipyardRecordFolder[]) =>
  [...folders].sort((left, right) => left.name.localeCompare(right.name));

export const YardPeriodJobsScreen = ({ navigation }: any) => {
  const themeColors = useThemeColors();
  const { user } = useAuthStore();
  const overrides = useDepartmentColorStore((state) => state.overrides);
  const vesselId = user?.vesselId ?? null;
  const isCaptain = user?.role === 'CAPTAIN_MOV';
  const canManageRecords = isCaptain || user?.role === 'HOD';

  const [pageView, setPageView] = useState<PageView>('ACTIVE');
  const [jobs, setJobs] = useState<YardPeriodJob[]>([]);
  const [folders, setFolders] = useState<ShipyardRecordFolder[]>([]);
  const [folderAssignments, setFolderAssignments] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [visibleDepartments, setVisibleDepartments] =
    useState<Record<Department, boolean>>(allDepartments);
  const [selectedFolderId, setSelectedFolderId] =
    useState<ShipyardRecordFolderFilter>(ALL_SHIPYARD_RECORDS);
  const [folderPickerOpen, setFolderPickerOpen] = useState(false);
  const [folderActionsOpen, setFolderActionsOpen] = useState(false);
  const [folderEditorMode, setFolderEditorMode] = useState<FolderEditorMode>(null);
  const [folderName, setFolderName] = useState('');
  const [folderWorking, setFolderWorking] = useState(false);
  const [movingRecord, setMovingRecord] = useState<YardPeriodJob | null>(null);
  const [movingRecordId, setMovingRecordId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [exportMode, setExportMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);

  const loadData = useCallback(async () => {
    if (!vesselId) {
      setLoading(false);
      setRefreshing(false);
      return;
    }
    try {
      const [loadedJobs, loadedFolders, loadedAssignments] = await Promise.all([
        yardJobsService.getByVessel(vesselId),
        yardJobsService.getRecordFolders(vesselId),
        yardJobsService.getRecordFolderAssignments(),
      ]);
      setJobs(loadedJobs);
      setFolders(loadedFolders);
      setFolderAssignments(
        Object.fromEntries(
          loadedAssignments.map((assignment) => [assignment.jobId, assignment.folderId])
        )
      );
      setSelectedFolderId((current) => {
        if (current === ALL_SHIPYARD_RECORDS || current === UNFILED_SHIPYARD_RECORDS) {
          return current;
        }
        return loadedFolders.some((folder) => folder.id === current)
          ? current
          : ALL_SHIPYARD_RECORDS;
      });
    } catch (error) {
      console.error('Load Shipyard List error:', error);
      Alert.alert('Could not load Shipyard List', 'Please check your connection and try again.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [vesselId]);

  useFocusEffect(
    useCallback(() => {
      void loadData();
    }, [loadData])
  );

  const activeJobs = useMemo(
    () =>
      jobs.filter(
        (job) => job.status !== 'COMPLETED' && visibleDepartments[job.department ?? 'INTERIOR']
      ),
    [jobs, visibleDepartments]
  );
  const records = useMemo(
    () =>
      filterShipyardRecords(
        jobs,
        folderAssignments,
        visibleDepartments,
        selectedFolderId,
        searchQuery
      ),
    [folderAssignments, jobs, searchQuery, selectedFolderId, visibleDepartments]
  );
  const visibleItems = pageView === 'ACTIVE' ? activeJobs : records;
  const selectedItems = visibleItems.filter((item) => selectedIds.has(item.id));
  const selectedFolder = folders.find((folder) => folder.id === selectedFolderId) ?? null;
  const recordCounts = useMemo(
    () => countShipyardRecords(jobs, folderAssignments),
    [folderAssignments, jobs]
  );
  const selectedFolderLabel =
    selectedFolderId === ALL_SHIPYARD_RECORDS
      ? `All Records (${recordCounts.all})`
      : selectedFolderId === UNFILED_SHIPYARD_RECORDS
        ? `Unfiled (${recordCounts.unfiled})`
        : selectedFolder
          ? `${selectedFolder.name} (${recordCounts.byFolder[selectedFolder.id] ?? 0})`
          : `All Records (${recordCounts.all})`;
  const resetSelection = () => {
    setExpandedId(null);
    setSelectedIds(new Set());
    setExportMode(false);
  };

  const changePageView = (nextView: PageView) => {
    if (nextView === pageView) return;
    setPageView(nextView);
    resetSelection();
  };

  const selectFolderView = (folderId: ShipyardRecordFolderFilter) => {
    setSelectedFolderId(folderId);
    setFolderPickerOpen(false);
    setSelectedIds(new Set());
    setExpandedId(null);
  };

  const toggleSelected = (id: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleExportMode = () => {
    setExportMode((current) => !current);
    setSelectedIds(new Set());
    setExpandedId(null);
  };

  const handleExport = async () => {
    if (!selectedItems.length) {
      Alert.alert('Nothing selected', 'Tap the jobs you want to include, then export.');
      return;
    }
    setExporting(true);
    try {
      await exportYardJobsToPdf(selectedItems);
      setExportMode(false);
      setSelectedIds(new Set());
    } catch (error: any) {
      Alert.alert('Export failed', error?.message ?? 'Could not create the PDF. Please try again.');
    } finally {
      setExporting(false);
    }
  };

  const markComplete = (job: YardPeriodJob) => {
    if (!user?.id || !user.name) {
      Alert.alert('Could not complete job', 'Your user details could not be confirmed.');
      return;
    }
    Alert.alert('Mark job complete?', `Move “${job.jobTitle}” to Shipyard Records?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Mark Complete',
        onPress: async () => {
          try {
            await yardJobsService.markComplete(job.id, user.id, user.name);
            await loadData();
          } catch (error: any) {
            Alert.alert('Could not complete job', error?.message || 'Please try again.');
          }
        },
      },
    ]);
  };

  const unmarkComplete = (job: YardPeriodJob) => {
    Alert.alert(
      'Return to Active Jobs?',
      `“${job.jobTitle}” will be removed from its folder and returned to the active list.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Unmark Complete',
          onPress: async () => {
            try {
              await yardJobsService.unmarkComplete(job.id);
              await loadData();
            } catch (error: any) {
              Alert.alert('Could not return job', error?.message || 'Please try again.');
            }
          },
        },
      ]
    );
  };

  const deleteJob = (job: YardPeriodJob) => {
    const isRecord = job.status === 'COMPLETED';
    Alert.alert(
      isRecord ? 'Permanently delete record?' : 'Delete job?',
      isRecord
        ? `“${job.jobTitle}” will be permanently deleted. This cannot be undone.`
        : `Delete “${job.jobTitle}”?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await yardJobsService.delete(job.id);
              await loadData();
            } catch (error: any) {
              Alert.alert('Could not delete', error?.message || 'Please try again.');
            }
          },
        },
      ]
    );
  };

  const openCreateFolder = () => {
    setFolderName('');
    setFolderActionsOpen(false);
    setFolderEditorMode('create');
  };

  const openRenameFolder = () => {
    if (!selectedFolder) return;
    setFolderName(selectedFolder.name);
    setFolderActionsOpen(false);
    setFolderEditorMode('rename');
  };

  const saveFolder = async () => {
    if (!vesselId || !folderEditorMode) return;
    const cleanName = folderName.trim();
    if (!cleanName) {
      Alert.alert('Folder name required', 'Enter a name for this folder.');
      return;
    }
    const editingFolderId = folderEditorMode === 'rename' ? selectedFolder?.id : null;
    const duplicate = folders.some(
      (folder) =>
        folder.id !== editingFolderId &&
        folder.name.toLocaleLowerCase() === cleanName.toLocaleLowerCase()
    );
    if (duplicate) {
      Alert.alert('Folder already exists', 'Choose a different folder name.');
      return;
    }

    setFolderWorking(true);
    try {
      if (folderEditorMode === 'create') {
        const created = await yardJobsService.createRecordFolder(vesselId, cleanName);
        setFolders((current) => sortFolders([...current, created]));
        Alert.alert(
          'Folder created',
          `“${created.name}” is empty. No Shipyard Records were moved.`
        );
      } else if (selectedFolder) {
        await yardJobsService.renameRecordFolder(selectedFolder.id, cleanName);
        setFolders((current) =>
          sortFolders(
            current.map((folder) =>
              folder.id === selectedFolder.id ? { ...folder, name: cleanName } : folder
            )
          )
        );
      }
      setFolderEditorMode(null);
      setFolderName('');
    } catch (error: any) {
      Alert.alert(
        'Could not save folder',
        error?.code === '23505'
          ? 'A folder with this name already exists.'
          : error?.message || 'Please try again.'
      );
    } finally {
      setFolderWorking(false);
    }
  };

  const deleteSelectedFolder = () => {
    if (!selectedFolder) return;
    setFolderActionsOpen(false);
    Alert.alert(
      'Delete folder?',
      `Are you sure you want to delete “${selectedFolder.name}”? Its Shipyard Records will remain safe and move to Unfiled.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setFolderWorking(true);
            try {
              await yardJobsService.deleteRecordFolder(selectedFolder.id);
              setFolders((current) => current.filter((folder) => folder.id !== selectedFolder.id));
              setFolderAssignments((current) =>
                Object.fromEntries(
                  Object.entries(current).filter(([, folderId]) => folderId !== selectedFolder.id)
                )
              );
              setSelectedFolderId(UNFILED_SHIPYARD_RECORDS);
              setSelectedIds(new Set());
            } catch (error: any) {
              Alert.alert('Could not delete folder', error?.message || 'Please try again.');
            } finally {
              setFolderWorking(false);
            }
          },
        },
      ]
    );
  };

  const moveRecordToFolder = async (folderId: string | null) => {
    if (!movingRecord) return;
    const currentFolderId = folderAssignments[movingRecord.id] ?? null;
    if (currentFolderId === folderId) {
      setMovingRecord(null);
      return;
    }
    setMovingRecordId(movingRecord.id);
    try {
      await yardJobsService.moveRecordToFolder(movingRecord.id, folderId);
      setFolderAssignments((current) => {
        const next = { ...current };
        if (folderId) next[movingRecord.id] = folderId;
        else delete next[movingRecord.id];
        return next;
      });
      setMovingRecord(null);
    } catch (error: any) {
      Alert.alert('Could not move record', error?.message || 'Please try again.');
    } finally {
      setMovingRecordId(null);
    }
  };

  const renderJob = ({ item }: { item: YardPeriodJob }) => {
    const isRecord = item.status === 'COMPLETED';
    const assignedFolder = folders.find((folder) => folder.id === folderAssignments[item.id]);
    const dateRange = item.startDate
      ? `${formatLocalDateString(item.startDate)}${
          item.endDate && item.endDate !== item.startDate
            ? ` – ${formatLocalDateString(item.endDate)}`
            : ''
        }`
      : item.createdAt
        ? formatLocalDateString(item.createdAt)
        : '';

    return (
      <ButtonTagCard
        headerTitle={item.jobTitle}
        accentColor={getDepartmentColor(item.department ?? 'INTERIOR', overrides)}
        collapsible={!exportMode}
        expanded={expandedId === item.id}
        onToggleExpand={() => setExpandedId((current) => (current === item.id ? null : item.id))}
        showCheckbox={exportMode}
        checked={selectedIds.has(item.id)}
        selected={selectedIds.has(item.id)}
        onToggleSelect={() => toggleSelected(item.id)}
        onEdit={
          !isRecord || isCaptain
            ? () => navigation.navigate('AddEditYardJob', { jobId: item.id })
            : undefined
        }
        onDelete={!isRecord || canManageRecords ? () => deleteJob(item) : undefined}
        summary={dateRange ? <ButtonTagRow label="Date" value={dateRange} /> : undefined}
        footer={
          isRecord && item.completedByName
            ? `Completed by ${item.completedByName}${
                item.completedAt
                  ? ` on ${new Date(item.completedAt).toLocaleString(undefined, {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })}`
                  : ''
              }`
            : undefined
        }
      >
        <ButtonTagRow
          label="Department"
          value={departmentLabel(item.department)}
          badgeColor={getDepartmentColor(item.department, overrides)}
        />
        <ButtonTagRow label="Yard Location" value={item.yardLocation ?? ''} />
        <ButtonTagRow label="Contractor" value={item.contractorCompanyName ?? ''} />
        <ButtonTagRow label="Description" value={item.jobDescription ?? ''} />
        <ButtonTagRow label="Defect Details" value={item.defectDetails ?? ''} />
        {isRecord ? (
          <>
            <ButtonTagRow label="Folder" value={assignedFolder?.name || 'Unfiled'} />
            <Button
              title="File Record"
              variant="outline"
              size="small"
              fullWidth
              onPress={() => setMovingRecord(item)}
              loading={movingRecordId === item.id}
              style={styles.inlineAction}
            />
            {canManageRecords ? (
              <Button
                title="Unmark Complete"
                variant="outline"
                size="small"
                fullWidth
                onPress={() => unmarkComplete(item)}
                style={styles.inlineAction}
              />
            ) : null}
          </>
        ) : (
          <Button
            title="Mark Complete"
            size="small"
            fullWidth
            onPress={() => markComplete(item)}
            style={styles.inlineAction}
          />
        )}
      </ButtonTagCard>
    );
  };

  if (!vesselId) {
    return (
      <View style={[styles.center, { backgroundColor: themeColors.background }]}>
        <Text style={[styles.message, { color: themeColors.textSecondary }]}>
          Join a vessel to see Shipyard Jobs.
        </Text>
      </View>
    );
  }

  const listHeader = (
    <>
      <View style={[styles.segmentedControl, { backgroundColor: themeColors.surface }]}>
        {(
          [
            ['ACTIVE', 'Active Jobs'],
            ['RECORDS', 'Shipyard Records'],
          ] as const
        ).map(([value, label]) => {
          const selected = pageView === value;
          return (
            <TouchableOpacity
              key={value}
              style={[styles.segment, selected && styles.segmentSelected]}
              onPress={() => changePageView(value)}
              accessibilityRole="button"
              accessibilityState={{ selected }}
            >
              <Text
                style={[
                  styles.segmentText,
                  { color: selected ? COLORS.white : themeColors.textPrimary },
                ]}
              >
                {label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {pageView === 'ACTIVE' ? (
        <Button
          title="Create"
          onPress={() => navigation.navigate('AddEditYardJob')}
          fullWidth
          style={styles.primaryAction}
        />
      ) : (
        <>
          <Input
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search title, defect, yard or contractor"
            returnKeyType="search"
            autoCapitalize="none"
            autoCorrect={false}
            leftIcon={<Ionicons name="search" size={20} color={themeColors.textSecondary} />}
            containerStyle={styles.searchInput}
          />
          <LabeledDropdown
            label="Folder"
            value={selectedFolderLabel}
            open={folderPickerOpen}
            onPress={() => setFolderPickerOpen(true)}
            tightTop
          />
          <View style={styles.folderToolbar}>
            <Button
              title="+ New Folder"
              onPress={openCreateFolder}
              variant="outline"
              style={styles.newFolderButton}
            />
            {selectedFolder ? (
              <TouchableOpacity
                style={[
                  styles.folderMenuButton,
                  {
                    backgroundColor: themeColors.surface,
                    borderColor: themeColors.isDark ? COLORS.gray600 : COLORS.border,
                  },
                ]}
                onPress={() => setFolderActionsOpen(true)}
                disabled={folderWorking}
                accessibilityRole="button"
                accessibilityLabel={`Manage ${selectedFolder.name}`}
              >
                <Ionicons name="ellipsis-horizontal" size={24} color={themeColors.textPrimary} />
              </TouchableOpacity>
            ) : null}
          </View>
        </>
      )}

      <DepartmentMultiSelector
        value={DEPARTMENTS.filter((department) => visibleDepartments[department])}
        onChange={(departments) => {
          setVisibleDepartments(
            DEPARTMENTS.reduce(
              (next, department) => ({ ...next, [department]: departments.includes(department) }),
              {} as Record<Department, boolean>
            )
          );
          setSelectedIds(new Set());
        }}
        includeAll
        minSelections={1}
        tightTop={pageView === 'ACTIVE'}
      />
    </>
  );

  return (
    <View style={[styles.page, { backgroundColor: themeColors.background }]}>
      <PageHeader
        title="Shipyard List"
        info={SHIPYARD_INFO}
        infoScreenKey="shipyard"
        actions={
          visibleItems.length ? (
            <ExportButton active={exportMode} onPress={toggleExportMode} busy={exporting} />
          ) : undefined
        }
      />
      {exportMode ? (
        <ExportBar
          count={selectedItems.length}
          onConfirm={handleExport}
          exporting={exporting}
          hint={pageView === 'ACTIVE' ? 'Tap jobs to select' : 'Tap records to select'}
        />
      ) : null}

      {loading ? (
        <LoadingSpinner />
      ) : (
        <FlatList
          data={visibleItems}
          keyExtractor={(item) => item.id}
          renderItem={renderJob}
          ListHeaderComponent={listHeader}
          ListEmptyComponent={
            <View style={[styles.emptyCard, { backgroundColor: themeColors.surface }]}>
              <Text style={[styles.emptyTitle, { color: themeColors.textPrimary }]}>
                {pageView === 'ACTIVE' ? 'No active Shipyard Jobs' : 'No Shipyard Records found'}
              </Text>
              <Text style={[styles.emptyText, { color: themeColors.textSecondary }]}>
                {pageView === 'ACTIVE'
                  ? 'Create a job or change the department filter.'
                  : 'Completed jobs appear here permanently. Try a different folder, department or search.'}
              </Text>
            </View>
          }
          contentContainerStyle={styles.content}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                void loadData();
              }}
              tintColor={COLORS.primary}
            />
          }
        />
      )}

      <Modal visible={folderPickerOpen} transparent animationType="fade">
        <Pressable style={styles.modalBackdrop} onPress={() => setFolderPickerOpen(false)}>
          <View
            style={[styles.modalBox, { backgroundColor: themeColors.surface }]}
            onStartShouldSetResponder={() => true}
          >
            <Text style={[styles.modalTitle, { color: themeColors.textPrimary }]}>View Folder</Text>
            <ScrollView style={styles.modalOptions} showsVerticalScrollIndicator={false}>
              {[
                { id: ALL_SHIPYARD_RECORDS, name: 'All Records', count: recordCounts.all },
                {
                  id: UNFILED_SHIPYARD_RECORDS,
                  name: 'Unfiled',
                  count: recordCounts.unfiled,
                },
                ...folders,
              ].map((folder) => {
                const selected = selectedFolderId === folder.id;
                const count =
                  'count' in folder ? folder.count : (recordCounts.byFolder[folder.id] ?? 0);
                return (
                  <TouchableOpacity
                    key={folder.id}
                    style={[
                      styles.modalItem,
                      selected && {
                        backgroundColor: themeColors.isDark ? COLORS.gray700 : COLORS.gray200,
                      },
                    ]}
                    onPress={() => selectFolderView(folder.id)}
                  >
                    <Text style={[styles.modalItemText, { color: themeColors.textPrimary }]}>
                      {folder.name}
                    </Text>
                    <Text style={[styles.folderCount, { color: themeColors.textSecondary }]}>
                      {count}
                    </Text>
                    {selected ? (
                      <Ionicons name="checkmark" size={20} color={COLORS.primaryLight} />
                    ) : null}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>

      <Modal visible={folderActionsOpen} transparent animationType="fade">
        <Pressable style={styles.modalBackdrop} onPress={() => setFolderActionsOpen(false)}>
          <View
            style={[styles.modalBox, { backgroundColor: themeColors.surface }]}
            onStartShouldSetResponder={() => true}
          >
            <Text style={[styles.modalTitle, { color: themeColors.textPrimary }]}>
              {selectedFolder ? selectedFolder.name : 'Folder'}
            </Text>
            <TouchableOpacity style={styles.modalItem} onPress={openRenameFolder}>
              <Text style={[styles.modalItemText, { color: themeColors.textPrimary }]}>
                Rename Folder
              </Text>
              <Ionicons name="pencil-outline" size={20} color={themeColors.textSecondary} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.modalItem} onPress={deleteSelectedFolder}>
              <Text style={[styles.modalItemText, { color: COLORS.danger }]}>Delete Folder</Text>
              <Ionicons name="trash-outline" size={20} color={COLORS.danger} />
            </TouchableOpacity>
          </View>
        </Pressable>
      </Modal>

      <Modal visible={!!movingRecord} transparent animationType="fade">
        <Pressable style={styles.modalBackdrop} onPress={() => setMovingRecord(null)}>
          <View
            style={[styles.modalBox, { backgroundColor: themeColors.surface }]}
            onStartShouldSetResponder={() => true}
          >
            <Text style={[styles.modalTitle, { color: themeColors.textPrimary }]}>File Record</Text>
            <Text style={[styles.modalHint, { color: themeColors.textSecondary }]}>
              Choose a folder, or leave this record unfiled.
            </Text>
            <ScrollView style={styles.modalOptions} showsVerticalScrollIndicator={false}>
              {[{ id: UNFILED_SHIPYARD_RECORDS, name: 'Unfiled' }, ...folders].map((folder) => {
                const folderId = folder.id === UNFILED_SHIPYARD_RECORDS ? null : folder.id;
                const selected = (folderAssignments[movingRecord?.id || ''] ?? null) === folderId;
                return (
                  <TouchableOpacity
                    key={folder.id}
                    style={[
                      styles.modalItem,
                      selected && {
                        backgroundColor: themeColors.isDark ? COLORS.gray700 : COLORS.gray200,
                      },
                    ]}
                    onPress={() => void moveRecordToFolder(folderId)}
                    disabled={!!movingRecordId}
                  >
                    <Text style={[styles.modalItemText, { color: themeColors.textPrimary }]}>
                      {folder.name}
                    </Text>
                    {selected ? (
                      <Ionicons name="checkmark" size={20} color={COLORS.primaryLight} />
                    ) : null}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>

      <Modal visible={!!folderEditorMode} transparent animationType="fade">
        <KeyboardAvoidingView
          style={styles.modalBackdrop}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setFolderEditorMode(null)} />
          <View
            style={[styles.modalBox, { backgroundColor: themeColors.surface }]}
            onStartShouldSetResponder={() => true}
          >
            <Text style={[styles.modalTitle, { color: themeColors.textPrimary }]}>
              {folderEditorMode === 'create' ? 'New Folder' : 'Rename Folder'}
            </Text>
            <Input
              label="Folder Name"
              value={folderName}
              onChangeText={setFolderName}
              placeholder="e.g. Refit 2026"
              autoFocus
              maxLength={80}
              returnKeyType="done"
              onSubmitEditing={() => void saveFolder()}
            />
            <View style={styles.modalActions}>
              <Button
                title="Cancel"
                variant="outline"
                onPress={() => setFolderEditorMode(null)}
                style={styles.modalAction}
                disabled={folderWorking}
              />
              <Button
                title="Save"
                onPress={() => void saveFolder()}
                style={styles.modalAction}
                loading={folderWorking}
              />
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  page: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: SPACING.lg },
  message: { fontSize: FONTS.base, textAlign: 'center' },
  content: { padding: SPACING.lg, paddingBottom: SIZES.bottomScrollPadding, flexGrow: 1 },
  segmentedControl: {
    flexDirection: 'row',
    padding: 4,
    borderRadius: BORDER_RADIUS.lg,
    marginBottom: SPACING.lg,
  },
  segment: {
    flex: 1,
    minHeight: SIZES.minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: BORDER_RADIUS.md,
    paddingHorizontal: SPACING.sm,
  },
  segmentSelected: { backgroundColor: COLORS.primary },
  segmentText: { fontSize: FONTS.sm, fontWeight: '700' },
  primaryAction: { marginBottom: SPACING.lg },
  searchInput: { marginBottom: SPACING.sm },
  folderToolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    marginBottom: SPACING.sm,
  },
  newFolderButton: { flex: 1 },
  folderMenuButton: {
    width: SIZES.minTouchTarget,
    height: SIZES.minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: BORDER_RADIUS.md,
  },
  inlineAction: { marginTop: SPACING.sm },
  emptyCard: {
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.xl,
    alignItems: 'center',
    marginTop: SPACING.md,
  },
  emptyTitle: { fontSize: FONTS.lg, fontWeight: '700', marginBottom: SPACING.sm },
  emptyText: { fontSize: FONTS.sm, lineHeight: 20, textAlign: 'center' },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    padding: SPACING.xl,
  },
  modalBox: { borderRadius: BORDER_RADIUS.lg, padding: SPACING.lg, maxHeight: '76%' },
  modalTitle: { fontSize: FONTS.lg, fontWeight: '700', marginBottom: SPACING.md },
  modalHint: { fontSize: FONTS.sm, lineHeight: 20, marginBottom: SPACING.sm },
  modalOptions: { flexGrow: 0 },
  modalItem: {
    minHeight: SIZES.minTouchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: BORDER_RADIUS.md,
    marginBottom: SPACING.xs,
  },
  modalItemText: { flex: 1, fontSize: FONTS.base, fontWeight: '500' },
  folderCount: { fontSize: FONTS.sm, fontWeight: '600', marginHorizontal: SPACING.sm },
  modalActions: { flexDirection: 'row', gap: SPACING.sm },
  modalAction: { flex: 1, paddingHorizontal: SPACING.xs },
});
