import React, { useCallback, useMemo, useState } from 'react';
import {
  Alert,
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
  Input,
  LabeledDropdown,
  LoadingSpinner,
  PageHeader,
} from '../components';
import { BORDER_RADIUS, COLORS, FONTS, SPACING, SIZES } from '../constants/theme';
import { useThemeColors } from '../hooks/useThemeColors';
import seaMilesService from '../services/seaMiles';
import { useAuthStore } from '../store';
import type { SeaMileEntry, SeaMileEntryStatus, SeaMileFolder } from '../types';
import { formatLocalDateString } from '../utils';
import { generateSeaMilesPdf } from '../utils/seaMilesPdf';
import {
  ALL_SEA_MILES,
  filterSeaMileEntries,
  type SeaMileFolderFilter,
  UNFILED_SEA_MILES,
} from '../utils/seaMilesFolders';

const STATUS_LABELS: Record<SeaMileEntryStatus, string> = {
  DRAFT: 'Draft',
  PENDING: 'Pending Review',
  APPROVED: 'Approved',
  DECLINED: 'Declined',
};

const STATUS_COLORS: Record<SeaMileEntryStatus, string> = {
  DRAFT: COLORS.gray500,
  PENDING: COLORS.warning,
  APPROVED: COLORS.success,
  DECLINED: COLORS.danger,
};

type FolderEditorMode = 'create' | 'rename' | null;

const SEA_MILES_INFO = {
  title: 'My Sea Miles',
  description: 'Your permanent personal sea-service record.',
  features: [
    'Save an entry as a draft or submit it to your vessel’s Captain/MOV',
    'Declined entries can be corrected and submitted again',
    'Approved entries are permanently locked',
    'Your records follow your account when you leave or join a vessel',
    'Create personal folders and move records between them without changing approved information',
    'Search by vessel name, departure location, or destination',
    'Only approved entries can be exported to PDF',
  ],
};

