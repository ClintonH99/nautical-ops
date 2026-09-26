import { LoadingSpinner as ActivityIndicator } from '../components/LoadingSpinner';
/**
 * Add / Edit Note Screen
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SIZES } from '../constants/theme';
import { useAuthStore } from '../store';
import { useThemeColors } from '../hooks/useThemeColors';
import notesService from '../services/notes';
import { Button, Input, PageHeader } from '../components';

export const AddEditNoteScreen = ({ navigation, route }: any) => {
  const noteId: string | undefined = route.params?.noteId;
  const isEdit = !!noteId;

  const { user } = useAuthStore();
  const themeColors = useThemeColors();

  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const contentInputRef = useRef<TextInput | null>(null);

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
    } catch {
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
      style={[styles.page, { backgroundColor: themeColors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <PageHeader title={noteId ? 'Edit Note' : 'Create Note'} />
      <ScrollView
        style={[styles.container, { backgroundColor: themeColors.background }]}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <View
          style={[
            styles.formSection,
            { backgroundColor: themeColors.surface, borderColor: themeColors.border },
          ]}
        >
          <Input
            label="Title"
            value={title}
            onChangeText={setTitle}
            placeholder="Note title"
            maxLength={120}
            returnKeyType="next"
            submitBehavior="submit"
            onSubmitEditing={() => contentInputRef.current?.focus()}
          />
          <View style={styles.noteField}>
            <Text style={[styles.fieldLabel, { color: themeColors.textPrimary }]}>Note</Text>
            <TextInput
              ref={contentInputRef}
              value={content}
              onChangeText={setContent}
              placeholder="Write your note here..."
              placeholderTextColor={themeColors.textMuted}
              multiline
              textAlignVertical="top"
              returnKeyType="default"
              style={[
                styles.noteInput,
                {
                  color: themeColors.textPrimary,
                  backgroundColor: themeColors.control,
                  borderColor: themeColors.border,
                },
              ]}
            />
          </View>
        </View>

        <View style={styles.actions}>
          <Button
            title={isEdit ? 'Save Changes' : 'Create Note'}
            onPress={handleSave}
            variant="primary"
            loading={saving}
            disabled={saving}
            fullWidth
          />

          {isEdit && (
            <TouchableOpacity
              style={[styles.deleteBtn, { borderColor: COLORS.danger }]}
              onPress={handleDelete}
              activeOpacity={0.8}
              disabled={saving}
              accessibilityRole="button"
              accessibilityLabel="Delete Note"
            >
              <Ionicons name="trash-outline" size={18} color={COLORS.danger} />
              <Text style={styles.deleteBtnText}>Delete Note</Text>
            </TouchableOpacity>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  page: { flex: 1 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  container: { flex: 1 },
  content: {
    padding: SPACING.lg,
    paddingTop: SPACING.xl,
    paddingBottom: SIZES.bottomScrollPadding,
  },
  formSection: {
    borderWidth: 1,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.md,
  },
  noteField: { marginBottom: 0 },
  fieldLabel: {
    fontSize: FONTS.sm,
    fontWeight: '600',
    marginBottom: SPACING.xs,
  },
  noteInput: {
    minHeight: 250,
    borderWidth: 1,
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.md,
    fontSize: FONTS.base,
    lineHeight: FONTS.base * 1.4,
    textAlignVertical: 'top',
  },
  actions: { marginTop: SPACING.md },
  deleteBtn: {
    minHeight: SIZES.buttonHeight,
    borderRadius: BORDER_RADIUS.lg,
    paddingHorizontal: SPACING.lg,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: SPACING.sm,
    borderWidth: 1,
    marginTop: SPACING.sm,
  },
  deleteBtnText: {
    color: COLORS.danger,
    fontSize: FONTS.base,
    fontWeight: '700',
  },
});
