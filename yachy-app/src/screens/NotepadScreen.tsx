/**
 * Notepad Screen
 */
import React, { useState, useCallback, useLayoutEffect } from 'react';
import { InfoModal } from '../components/InfoModal';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SIZES, SHADOWS } from '../constants/theme';
import { useAuthStore, useThemeStore, BACKGROUND_THEMES } from '../store';
import notesService, { Note } from '../services/notes';

export const NotepadScreen = ({ navigation }: any) => {
  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <InfoModal
          screenKey="notepad"
          autoShow={false}
          content={{
            title: 'Notepad',
            description: 'Shared vessel notes for the whole crew.',
            features: [
              'Create and edit notes visible to all crew',
              'Keep handover information in one place',
              'Notes sync across every crew member\'s device',
              'Edit or remove notes as things change',
            ],
          }}
        />
      ),
    });
  }, [navigation]);
  const { user } = useAuthStore();
  const backgroundTheme = useThemeStore((s) => s.backgroundTheme);
  const themeColors = BACKGROUND_THEMES[backgroundTheme];
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(false);
  const vesselId = user?.vesselId ?? null;

  const loadNotes = useCallback(async () => {
    if (!vesselId) return;
    setLoading(true);
    try {
      const data = await notesService.getNotesByVessel(vesselId);
      setNotes(data);
    } catch (e) {
      console.error('Load notes error:', e);
    } finally {
      setLoading(false);
    }
  }, [vesselId]);

  useFocusEffect(useCallback(() => { loadNotes(); }, [loadNotes]));

  const handleDelete = (note: Note) => {
    Alert.alert('Delete Note', `Delete "${note.title}"?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        try {
          await notesService.deleteNote(note.id);
          setNotes((prev) => prev.filter((n) => n.id !== note.id));
        } catch {
          Alert.alert('Error', 'Could not delete note.');
        }
      }},
    ]);
  };

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });

  const goToNewNote = () => navigation.navigate('AddEditNote', { noteId: undefined });

  if (!vesselId) {
    return (
      <View style={[styles.centered, { backgroundColor: themeColors.background }]}>
        <Text style={[styles.emptyTitle, { color: themeColors.textPrimary }]}>No vessel found</Text>
        <Text style={[styles.emptyText, { color: themeColors.textSecondary }]}>Join a vessel to use the notepad.</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: themeColors.background }]}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      {/* Header row with New Note button */}
      <View style={styles.headerRow}>
        <View>
          <Text style={[styles.title, { color: themeColors.textPrimary }]}>Notepad</Text>
          <Text style={[styles.subtitle, { color: themeColors.textSecondary }]}>Visible to all crew</Text>
        </View>
        <TouchableOpacity
          style={[styles.newBtn, { backgroundColor: COLORS.primary }]}
          onPress={goToNewNote}
          activeOpacity={0.8}
        >
          <Ionicons name="add" size={18} color="#fff" />
          <Text style={styles.newBtnText}>New Note</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <ActivityIndicator size="large" color={COLORS.primary} style={styles.loader} />
      ) : notes.length === 0 ? (
        <TouchableOpacity
          style={[styles.emptyCard, { backgroundColor: themeColors.surface }]}
          onPress={goToNewNote}
          activeOpacity={0.8}
        >
          <Text style={styles.emptyIcon}>📝</Text>
          <Text style={[styles.emptyTitle, { color: themeColors.textPrimary }]}>No notes yet</Text>
          <Text style={[styles.emptyText, { color: themeColors.textSecondary }]}>Tap here or "New Note" to get started.</Text>
        </TouchableOpacity>
      ) : (
        <>
          {notes.map((note) => (
            <TouchableOpacity
              key={note.id}
              style={[styles.card, { backgroundColor: themeColors.surface }]}
              onPress={() => navigation.navigate('AddEditNote', { noteId: note.id })}
              onLongPress={() => handleDelete(note)}
              activeOpacity={0.8}
            >
              <View style={styles.cardBody}>
                <Text style={[styles.cardTitle, { color: themeColors.textPrimary }]} numberOfLines={1}>{note.title}</Text>
                {note.content ? (
                  <Text style={[styles.cardPreview, { color: themeColors.textSecondary }]} numberOfLines={2}>{note.content}</Text>
                ) : null}
                <Text style={[styles.cardMeta, { color: themeColors.textSecondary }]}>
                  {note.created_by_name} · {formatDate(note.updated_at)}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={themeColors.textSecondary} />
            </TouchableOpacity>
          ))}
        </>
      )}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: SPACING.xl },
  content: { padding: SPACING.lg, paddingTop: SPACING.xl * 2, paddingBottom: SIZES.bottomScrollPadding },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACING.xl },
  title: { fontSize: FONTS['2xl'], fontWeight: '700', marginBottom: 2 },
  subtitle: { fontSize: FONTS.sm },
  newBtn: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm, borderRadius: BORDER_RADIUS.md },
  newBtnText: { color: '#fff', fontSize: FONTS.sm, fontWeight: '700', marginLeft: 4 },
  loader: { marginTop: SPACING.xl * 2 },
  emptyCard: { padding: SPACING.xl, borderRadius: BORDER_RADIUS.lg, alignItems: 'center', ...SHADOWS.md },
  emptyIcon: { fontSize: 48, marginBottom: SPACING.md },
  emptyTitle: { fontSize: FONTS.xl, fontWeight: '700', marginBottom: SPACING.sm, textAlign: 'center' },
  emptyText: { fontSize: FONTS.base, textAlign: 'center', lineHeight: 22 },
  card: { flexDirection: 'row', alignItems: 'center', padding: SPACING.lg, borderRadius: BORDER_RADIUS.lg, marginBottom: SPACING.md, ...SHADOWS.sm },
  cardBody: { flex: 1, marginRight: SPACING.sm },
  cardTitle: { fontSize: FONTS.lg, fontWeight: '700', marginBottom: 4 },
  cardPreview: { fontSize: FONTS.sm, lineHeight: 18, marginBottom: 6 },
  cardMeta: { fontSize: FONTS.xs },
});
