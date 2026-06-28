/**
 * Notepad Screen
 * List of all notes for the vessel
 */

import React, { useState, useCallback } from 'react';
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
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SIZES, SHADOWS } from '../constants/theme';
import { useAuthStore, useThemeStore, BACKGROUND_THEMES } from '../store';
import notesService, { Note } from '../services/notes';

export const NotepadScreen = ({ navigation }: any) => {
  const { user } = useAuthStore();
  const backgroundTheme = useThemeStore((s) => s.backgroundTheme);
  const themeColors = BACKGROUND_THEMES[backgroundTheme];
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);

  const vesselId = user?.vesselId ?? null;

  const loadNotes = useCallback(async () => {
    if (!vesselId) return;
    try {
      setLoading(true);
      const data = await notesService.getNotesByVessel(vesselId);
      setNotes(data);
    } catch (e) {
      console.error('Load notes error:', e);
    } finally {
      setLoading(false);
    }
  }, [vesselId]);

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
          } catch (e) {
            Alert.alert('Error', 'Could not delete note.');
          }
        },
      },
    ]);
  };

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
  };

  return (
    <View style={[styles.container, { backgroundColor: themeColors.background }]}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <Text style={[styles.title, { color: themeColors.textPrimary }]}>Notepad</Text>
          <Text style={[styles.subtitle, { color: themeColors.textSecondary }]}>
            Vessel notes visible to all crew
          </Text>
        </View>

        {loading ? (
          <ActivityIndicator size="large" color={COLORS.primary} style={styles.loader} />
        ) : notes.length === 0 ? (
          <View style={[styles.emptyCard, { backgroundColor: themeColors.surface }]}>
            <Text style={styles.emptyIcon}>📝</Text>
            <Text style={[styles.emptyTitle, { color: themeColors.textPrimary }]}>
              No notes yet
            </Text>
            <Text style={[styles.emptyText, { color: themeColors.textSecondary }]}>
              Tap the button below to add the first note for your vessel.
            </Text>
          </View>
        ) : (
          <View style={styles.list}>
            {notes.map((note) => (
              <TouchableOpacity
                key={note.id}
                style={[styles.card, { backgroundColor: themeColors.surface }]}
                onPress={() => navigation.navigate('AddEditNote', { noteId: note.id })}
                onLongPress={() => handleDelete(note)}
                activeOpacity={0.8}
              >
                <View style={styles.cardBody}>
                  <Text
                    style={[styles.cardTitle, { color: themeColors.textPrimary }]}
                    numberOfLines={1}
                  >
                    {note.title}
                  </Text>
                  {note.content ? (
                    <Text
                      style={[styles.cardPreview, { color: themeColors.textSecondary }]}
                      numberOfLines={2}
                    >
                      {note.content}
                    </Text>
                  ) : null}
                  <Text style={[styles.cardMeta, { color: themeColors.textSecondary }]}>
                    {note.created_by_name} · {formatDate(note.updated_at)}
                  </Text>
                </View>
                <Ionicons
                  name="chevron-forward"
                  size={18}
                  color={themeColors.textSecondary}
                />
              </TouchableOpacity>
            ))}
          </View>
        )}
      </ScrollView>

      {/* FAB */}
      <TouchableOpacity
        style={styles.fab}
        onPress={() => navigation.navigate('AddEditNote', {})}
        activeOpacity={0.85}
      >
        <Ionicons name="add" size={28} color={COLORS.white} />
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: {
    padding: SPACING.lg,
    paddingTop: SPACING.xl * 2,
    paddingBottom: SIZES.bottomScrollPadding + 80,
  },
  header: {
    marginBottom: SPACING.xl,
  },
  title: {
    fontSize: FONTS['2xl'],
    fontWeight: '700',
    marginBottom: SPACING.xs,
  },
  subtitle: {
    fontSize: FONTS.base,
  },
  loader: {
    marginTop: SPACING.xl * 2,
  },
  emptyCard: {
    padding: SPACING.xl,
    borderRadius: BORDER_RADIUS.lg,
    alignItems: 'center',
    ...SHADOWS.md,
  },
  emptyIcon: { fontSize: 48, marginBottom: SPACING.md },
  emptyTitle: {
    fontSize: FONTS.xl,
    fontWeight: '700',
    marginBottom: SPACING.sm,
  },
  emptyText: {
    fontSize: FONTS.base,
    textAlign: 'center',
    lineHeight: 22,
  },
  list: { gap: SPACING.md },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: SPACING.lg,
    borderRadius: BORDER_RADIUS.lg,
    ...SHADOWS.sm,
  },
  cardBody: { flex: 1, marginRight: SPACING.sm },
  cardTitle: {
    fontSize: FONTS.lg,
    fontWeight: '700',
    marginBottom: 4,
  },
  cardPreview: {
    fontSize: FONTS.sm,
    lineHeight: 18,
    marginBottom: 6,
  },
  cardMeta: {
    fontSize: FONTS.xs,
  },
  fab: {
    position: 'absolute',
    bottom: 32,
    right: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: COLORS.primary,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 8,
  },
});
