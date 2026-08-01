/**
 * Add / Edit Note Screen
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SIZES } from '../constants/theme';
import { useAuthStore, useThemeStore, BACKGROUND_THEMES } from '../store';
import notesService from '../services/notes';

export const AddEditNoteScreen = ({ navigation, route }: any) => {
  const noteId: string | undefined = route.params?.noteId;
  const isEdit = !!noteId;

  const { user } = useAuthStore();
  const backgroundTheme = useThemeStore((s) => s.backgroundTheme);
  const themeColors = BACKGROUND_THEMES[backgroundTheme];

  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isEdit) {
      notesService
        .getNoteById(noteId!)
        .then((note) => {
          if (note) {
            setTitle(note.title);
            setContent(note.content);
          }
        })
        .catch(() => Alert.alert('Error', 'Could not load note.'))
        .finally(() => setLoading(false));
    }
  }, [noteId, isEdit]);

  const handleSave = async () => {
    if (!title.trim()) {
      Alert.alert('Title required', 'Please enter a title for the note.');
      return;
    }
    const vesselId = user?.vesselId;
    if (!vesselId || !user?.id) {
      Alert.alert('Error', 'No vessel found.');
      return;
    }
    try {
      setSaving(true);
      if (isEdit) {
        await notesService.updateNote(noteId!, title.trim(), content.trim());
      } else {
        await notesService.createNote(
          vesselId,
          user.id,
          title.trim(),
          content.trim(),
          user?.name ?? 'Crew'
        );
      }
      navigation.goBack();
    } catch (e) {
      Alert.alert('Error', 'Could not save note. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = () => {
    Alert.alert('Delete Note', 'Are you sure you want to delete this note?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await notesService.deleteNote(noteId!);
            navigation.goBack();
          } catch {
            Alert.alert('Error', 'Could not delete note.');
          }
        },
      },
    ]);
  };

  if (loading) {
    return (
      <View style={[styles.centered, { backgroundColor: themeColors.background }]}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        style={[styles.container, { backgroundColor: themeColors.background }]}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={[styles.label, { color: themeColors.textSecondary }]}>Title</Text>
        <TextInput
          style={[
            styles.input,
            {
              backgroundColor: themeColors.surface,
              color: themeColors.textPrimary,
              borderColor: themeColors.surfaceAlt,
            },
          ]}
          value={title}
          onChangeText={setTitle}
          placeholder="Note title"
          placeholderTextColor={themeColors.textSecondary}
          maxLength={120}
          returnKeyType="next"
        />

        <Text style={[styles.label, { color: themeColors.textSecondary }]}>Content</Text>
        <TextInput
          style={[
            styles.textarea,
            {
              backgroundColor: themeColors.surface,
              color: themeColors.textPrimary,
              borderColor: themeColors.surfaceAlt,
            },
          ]}
          value={content}
          onChangeText={setContent}
          placeholder="Write your note here..."
          placeholderTextColor={themeColors.textSecondary}
          multiline
          textAlignVertical="top"
          returnKeyType="default"
        />

        <TouchableOpacity
          style={[styles.saveBtn, saving && styles.saveBtnDisabled]}
          onPress={handleSave}
          disabled={saving}
          activeOpacity={0.8}
        >
          {saving ? (
            <ActivityIndicator size="small" color={COLORS.white} />
          ) : (
            <Text style={styles.saveBtnText}>{isEdit ? 'Save Changes' : 'Create Note'}</Text>
          )}
        </TouchableOpacity>

        {isEdit && (
          <TouchableOpacity style={styles.deleteBtn} onPress={handleDelete} activeOpacity={0.8}>
            <Text style={styles.deleteBtnText}>Delete Note</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  container: { flex: 1 },
  content: {
    padding: SPACING.lg,
    paddingTop: SPACING.xl,
    paddingBottom: SIZES.bottomScrollPadding,
  },
  label: {
    fontSize: FONTS.sm,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: SPACING.sm,
    marginTop: SPACING.md,
  },
  input: {
    borderWidth: 1,
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.md,
    fontSize: FONTS.base,
    marginBottom: SPACING.md,
  },
  textarea: {
    borderWidth: 1,
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.md,
    fontSize: FONTS.base,
    minHeight: 200,
    marginBottom: SPACING.xl,
  },
  saveBtn: {
    backgroundColor: COLORS.primary,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.lg,
    alignItems: 'center',
    marginBottom: SPACING.md,
  },
  saveBtnDisabled: { opacity: 0.6 },
  saveBtnText: {
    color: COLORS.white,
    fontSize: FONTS.base,
    fontWeight: '700',
  },
  deleteBtn: {
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.lg,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#ef4444',
  },
  deleteBtnText: {
    color: '#ef4444',
    fontSize: FONTS.base,
    fontWeight: '600',
  },
});