function formatAmount(value: number): string {
  return Number.isInteger(value)
    ? String(value)
    : value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

function reviewerDisplayName(entry: SeaMileEntry): string {
  return (
    [entry.reviewerContactFirstName, entry.reviewerContactLastName]
      .map((part) => part?.trim())
      .filter(Boolean)
      .join(' ') ||
    entry.reviewerName ||
    ''
  );
}

function sortFolders(folders: SeaMileFolder[]): SeaMileFolder[] {
  return [...folders].sort((a, b) => a.name.localeCompare(b.name));
}

export const MySeaMilesScreen = ({ navigation }: any) => {
  const themeColors = useThemeColors();
  const { user } = useAuthStore();
  const [entries, setEntries] = useState<SeaMileEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [exportMode, setExportMode] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [folders, setFolders] = useState<SeaMileFolder[]>([]);
  const [folderAssignments, setFolderAssignments] = useState<Record<string, string>>({});
  const [selectedFolderId, setSelectedFolderId] = useState<SeaMileFolderFilter>(ALL_SEA_MILES);
  const [searchQuery, setSearchQuery] = useState('');
  const [folderPickerOpen, setFolderPickerOpen] = useState(false);
  const [folderEditorMode, setFolderEditorMode] = useState<FolderEditorMode>(null);
  const [folderName, setFolderName] = useState('');
  const [folderWorking, setFolderWorking] = useState(false);
  const [movingEntry, setMovingEntry] = useState<SeaMileEntry | null>(null);
  const [movingEntryId, setMovingEntryId] = useState<string | null>(null);

  const loadEntries = useCallback(async () => {
    if (!user?.id) {
      setLoading(false);
      return;
    }
    try {
      const [ownEntries, ownFolders, ownAssignments] = await Promise.all([
        seaMilesService.getOwn(user.id),
        seaMilesService.getFolders(user.id),
        seaMilesService.getFolderAssignments(),
      ]);
      setEntries(ownEntries);
      setFolders(ownFolders);
      setFolderAssignments(
        Object.fromEntries(
          ownAssignments.map((assignment) => [assignment.entryId, assignment.folderId])
        )
      );
      setSelectedFolderId((current) => {
        if (current === ALL_SEA_MILES || current === UNFILED_SEA_MILES) return current;
        return ownFolders.some((folder) => folder.id === current) ? current : ALL_SEA_MILES;
      });
    } catch (error) {
      console.error('Load sea miles error:', error);
      Alert.alert('Error', 'Your sea-mile entries could not be loaded.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user?.id]);

  useFocusEffect(
    useCallback(() => {
      void loadEntries();
    }, [loadEntries])
  );

  const selectedFolder = useMemo(
    () => folders.find((folder) => folder.id === selectedFolderId) ?? null,
    [folders, selectedFolderId]
  );

  const selectedFolderLabel =
    selectedFolderId === ALL_SEA_MILES
      ? 'All Sea Miles'
      : selectedFolderId === UNFILED_SEA_MILES
        ? 'Unfiled'
        : selectedFolder?.name || 'All Sea Miles';

  const visibleEntries = useMemo(() => {
    return filterSeaMileEntries(entries, folderAssignments, selectedFolderId, searchQuery);
  }, [entries, folderAssignments, searchQuery, selectedFolderId]);

  const approvedEntries = useMemo(
    () => visibleEntries.filter((entry) => entry.status === 'APPROVED'),
    [visibleEntries]
  );

  const toggleExportMode = () => {
    setExportMode((active) => !active);
    setSelectedIds(new Set());
  };

  const toggleSelected = (id: string) => {
    setSelectedIds((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectFolderView = (folderId: SeaMileFolderFilter) => {
    setSelectedFolderId(folderId);
    setExpandedId(null);
    setSelectedIds(new Set());
    setFolderPickerOpen(false);
  };

  const openCreateFolder = () => {
    setFolderName('');
    setFolderEditorMode('create');
  };

  const openRenameFolder = () => {
    if (!selectedFolder) return;
    setFolderName(selectedFolder.name);
    setFolderEditorMode('rename');
  };

  const saveFolder = async () => {
    if (!user?.id || !folderEditorMode) return;
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
        const created = await seaMilesService.createFolder(user.id, cleanName);
        setFolders((current) => sortFolders([...current, created]));
        setSelectedFolderId(created.id);
      } else if (selectedFolder) {
        await seaMilesService.renameFolder(selectedFolder.id, cleanName);
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
      console.error('Save sea-mile folder error:', error);
      Alert.alert(
        'Could not save folder',
        error?.code === '23505' ? 'A folder with this name already exists.' : error?.message
      );
    } finally {
      setFolderWorking(false);
    }
  };

  const deleteSelectedFolder = () => {
    if (!selectedFolder) return;
    Alert.alert(
      'Delete folder?',
      `Are you sure you want to delete “${selectedFolder.name}”? Its Sea Miles will remain safe and move to Unfiled.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setFolderWorking(true);
            try {
              await seaMilesService.deleteFolder(selectedFolder.id);
              setFolders((current) => current.filter((folder) => folder.id !== selectedFolder.id));
              setFolderAssignments((current) =>
                Object.fromEntries(
                  Object.entries(current).filter(([, folderId]) => folderId !== selectedFolder.id)
                )
              );
              setSelectedFolderId(UNFILED_SEA_MILES);
              setSelectedIds(new Set());
            } catch (error: any) {
              console.error('Delete sea-mile folder error:', error);
              Alert.alert('Could not delete folder', error?.message || 'Please try again.');
            } finally {
              setFolderWorking(false);
            }
          },
        },
      ]
    );
  };

  const moveEntryToFolder = async (folderId: string | null) => {
    if (!movingEntry) return;
    const currentFolderId = folderAssignments[movingEntry.id] ?? null;
    if (folderId === currentFolderId) {
      setMovingEntry(null);
      return;
    }

    setMovingEntryId(movingEntry.id);
    try {
      await seaMilesService.moveEntryToFolder(movingEntry.id, folderId);
      setFolderAssignments((current) => {
        const next = { ...current };
        if (folderId) next[movingEntry.id] = folderId;
        else delete next[movingEntry.id];
        return next;
      });
      setMovingEntry(null);
    } catch (error: any) {
      console.error('Move sea-mile entry error:', error);
      Alert.alert('Could not move Sea Miles', error?.message || 'Please try again.');
    } finally {
      setMovingEntryId(null);
    }
  };

  const handleDelete = (entry: SeaMileEntry) => {
    Alert.alert('Delete sea-mile entry', 'This draft will be permanently deleted.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await seaMilesService.deleteEditable(entry.id);
            await loadEntries();
          } catch (error: any) {
            Alert.alert('Could not delete', error?.message || 'Please try again.');
          }
        },
      },
    ]);
  };

  const handleExport = async () => {
    const selected = entries.filter(
      (entry) => entry.status === 'APPROVED' && selectedIds.has(entry.id)
    );
    if (!selected.length || !user) return;
    setExporting(true);
    try {
      await generateSeaMilesPdf(selected, user.name);
      setExportMode(false);
      setSelectedIds(new Set());
    } catch (error: any) {
      console.error('Export sea miles error:', error);
      Alert.alert('Could not export PDF', error?.message || 'Please try again.');
    } finally {
      setExporting(false);
    }
  };

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: themeColors.background }]}>
        <LoadingSpinner />
      </View>
    );
  }

  return (
    <View style={[styles.page, { backgroundColor: themeColors.background }]}>
      <PageHeader
        title="My Sea Miles"
        info={SEA_MILES_INFO}
        infoScreenKey="my_sea_miles"
        actions={
          approvedEntries.length ? (
            <ExportButton active={exportMode} onPress={toggleExportMode} busy={exporting} />
          ) : undefined
        }
      />
      {exportMode ? (
        <ExportBar
          count={selectedIds.size}
          onConfirm={handleExport}
          exporting={exporting}
          hint="Tap approved entries to select"
        />
      ) : null}

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void loadEntries();
            }}
            tintColor={COLORS.primary}
          />
        }
      >
        <Button
          title="Create Sea Miles Entry"
          onPress={() => navigation.navigate('AddEditSeaMile')}
          fullWidth
          style={styles.addButton}
        />

        <Input
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder="Search vessel, departure or destination"
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

        <Button
          title="Create Folder"
          onPress={openCreateFolder}
          variant="outline"
          fullWidth
          style={styles.newFolderButton}
        />

        {selectedFolder ? (
          <View style={styles.folderActions}>
            <Button
              title="Rename Folder"
              onPress={openRenameFolder}
              variant="outline"
              style={styles.folderAction}
              disabled={folderWorking}
            />
            <Button
              title="Delete Folder"
              onPress={deleteSelectedFolder}
              variant="danger"
              style={styles.folderAction}
              disabled={folderWorking}
            />
          </View>
        ) : null}

        {!entries.length ? (
          <View style={[styles.emptyCard, { backgroundColor: themeColors.surface }]}>
            <Text style={[styles.emptyTitle, { color: themeColors.textPrimary }]}>
              No sea miles yet
            </Text>
            <Text style={[styles.emptyText, { color: themeColors.textSecondary }]}>
              Add your first sea-service entry and submit it to your Captain/MOV for approval.
            </Text>
          </View>
        ) : !visibleEntries.length ? (
          <View style={[styles.emptyCard, { backgroundColor: themeColors.surface }]}>
            <Text style={[styles.emptyTitle, { color: themeColors.textPrimary }]}>No matches</Text>
            <Text style={[styles.emptyText, { color: themeColors.textSecondary }]}>
              No Sea Miles match this folder and search.
            </Text>
          </View>
        ) : (
          visibleEntries.map((entry) => {
            const editable = entry.status === 'DRAFT' || entry.status === 'DECLINED';
            const selectable = exportMode && entry.status === 'APPROVED';
            const assignedFolder = folders.find(
              (folder) => folder.id === folderAssignments[entry.id]
            );
            const approvedBy = reviewerDisplayName(entry);
            return (
              <ButtonTagCard
                key={entry.id}
                headerTitle={`${entry.vesselName} • ${formatLocalDateString(entry.voyageDate)}`}
                collapsible
                expanded={expandedId === entry.id}
                onToggleExpand={() => setExpandedId((id) => (id === entry.id ? null : entry.id))}
                showCheckbox={selectable}
                checked={selectedIds.has(entry.id)}
                onToggleSelect={selectable ? () => toggleSelected(entry.id) : undefined}
                selected={selectedIds.has(entry.id)}
                onEdit={
                  editable
                    ? () => navigation.navigate('AddEditSeaMile', { entryId: entry.id })
                    : undefined
                }
                onDelete={editable ? () => handleDelete(entry) : undefined}
                accentColor={STATUS_COLORS[entry.status]}
                summary={
                  <View style={styles.summaryRow}>
                    <Text
                      style={[styles.routeSummary, { color: themeColors.textSecondary }]}
                      numberOfLines={1}
                    >
                      {entry.fromLocation} → {entry.toLocation}
                    </Text>
                    <View
                      style={[styles.statusBadge, { borderColor: STATUS_COLORS[entry.status] }]}
                    >
                      <Text style={[styles.statusText, { color: STATUS_COLORS[entry.status] }]}>
                        {STATUS_LABELS[entry.status]}
                      </Text>
                    </View>
                  </View>
                }
                footer={
                  entry.status === 'APPROVED' && approvedBy
                    ? `Approved by ${approvedBy}${entry.reviewedAt ? ` on ${new Date(entry.reviewedAt).toLocaleDateString()}` : ''}`
                    : undefined
                }
              >
                <ButtonTagRow
                  label="From / To"
                  value={`${entry.fromLocation} → ${entry.toLocation}`}
                />
                <ButtonTagRow label="Vessel Length" value={entry.vesselLength} />
                <ButtonTagRow label="Capacity / Role" value={entry.capacityRole} />
                <ButtonTagRow
                  label="Miles Logged"
                  value={`${formatAmount(entry.milesLogged)} NM`}
                />
                <ButtonTagRow
                  label="Day / Night Hours"
                  value={`${formatAmount(entry.dayHours)} / ${formatAmount(entry.nightHours)}`}
                />
                <ButtonTagRow label="Tidal" value={entry.tidal ? 'Yes' : 'No'} />
                <ButtonTagRow label="Folder" value={assignedFolder?.name || 'Unfiled'} />
                {entry.status === 'DECLINED' && entry.declineComment ? (
                  <View style={styles.declineReason}>
                    <Text style={styles.declineLabel}>CAPTAIN’S COMMENT</Text>
                    <Text style={[styles.declineText, { color: themeColors.textPrimary }]}>
                      {entry.declineComment}
                    </Text>
                  </View>
                ) : null}
                <Button
                  title="Move to Folder"
                  variant="outline"
                  size="small"
                  fullWidth
                  onPress={() => setMovingEntry(entry)}
                  loading={movingEntryId === entry.id}
                  style={styles.moveButton}
                />
              </ButtonTagCard>
            );
          })
        )}
      </ScrollView>

      <Modal visible={folderPickerOpen} transparent animationType="fade">
        <Pressable style={styles.modalBackdrop} onPress={() => setFolderPickerOpen(false)}>
          <View
            style={[styles.modalBox, { backgroundColor: themeColors.surface }]}
            onStartShouldSetResponder={() => true}
          >
            <Text style={[styles.modalTitle, { color: themeColors.textPrimary }]}>View Folder</Text>
            <ScrollView style={styles.modalOptions} showsVerticalScrollIndicator={false}>
              {[
                { id: ALL_SEA_MILES, name: 'All Sea Miles' },
                { id: UNFILED_SEA_MILES, name: 'Unfiled' },
                ...folders,
              ].map((folder) => {
                const selected = selectedFolderId === folder.id;
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

      <Modal visible={!!movingEntry} transparent animationType="fade">
        <Pressable style={styles.modalBackdrop} onPress={() => setMovingEntry(null)}>
          <View
            style={[styles.modalBox, { backgroundColor: themeColors.surface }]}
            onStartShouldSetResponder={() => true}
          >
            <Text style={[styles.modalTitle, { color: themeColors.textPrimary }]}>
              Move to Folder
            </Text>
            <Text style={[styles.modalHint, { color: themeColors.textSecondary }]}>
              Choose where to organise this Sea Miles entry.
            </Text>
            <ScrollView style={styles.modalOptions} showsVerticalScrollIndicator={false}>
              {[{ id: UNFILED_SEA_MILES, name: 'Unfiled' }, ...folders].map((folder) => {
                const folderId = folder.id === UNFILED_SEA_MILES ? null : folder.id;
                const selected = (folderAssignments[movingEntry?.id || ''] ?? null) === folderId;
                return (
                  <TouchableOpacity
                    key={folder.id}
                    style={[
                      styles.modalItem,
                      selected && {
                        backgroundColor: themeColors.isDark ? COLORS.gray700 : COLORS.gray200,
                      },
                    ]}
                    onPress={() => void moveEntryToFolder(folderId)}
                    disabled={!!movingEntryId}
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
              {folderEditorMode === 'create' ? 'Create Folder' : 'Rename Folder'}
            </Text>
            <Input
              label="Folder Name"
              value={folderName}
              onChangeText={setFolderName}
              placeholder="e.g. 2026 or M/Y Aurora"
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
                title={folderEditorMode === 'create' ? 'Create Folder' : 'Save Changes'}
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
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: SPACING.lg, paddingBottom: SIZES.bottomScrollPadding },
  addButton: { marginBottom: SPACING.lg },
  searchInput: { marginBottom: SPACING.sm },
  newFolderButton: { marginBottom: SPACING.md },
  folderActions: { flexDirection: 'row', gap: SPACING.sm, marginBottom: SPACING.lg },
  folderAction: { flex: 1, paddingHorizontal: SPACING.xs },
  moveButton: { marginTop: SPACING.sm },
  emptyCard: { borderRadius: BORDER_RADIUS.lg, padding: SPACING.xl, alignItems: 'center' },
  emptyTitle: { fontSize: FONTS.lg, fontWeight: '700', marginBottom: SPACING.sm },
  emptyText: { fontSize: FONTS.sm, lineHeight: 20, textAlign: 'center' },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SPACING.sm,
  },
  routeSummary: { fontSize: FONTS.sm, flex: 1 },
  statusBadge: {
    borderWidth: 1.5,
    borderRadius: BORDER_RADIUS.pill,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 3,
  },
  statusText: { fontSize: FONTS.xs, fontWeight: '700' },
  declineReason: {
    borderLeftWidth: 3,
    borderLeftColor: COLORS.danger,
    paddingLeft: SPACING.sm,
    marginTop: SPACING.xs,
  },
  declineLabel: { color: COLORS.danger, fontSize: FONTS.xs, fontWeight: '700', marginBottom: 2 },
  declineText: { fontSize: FONTS.sm, lineHeight: 20 },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    padding: SPACING.xl,
  },
  modalBox: {
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.lg,
    maxHeight: '72%',
  },
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
  modalActions: { flexDirection: 'row', gap: SPACING.sm },
  modalAction: { flex: 1, paddingHorizontal: SPACING.xs },
});
