/**
 * Notepad Screen
 */
import React, { useState, useCallback, useRef } from 'react';
import { PageHeader, PreviewActionButtons } from '../components';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SIZES } from '../constants/theme';
import { useAuthStore } from '../store';
import { useThemeColors } from '../hooks/useThemeColors';
import notesService, { Note } from '../services/notes';

const NOTEPAD_INFO = {
  title: 'Notepad',
  description: 'Your own private notes - only you can see them.',
  features: [
    'Create and edit personal notes',
    'Notes sync across your own devices',
    'Not visible to any other crew member',
    'Edit or remove notes as things change',
  ],
};

export const NotepadScreen = ({ navigation }: any) => {
  const { user } = useAuthStore();
  const themeColors = useThemeColors();
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedNoteId, setExpandedNoteId] = useState<string | null>(null);
  const loadedUserIdRef = useRef<string | null>(null);
  const vesselId = user?.vesselId ?? null;

  const userId = user?.id ?? null;

  const loadNotes = useCallback(async () => {
    if (!userId) {
      setLoading(false);
      return;
    }
    if (loadedUserIdRef.current !== userId) {
      loadedUserIdRef.current = userId;
      setNotes([]);
      setLoading(true);
    }
    try {
      const data = await notesService.getMyNotes(userId);
      setNotes(data);
    } catch (e) {
      console.error('Load notes error:', e);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useFocusEffect(
    useCallback(() => {
      loadNotes();
    }, [loadNotes])
  );

  const handleDelete = (note: Note) => {
    Alert.alert('Delete Note', `Delete "${note.title}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await notesService.deleteNote(note.id);
            setNotes((prev) => prev.filter((n) => n.id !== note.id));
          } catch {
            Alert.alert('Error', 'Could not delete note.');
          }
        },
      },
    ]);
  };

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });

  const goToNewNote = () => navigation.navigate('AddEditNote', { noteId: undefined });

  if (!vesselId) {
    return (
      <View style={[styles.centered, { backgroundColor: themeColors.background }]}>
        <Text style={[styles.emptyTitle, { color: themeColors.textPrimary }]}>No vessel found</Text>
        <Text style={[styles.emptyText, { color: themeColors.textSecondary }]}>
          Join a vessel to use the notepad.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.pageWrap}>
      <PageHeader title="Notepad" info={NOTEPAD_INFO} infoScreenKey="notepad" />
      <ScrollView
        style={[styles.container, { backgroundColor: themeColors.background }]}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <TouchableOpacity
          style={[
            styles.newBtn,
            { backgroundColor: themeColors.isDark ? themeColors.controlSelected : COLORS.primary },
          ]}
          onPress={goToNewNote}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel="Create Note"
        >
          <Ionicons name="add" size={20} color={COLORS.white} />
          <Text style={styles.newBtnText}>Create Note</Text>
        </TouchableOpacity>

        <View style={styles.listHeading}>
          <Text
            style={[
              styles.listHeadingTitle,
              { color: themeColors.isDark ? themeColors.textPrimary : COLORS.primary },
            ]}
          >
            Your Notes
          </Text>
          <Text style={[styles.privateText, { color: themeColors.textSecondary }]}>
            Only visible to you
          </Text>
        </View>

        {loading ? (
          <ActivityIndicator size="large" color={COLORS.primary} style={styles.loader} />
        ) : notes.length === 0 ? (
          <TouchableOpacity
            style={[
              styles.emptyCard,
              { backgroundColor: themeColors.surface, borderColor: themeColors.border },
            ]}
            onPress={goToNewNote}
            activeOpacity={0.8}
          >
            <Ionicons
              name="document-text-outline"
              size={42}
              color={themeColors.isDark ? themeColors.textPrimary : COLORS.primary}
              style={styles.emptyIcon}
            />
            <Text style={[styles.emptyTitle, { color: themeColors.textPrimary }]}>
              No notes yet
            </Text>
            <Text style={[styles.emptyText, { color: themeColors.textSecondary }]}>
              Tap here to create your first note.
            </Text>
          </TouchableOpacity>
        ) : (
          <>
            {notes.map((note) => (
              <View
                key={note.id}
                style={[
                  styles.card,
                  { backgroundColor: themeColors.surface, borderColor: themeColors.border },
                ]}
              >
                <TouchableOpacity
                  style={styles.cardHeader}
                  onPress={() =>
                    setExpandedNoteId((current) => (current === note.id ? null : note.id))
                  }
                  activeOpacity={0.8}
                >
                  <View style={styles.cardBody}>
                    <Text
                      style={[
                        styles.cardTitle,
                        { color: themeColors.isDark ? themeColors.textPrimary : COLORS.primary },
                      ]}
                      numberOfLines={1}
                    >
                      {note.title}
                    </Text>
                    {note.content && expandedNoteId !== note.id ? (
                      <Text
                        style={[styles.cardPreview, { color: themeColors.textSecondary }]}
                        numberOfLines={2}
                      >
                        {note.content}
                      </Text>
                    ) : null}
                    <Text style={[styles.cardMeta, { color: themeColors.textSecondary }]}>
                      Updated {formatDate(note.updated_at)}
                    </Text>
                  </View>
                  <Ionicons
                    name={expandedNoteId === note.id ? 'chevron-up' : 'chevron-down'}
                    size={18}
                    color={themeColors.textSecondary}
                  />
                </TouchableOpacity>
                {expandedNoteId === note.id && (
                  <>
                    <View style={[styles.expandedContent, { borderTopColor: themeColors.border }]}>
                      {note.content ? (
                        <Text style={[styles.cardContent, { color: themeColors.textPrimary }]}>
                          {note.content}
                        </Text>
                      ) : (
                        <Text style={[styles.cardContent, { color: themeColors.textSecondary }]}>
                          No content
                        </Text>
                      )}
                      <PreviewActionButtons
                        onEdit={() => navigation.navigate('AddEditNote', { noteId: note.id })}
                        onDelete={() => handleDelete(note)}
                      />
                    </View>
                  </>
                )}
              </View>
            ))}
          </>
        )}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  pageWrap: { flex: 1 },
  container: { flex: 1 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: SPACING.xl },
  content: {
    padding: SPACING.lg,
    paddingBottom: SIZES.bottomScrollPadding,
  },
  newBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.sm,
    minHeight: 52,
    paddingHorizontal: SPACING.lg,
    borderRadius: BORDER_RADIUS.md,
  },
  newBtnText: { color: COLORS.white, fontSize: FONTS.base, fontWeight: '700' },
  listHeading: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginTop: SPACING.lg,
    marginBottom: SPACING.sm,
    paddingHorizontal: 2,
  },
  listHeadingTitle: { fontSize: FONTS.lg, fontWeight: '700' },
  privateText: { fontSize: FONTS.xs },
  loader: { marginTop: SPACING.xl },
  emptyCard: {
    borderWidth: 1,
    padding: SPACING.xl,
    borderRadius: BORDER_RADIUS.lg,
    alignItems: 'center',
  },
  emptyIcon: { marginBottom: SPACING.md },
  emptyTitle: {
    fontSize: FONTS.xl,
    fontWeight: '700',
    marginBottom: SPACING.sm,
    textAlign: 'center',
  },
  emptyText: { fontSize: FONTS.base, textAlign: 'center', lineHeight: 22 },
  card: {
    borderWidth: 1,
    borderRadius: BORDER_RADIUS.lg,
    marginBottom: SPACING.md,
    overflow: 'hidden',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: SPACING.md,
  },
  cardBody: { flex: 1, marginRight: SPACING.sm },
  cardTitle: { fontSize: FONTS.lg, fontWeight: '700', marginBottom: SPACING.xs },
  cardPreview: { fontSize: FONTS.sm, lineHeight: 18, marginBottom: 6 },
  expandedContent: {
    marginHorizontal: SPACING.md,
    paddingTop: SPACING.md,
    paddingBottom: SPACING.md,
    borderTopWidth: 1,
  },
  cardContent: {
    fontSize: FONTS.base,
    lineHeight: 22,
    marginBottom: SPACING.md,
  },
  cardMeta: { fontSize: FONTS.xs },
});
