/**
 * Signature Setup
 * One signature per user (drawn or typed), saved once and reused
 * automatically whenever that person confirms a document elsewhere in
 * the app (e.g. Hours of Rest). No ScrollView wraps this screen -
 * react-native-signature-canvas is WebView-based like DateTimePicker,
 * and needs uncontested touch gestures to draw correctly.
 */

import React, { useState, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import SignatureCanvas, { SignatureViewRef } from 'react-native-signature-canvas';
import { COLORS, FONTS, SPACING, BORDER_RADIUS } from '../constants/theme';
import { useAuthStore } from '../store';
import { useThemeColors } from '../hooks/useThemeColors';
import { PageHeader } from '../components';
import { getSignatureForUser, saveSignature, UserSignature } from '../services/signatures';

const HIDE_FOOTER_STYLE = `
  .m-signature-pad--footer { display: none; margin: 0; }
  .m-signature-pad--body { border: none; }
  body,html { background-color: transparent; }
`;

export const SignatureSetupScreen = () => {
  const themeColors = useThemeColors();
  const { user } = useAuthStore();
  const signatureRef = useRef<SignatureViewRef>(null);

  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState<UserSignature | null>(null);
  const [mode, setMode] = useState<'view' | 'edit'>('edit');
  const [activeTab, setActiveTab] = useState<'draw' | 'type'>('draw');
  const [typedName, setTypedName] = useState('');
  const [saving, setSaving] = useState(false);

  const loadSignature = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      const data = await getSignatureForUser(user.id);
      setSaved(data);
      if (data) {
        setMode('view');
        setActiveTab(data.signatureType === 'drawn' ? 'draw' : 'type');
        if (data.signatureType === 'typed') setTypedName(data.typedName ?? '');
      } else {
        setMode('edit');
      }
    } catch (e) {
      console.error('Load signature error:', e);
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useFocusEffect(useCallback(() => { loadSignature(); }, [loadSignature]));

  const handleOK = async (signatureData: string) => {
    if (!user?.id) return;
    setSaving(true);
    try {
      await saveSignature(user.id, 'drawn', signatureData, null);
      await loadSignature();
    } catch (e) {
      Alert.alert('Error', 'Failed to save signature.');
    } finally {
      setSaving(false);
    }
  };

  const handleEmpty = () => {
    Alert.alert('Signature required', 'Please draw your signature before saving.');
  };

  const handleSaveTyped = async () => {
    if (!user?.id || !typedName.trim()) return;
    setSaving(true);
    try {
      await saveSignature(user.id, 'typed', null, typedName.trim());
      await loadSignature();
    } catch (e) {
      Alert.alert('Error', 'Failed to save signature.');
    } finally {
      setSaving(false);
    }
  };

  const handleSave = () => {
    if (activeTab === 'draw') {
      signatureRef.current?.readSignature();
    } else {
      handleSaveTyped();
    }
  };

  const handleCancelEdit = () => {
    if (saved) {
      setMode('view');
      setActiveTab(saved.signatureType === 'drawn' ? 'draw' : 'type');
      if (saved.signatureType === 'typed') setTypedName(saved.typedName ?? '');
    }
  };

  if (loading) {
    return (
      <View style={[styles.container, { backgroundColor: themeColors.background, justifyContent: 'center' }]}>
        <ActivityIndicator color={COLORS.primary} />
      </View>
    );
  }

  if (mode === 'view' && saved) {
    return (
      <View style={[styles.container, { backgroundColor: themeColors.background, padding: SPACING.lg }]}>
        <Text style={[styles.label, { color: themeColors.textSecondary }]}>Your signature</Text>
        <View style={[styles.previewBox, { borderColor: themeColors.textSecondary + '40', backgroundColor: themeColors.surface }]}>
          {saved.signatureType === 'drawn' && saved.signatureImage ? (
            <Image source={{ uri: saved.signatureImage }} style={styles.previewImage} resizeMode="contain" />
          ) : (
            <Text style={[styles.typedPreview, { color: themeColors.textPrimary }]}>{saved.typedName}</Text>
          )}
        </View>
        <TouchableOpacity onPress={() => setMode('edit')} style={[styles.primaryButton, { marginTop: SPACING.lg }]}>
          <Text style={{ color: '#fff', fontWeight: '600' }}>Edit signature</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: themeColors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <PageHeader title="E-Signature" />
      <View style={{ padding: SPACING.lg, flex: 1 }}>
        <View style={[styles.tabRow, { backgroundColor: themeColors.surface }]}>
          <TouchableOpacity
            onPress={() => setActiveTab('draw')}
            style={[styles.tab, activeTab === 'draw' && { backgroundColor: themeColors.background }]}
          >
            <Text style={{ color: themeColors.textPrimary, fontWeight: '500', fontSize: FONTS.sm }}>Draw</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setActiveTab('type')}
            style={[styles.tab, activeTab === 'type' && { backgroundColor: themeColors.background }]}
          >
            <Text style={{ color: themeColors.textPrimary, fontWeight: '500', fontSize: FONTS.sm }}>Type</Text>
          </TouchableOpacity>
        </View>

        {activeTab === 'draw' ? (
          <>
            <View style={[styles.canvasBox, { borderColor: themeColors.textSecondary + '60', backgroundColor: themeColors.surface }]}>
              <SignatureCanvas
                ref={signatureRef}
                onOK={handleOK}
                onEmpty={handleEmpty}
                webStyle={HIDE_FOOTER_STYLE}
                backgroundColor="transparent"
                penColor={themeColors.textPrimary}
                trimWhitespace
                style={{ flex: 1 }}
              />
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginBottom: SPACING.lg }}>
              <TouchableOpacity onPress={() => signatureRef.current?.clearSignature()}>
                <Text style={{ color: COLORS.primary, fontSize: FONTS.sm }}>Clear</Text>
              </TouchableOpacity>
            </View>
          </>
        ) : (
          <>
            <TextInput
              value={typedName}
              onChangeText={setTypedName}
              placeholder="Enter your full name"
              placeholderTextColor={themeColors.textSecondary}
              style={[styles.textInput, { color: themeColors.textPrimary, borderColor: themeColors.textSecondary + '60' }]}
            />
            <View style={[styles.previewBox, { borderColor: themeColors.textSecondary + '40', backgroundColor: themeColors.surface, marginBottom: SPACING.lg }]}>
              <Text style={[styles.typedPreview, { color: themeColors.textPrimary }]}>{typedName || ' '}</Text>
            </View>
          </>
        )}

        {saved && (
          <TouchableOpacity onPress={handleCancelEdit} style={[styles.secondaryButton, { marginBottom: SPACING.sm }]}>
            <Text style={{ color: themeColors.textPrimary }}>Cancel</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          onPress={handleSave}
          disabled={saving || (activeTab === 'type' && !typedName.trim())}
          style={[styles.primaryButton, { opacity: saving || (activeTab === 'type' && !typedName.trim()) ? 0.6 : 1 }]}
        >
          <Text style={{ color: '#fff', fontWeight: '600' }}>{saving ? 'Saving...' : 'Save signature'}</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  label: { fontSize: FONTS.sm, marginBottom: SPACING.sm },
  previewBox: {
    borderWidth: 1,
    borderRadius: BORDER_RADIUS.lg,
    minHeight: 120,
    alignItems: 'center',
    justifyContent: 'center',
    padding: SPACING.md,
  },
  previewImage: { width: '100%', height: 100 },
  typedPreview: { fontFamily: 'AlexBrush-Regular', fontSize: 40 },
  canvasBox: {
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderRadius: BORDER_RADIUS.lg,
    height: 180,
    marginBottom: SPACING.sm,
    overflow: 'hidden',
  },
  tabRow: {
    flexDirection: 'row',
    borderRadius: BORDER_RADIUS.md,
    padding: 3,
    marginBottom: SPACING.lg,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: SPACING.sm,
    borderRadius: BORDER_RADIUS.sm,
  },
  textInput: {
    borderWidth: 1,
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.md,
    fontSize: FONTS.base,
    marginBottom: SPACING.md,
  },
  primaryButton: { backgroundColor: COLORS.primary, padding: SPACING.md, borderRadius: BORDER_RADIUS.md, alignItems: 'center' },
  secondaryButton: { borderWidth: 1, borderColor: COLORS.border, padding: SPACING.md, borderRadius: BORDER_RADIUS.md, alignItems: 'center' },
});
