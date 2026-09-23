/**
 * Profile Screen
 * View and edit user profile (photo, name, position, department)
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  Alert,
  TextInput,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SIZES, SHADOWS } from '../constants/theme';
import { useAuthStore, useThemeStore, BACKGROUND_THEMES } from '../store';
import { supabase } from '../services/supabase';
import authService from '../services/auth';
import { Button, LoadingSpinner, PageHeader, DepartmentSelector } from '../components';
import userService from '../services/user';
import { Department } from '../types';
import { formatDepartmentLabel } from '../utils/departmentSelection';
import Constants from 'expo-constants';

// Read from app.json at build time, so it can never drift from the
// version actually shipped.
const APP_VERSION = Constants.expoConfig?.version ?? '';

export const ProfileScreen = ({ navigation }: any) => {
  const { user, setUser } = useAuthStore();
  const isCaptain = user?.role === 'CAPTAIN_MOV';
  const displaysAsCaptain = isCaptain || user?.position?.toLowerCase().includes('captain') === true;

  const refreshUser = async () => {
    if (!user?.id) return;
    const fresh = await authService.getUserProfile(user.id);
    if (fresh) setUser(fresh);
  };

  const callVesselFunction = async (fnName: string) => {
    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData?.session?.access_token;
    if (!accessToken) {
      Alert.alert('Error', 'Could not verify your session. Please try again.');
      return null;
    }
    const { data, error } = await supabase.functions.invoke(fnName, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (error || data?.error) {
      const msg = data?.error || 'Something went wrong. Please contact support@nautical-ops.com';
      if (msg.includes('only Captain/MOV')) {
        Alert.alert("You're the only Captain", msg, [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Go to Crew Management', onPress: () => navigation.navigate('CrewManagement') },
        ]);
      } else {
        Alert.alert('Error', msg);
      }
      return null;
    }
    return data;
  };

  const handleLeaveVessel = () => {
    Alert.alert(
      'Leave Vessel',
      "You'll move to your own private account. The vessel and crew continue without you. This cannot be undone.",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Leave Vessel',
          style: 'destructive',
          onPress: async () => {
            const result = await callVesselFunction('leave-vessel');
            if (result?.success) {
              await refreshUser();
              Alert.alert('Done', "You've left the vessel and now have your own account.");
            }
          },
        },
      ]
    );
  };

  const handleDeleteVessel = () => {
    Alert.alert(
      'Delete Vessel',
      "This moves every crew member (including you) onto their own private account and cannot be undone. If you subscribed through Apple or Google Play, you must also cancel the subscription in that store's settings.",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete Vessel',
          style: 'destructive',
          onPress: async () => {
            const result = await callVesselFunction('delete-vessel');
            if (result?.success) {
              await refreshUser();
              if (result.needsManualStoreCancellation) {
                const storeName =
                  result.cancellationProvider === 'google' ? 'Google Play' : 'your Apple ID';
                Alert.alert(
                  'Vessel Deleted',
                  `One more step: go to ${storeName} subscription settings and cancel the subscription there too, or you'll keep being charged.`
                );
              } else {
                Alert.alert('Done', 'The vessel has been deleted.');
              }
            }
          },
        },
      ]
    );
  };

  const backgroundTheme = useThemeStore((s) => s.backgroundTheme);
  const themeColors = BACKGROUND_THEMES[backgroundTheme];
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);

  // Form state
  const [name, setName] = useState(user?.name || '');
  const [position, setPosition] = useState(user?.position || '');
  const [department, setDepartment] = useState<Department>(user?.department || 'BRIDGE');
  const [profilePhoto, setProfilePhoto] = useState(user?.profilePhoto);
  const [photoLoadFailed, setPhotoLoadFailed] = useState(false);
  const [localPreviewUri, setLocalPreviewUri] = useState<string | null>(null);

  useEffect(() => {
    setProfilePhoto(user?.profilePhoto);
    if (user?.profilePhoto) {
      setPhotoLoadFailed(false);
    } else {
      setPhotoLoadFailed(true);
    }
    setLocalPreviewUri(null);
  }, [user?.profilePhoto, user?.id]);

  const displayPhotoUri =
    localPreviewUri || profilePhoto || (user?.id ? userService.getProfilePhotoUrl(user.id) : null);

  const handlePickImage = async () => {
    try {
      // Request permission
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Required', 'Please grant permission to access your photos');
        return;
      }

      // Launch image picker
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });

      if (!result.canceled && result.assets[0]) {
        setLocalPreviewUri(result.assets[0].uri);
        setIsUploadingPhoto(true);
        try {
          // Upload photo (replaces previous; each upload is separate)
          const photoUrl = await userService.uploadProfilePhoto(user!.id, result.assets[0].uri);
          setLocalPreviewUri(null);
          setProfilePhoto(photoUrl);
          setPhotoLoadFailed(false);

          // Update user profile immediately
          const updatedUser = await userService.updateProfile(user!.id, {
            profilePhoto: photoUrl,
          });

          if (updatedUser) {
            setUser(updatedUser);
          }

          Alert.alert('Success', 'Profile photo updated!');
        } catch (error) {
          console.error('Upload error:', error);
          setLocalPreviewUri(null);
          Alert.alert('Error', 'Failed to upload photo. Please try again.');
        } finally {
          setIsUploadingPhoto(false);
        }
      }
    } catch (error) {
      console.error('Pick image error:', error);
      Alert.alert('Error', 'Failed to pick image. Please try again.');
    }
  };

  const handleSave = async () => {
    if (!name.trim()) {
      Alert.alert('Error', 'Name is required');
      return;
    }

    if (!position.trim()) {
      Alert.alert('Error', 'Position is required');
      return;
    }

    setIsSaving(true);
    try {
      const updatedUser = await userService.updateProfile(user!.id, {
        name: name.trim(),
        position: position.trim(),
        department,
      });

      if (updatedUser) {
        setUser(updatedUser);
        setIsEditing(false);
        Alert.alert('Success', 'Profile updated successfully!');
      }
    } catch (error) {
      console.error('Save profile error:', error);
      Alert.alert('Error', 'Failed to update profile. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = () => {
    // Reset form to original values
    setName(user?.name || '');
    setPosition(user?.position || '');
    setDepartment(user?.department || 'BRIDGE');
    setIsEditing(false);
  };

  return (
    <View style={[styles.pageWrap, { backgroundColor: themeColors.background }]}>
      <PageHeader title="Settings & Profile" />
      <ScrollView style={[styles.container, { backgroundColor: themeColors.background }]}>
        <View style={styles.content}>
          {/* Profile summary */}
          <View
            style={[
              styles.profileSummary,
              {
                backgroundColor: themeColors.surfaceElevated,
                borderColor: themeColors.border,
              },
            ]}
          >
            <View style={styles.photoContainer}>
              {isUploadingPhoto ? (
                <View
                  style={[
                    styles.photoLoading,
                    {
                      backgroundColor: themeColors.surfaceElevated,
                      borderColor: themeColors.border,
                    },
                  ]}
                >
                  <LoadingSpinner />
                </View>
              ) : displayPhotoUri && !photoLoadFailed ? (
                <Image
                  source={{ uri: displayPhotoUri }}
                  style={styles.photo}
                  onError={() => !localPreviewUri && setPhotoLoadFailed(true)}
                />
              ) : (
                <View
                  style={[
                    styles.photoPlaceholder,
                    { backgroundColor: themeColors.controlSelected },
                  ]}
                >
                  <Text style={[styles.photoPlaceholderText, { color: themeColors.textOnAccent }]}>
                    {user?.name.charAt(0).toUpperCase()}
                  </Text>
                </View>
              )}
            </View>
            <View style={styles.profileSummaryText}>
              <Text
                style={[
                  styles.profileSummaryName,
                  { color: themeColors.isDark ? COLORS.white : COLORS.primary },
                ]}
              >
                {user?.name}
              </Text>
              <Text style={[styles.profileSummaryDetails, { color: themeColors.textSecondary }]}>
                {user?.position} · {formatDepartmentLabel(user?.department ?? 'BRIDGE')}
              </Text>
              <Button
                title="Change Photo"
                onPress={handlePickImage}
                variant="outline"
                size="small"
                style={styles.photoButton}
                disabled={isUploadingPhoto}
              />
            </View>
          </View>

          {/* Profile Information */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={[styles.sectionTitle, { color: themeColors.textSecondary }]}>
                Profile Information
              </Text>
              {!isEditing && (
                <TouchableOpacity onPress={() => setIsEditing(true)}>
                  <Text style={[styles.editButton, { color: themeColors.accent }]}>Edit</Text>
                </TouchableOpacity>
              )}
            </View>

            <View
              style={[
                styles.card,
                !isEditing && styles.profileFields,
                { backgroundColor: themeColors.surfaceElevated, borderColor: themeColors.border },
              ]}
            >
              {/* Name */}
              <View style={[styles.field, !isEditing && styles.fieldHalf]}>
                <Text style={[styles.label, { color: themeColors.textSecondary }]}>Name</Text>
                {isEditing ? (
                  <TextInput
                    style={[
                      styles.input,
                      {
                        backgroundColor: themeColors.control,
                        color: themeColors.textPrimary,
                        borderColor: themeColors.border,
                      },
                    ]}
                    value={name}
                    onChangeText={setName}
                    placeholder="Enter your name"
                    placeholderTextColor={themeColors.textSecondary}
                  />
                ) : (
                  <Text style={[styles.value, { color: themeColors.textPrimary }]}>
                    {user?.name}
                  </Text>
                )}
              </View>

              {/* Position */}
              <View style={[styles.field, !isEditing && styles.fieldHalf]}>
                <Text style={[styles.label, { color: themeColors.textSecondary }]}>Position</Text>
                {isEditing ? (
                  <TextInput
                    style={[
                      styles.input,
                      {
                        backgroundColor: themeColors.control,
                        color: themeColors.textPrimary,
                        borderColor: themeColors.border,
                      },
                    ]}
                    value={position}
                    onChangeText={setPosition}
                    placeholder="Enter your position"
                    placeholderTextColor={themeColors.textSecondary}
                  />
                ) : (
                  <Text style={[styles.value, { color: themeColors.textPrimary }]}>
                    {user?.position}
                  </Text>
                )}
              </View>

              {/* Department */}
              <View style={[styles.field, !isEditing && styles.fieldHalf]}>
                {isEditing ? (
                  <>
                    <DepartmentSelector
                      value={department}
                      onChange={(value) => value && setDepartment(value)}
                      tightTop
                    />
                  </>
                ) : (
                  <>
                    <Text style={[styles.label, { color: themeColors.textSecondary }]}>
                      Department
                    </Text>
                    <Text style={[styles.value, { color: themeColors.textPrimary }]}>
                      {formatDepartmentLabel(user?.department ?? 'BRIDGE')}
                    </Text>
                  </>
                )}
              </View>

              {/* Email (read-only) */}
              <View style={[styles.field, styles.fieldLast, !isEditing && styles.fieldHalf]}>
                <Text style={[styles.label, { color: themeColors.textSecondary }]}>Email</Text>
                <Text
                  style={[styles.value, styles.valueDisabled, { color: themeColors.textSecondary }]}
                >
                  {user?.email}
                </Text>
              </View>
            </View>
          </View>

          {/* Account Information (read-only) */}
          <View style={styles.section}>
            <Text
              style={[
                styles.sectionTitle,
                styles.sectionTitleStandalone,
                { color: themeColors.textSecondary },
              ]}
            >
              Account Information
            </Text>
            <View
              style={[
                styles.card,
                styles.accountFields,
                { backgroundColor: themeColors.surfaceElevated, borderColor: themeColors.border },
              ]}
            >
              <View style={[styles.field, styles.accountField]}>
                <Text style={[styles.label, { color: themeColors.textSecondary }]}>Role</Text>
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: SPACING.sm,
                    flexWrap: 'wrap',
                  }}
                >
                  <View
                    style={[styles.roleBadge, { backgroundColor: themeColors.controlSelected }]}
                  >
                    <Text
                      style={[
                        styles.roleText,
                        { color: themeColors.textOnAccent, textTransform: 'none' },
                      ]}
                    >
                      {displaysAsCaptain
                        ? 'MOV (Master of Vessel)'
                        : user?.role === 'HOD'
                          ? 'HOD (Head of Department)'
                          : 'Crew'}
                    </Text>
                  </View>
                  {user?.contractType === 'temporary' && (
                    <View style={styles.contractBadgeTemp}>
                      <Text style={styles.contractBadgeText}>TEMP</Text>
                    </View>
                  )}
                  {user?.contractType === 'rotational' && (
                    <View style={styles.contractBadgeRotation}>
                      <Text style={styles.contractBadgeText}>Rotation</Text>
                    </View>
                  )}
                </View>
              </View>
              <View style={[styles.field, styles.fieldLast, styles.accountField]}>
                <Text style={[styles.label, { color: themeColors.textSecondary }]}>
                  Member Since
                </Text>
                <Text style={[styles.value, { color: themeColors.textPrimary }]}>
                  {user?.createdAt
                    ? new Date(user.createdAt).toLocaleDateString('en-US', {
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric',
                      })
                    : 'N/A'}
                </Text>
              </View>
            </View>
          </View>

          {/* Personal Records */}
          <View style={styles.section}>
            <Text
              style={[
                styles.sectionTitle,
                styles.sectionTitleStandalone,
                { color: themeColors.textSecondary },
              ]}
            >
              Personal Records
            </Text>
            <View
              style={[
                styles.settingsCard,
                { backgroundColor: themeColors.surfaceElevated, borderColor: themeColors.border },
              ]}
            >
              <TouchableOpacity
                style={[
                  styles.settingsItem,
                  styles.settingsItemLast,
                  { borderBottomColor: themeColors.border },
                ]}
                onPress={() => navigation.navigate('MySeaMiles')}
                activeOpacity={0.7}
              >
                <View style={styles.settingsItemLeft}>
                  <View
                    style={[
                      styles.settingsIconContainer,
                      { backgroundColor: themeColors.accentSoft },
                    ]}
                  >
                    <Ionicons
                      name="compass-outline"
                      size={20}
                      color={themeColors.isDark ? COLORS.white : COLORS.primary}
                    />
                  </View>
                  <View style={styles.settingsTextContainer}>
                    <Text style={[styles.settingsLabel, { color: themeColors.textPrimary }]}>
                      My Sea Miles
                    </Text>
                    <Text
                      style={[styles.settingsDescription, { color: themeColors.textSecondary }]}
                    >
                      View and export your permanent personal sea-service record
                    </Text>
                  </View>
                </View>
                <Ionicons name="chevron-forward" size={20} color={themeColors.textSecondary} />
              </TouchableOpacity>
            </View>
          </View>

          {/* E-signature */}
          <View style={styles.section}>
            <Text
              style={[
                styles.sectionTitle,
                styles.sectionTitleStandalone,
                { color: themeColors.textSecondary },
              ]}
            >
              E-signature
            </Text>
            <View
              style={[
                styles.settingsCard,
                { backgroundColor: themeColors.surfaceElevated, borderColor: themeColors.border },
              ]}
            >
              <TouchableOpacity
                style={[
                  styles.settingsItem,
                  styles.settingsItemLast,
                  { borderBottomColor: themeColors.border },
                ]}
                onPress={() => navigation.navigate('SignatureSetup')}
                activeOpacity={0.7}
              >
                <View style={styles.settingsItemLeft}>
                  <View
                    style={[
                      styles.settingsIconContainer,
                      { backgroundColor: themeColors.accentSoft },
                    ]}
                  >
                    <Ionicons
                      name="pencil-outline"
                      size={20}
                      color={themeColors.isDark ? COLORS.white : COLORS.primary}
                    />
                  </View>
                  <View style={styles.settingsTextContainer}>
                    <Text style={[styles.settingsLabel, { color: themeColors.textPrimary }]}>
                      E-signature
                    </Text>
                    <Text
                      style={[styles.settingsDescription, { color: themeColors.textSecondary }]}
                    >
                      Set up your signature for Hours of Rest
                    </Text>
                  </View>
                </View>
                <Ionicons name="chevron-forward" size={20} color={themeColors.textSecondary} />
              </TouchableOpacity>
            </View>
          </View>
          {/* Join Vessel */}
          <View style={styles.section}>
            <Text
              style={[
                styles.sectionTitle,
                styles.sectionTitleStandalone,
                { color: themeColors.textSecondary },
              ]}
            >
              Vessel
            </Text>
            <View
              style={[
                styles.settingsCard,
                { backgroundColor: themeColors.surfaceElevated, borderColor: themeColors.border },
              ]}
            >
              <TouchableOpacity
                style={[
                  styles.settingsItem,
                  isCaptain ? undefined : styles.settingsItemLast,
                  { borderBottomColor: themeColors.border },
                ]}
                onPress={() => navigation.navigate('JoinVessel')}
                activeOpacity={0.7}
              >
                <View style={styles.settingsItemLeft}>
                  <View
                    style={[
                      styles.settingsIconContainer,
                      { backgroundColor: themeColors.accentSoft },
                    ]}
                  >
                    <Ionicons
                      name="boat-outline"
                      size={20}
                      color={themeColors.isDark ? COLORS.white : COLORS.primary}
                    />
                  </View>
                  <View style={styles.settingsTextContainer}>
                    <Text style={[styles.settingsLabel, { color: themeColors.textPrimary }]}>
                      Join a Different Vessel
                    </Text>
                    <Text
                      style={[styles.settingsDescription, { color: themeColors.textSecondary }]}
                    >
                      Switch vessels using a new invite code
                    </Text>
                  </View>
                </View>
                <Ionicons name="chevron-forward" size={20} color={themeColors.textSecondary} />
              </TouchableOpacity>
              {!!user?.vesselId && (
                <TouchableOpacity
                  style={[styles.settingsItem, { borderBottomColor: themeColors.border }]}
                  onPress={handleLeaveVessel}
                  activeOpacity={0.7}
                >
                  <View style={styles.settingsItemLeft}>
                    <View
                      style={[
                        styles.settingsIconContainer,
                        { backgroundColor: themeColors.accentSoft },
                      ]}
                    >
                      <Ionicons
                        name="log-out-outline"
                        size={20}
                        color={themeColors.isDark ? COLORS.white : COLORS.primary}
                      />
                    </View>
                    <View style={styles.settingsTextContainer}>
                      <Text style={[styles.settingsLabel, { color: themeColors.textPrimary }]}>
                        Leave Vessel
                      </Text>
                      <Text
                        style={[styles.settingsDescription, { color: themeColors.textSecondary }]}
                      >
                        Step away - the vessel and crew continue without you
                      </Text>
                    </View>
                  </View>
                  <Ionicons name="chevron-forward" size={20} color={themeColors.textSecondary} />
                </TouchableOpacity>
              )}
              {isCaptain && (
                <TouchableOpacity
                  style={[
                    styles.settingsItem,
                    styles.settingsItemLast,
                    { borderBottomColor: themeColors.border },
                  ]}
                  onPress={handleDeleteVessel}
                  activeOpacity={0.7}
                >
                  <View style={styles.settingsItemLeft}>
                    <View style={[styles.settingsIconContainer, styles.dangerIconContainer]}>
                      <Ionicons name="trash-outline" size={20} color={COLORS.danger} />
                    </View>
                    <View style={styles.settingsTextContainer}>
                      <Text style={[styles.settingsLabel, { color: COLORS.danger }]}>
                        Delete Vessel
                      </Text>
                      <Text
                        style={[styles.settingsDescription, { color: themeColors.textSecondary }]}
                      >
                        Cancel the subscription and remove all crew
                      </Text>
                    </View>
                  </View>
                  <Ionicons name="chevron-forward" size={20} color={themeColors.textSecondary} />
                </TouchableOpacity>
              )}
            </View>
          </View>
          {/* Version Info */}
          <View style={styles.versionInfo}>
            <Text style={[styles.versionText, { color: themeColors.textSecondary }]}>
              Nautical Ops v{APP_VERSION}
            </Text>
            <Text style={[styles.versionSubtext, { color: themeColors.textSecondary }]}>
              Professional yacht operations management
            </Text>
          </View>

          {/* Save/Cancel Buttons */}
          {isEditing && (
            <View style={styles.actions}>
              <Button
                title="Cancel"
                onPress={handleCancel}
                variant="outline"
                shape="pill"
                fullWidth
                style={styles.actionButton}
                disabled={isSaving}
              />
              <Button
                title={isSaving ? 'Saving…' : 'Save Changes'}
                onPress={handleSave}
                variant="primary"
                shape="pill"
                fullWidth
                style={styles.actionButton}
                disabled={isSaving}
              />
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  pageWrap: { flex: 1 },
  container: {
    flex: 1,
  },
  content: {
    padding: SPACING.lg,
    paddingBottom: SIZES.bottomScrollPadding,
  },
  heroSection: {
    backgroundColor: COLORS.white,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.xl,
    marginBottom: SPACING.xl,
    ...SHADOWS.md,
  },
  heroTitle: {
    fontSize: FONTS['2xl'],
    fontWeight: '700',
    letterSpacing: -0.3,
    color: COLORS.textPrimary,
  },
  heroSubtitle: {
    fontSize: FONTS.base,
    color: COLORS.textSecondary,
    marginTop: SPACING.xs,
    letterSpacing: 0.2,
  },
  statsRow: {
    flexDirection: 'row',
    gap: SPACING.md,
    marginTop: SPACING.lg,
  },
  statCard: {
    flex: 1,
    backgroundColor: COLORS.background,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.lg,
    alignItems: 'center',
  },
  statValue: {
    fontSize: FONTS.lg,
    fontWeight: '700',
    color: COLORS.primary,
  },
  statLabel: {
    fontSize: FONTS.xs,
    color: COLORS.textSecondary,
    marginTop: 4,
  },
  profileSummary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    padding: SPACING.lg,
    marginBottom: SPACING.lg,
    borderWidth: 1,
    borderRadius: BORDER_RADIUS.lg,
    ...SHADOWS.md,
  },
  photoContainer: {
    flexShrink: 0,
  },
  photo: {
    width: 76,
    height: 76,
    borderRadius: 38,
  },
  photoPlaceholder: {
    width: 76,
    height: 76,
    borderRadius: 38,
    justifyContent: 'center',
    alignItems: 'center',
  },
  photoPlaceholderText: {
    fontSize: FONTS['2xl'],
    fontWeight: 'bold',
  },
  photoLoading: {
    width: 76,
    height: 76,
    borderRadius: 38,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
  },
  profileSummaryText: {
    flex: 1,
  },
  profileSummaryName: { fontSize: FONTS.lg, fontWeight: '700', marginBottom: 3 },
  profileSummaryDetails: { fontSize: FONTS.sm, marginBottom: SPACING.sm },
  photoButton: {
    alignSelf: 'flex-start',
  },
  section: {
    marginBottom: SPACING.lg,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.sm,
  },
  sectionTitle: {
    fontSize: FONTS.xs,
    fontWeight: '600',
    color: COLORS.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  sectionTitleStandalone: {
    marginLeft: SPACING.xs,
    marginBottom: SPACING.sm,
  },
  editButton: {
    fontSize: FONTS.base,
    fontWeight: '600',
  },
  card: {
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.lg,
    borderWidth: 1,
    ...SHADOWS.md,
  },
  profileFields: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.md,
  },
  accountFields: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.md,
  },
  field: {
    marginBottom: SPACING.lg,
  },
  fieldHalf: {
    width: '47%',
    marginBottom: 0,
  },
  accountField: {
    width: '47%',
    marginBottom: 0,
  },
  fieldLast: {
    marginBottom: 0,
  },
  label: {
    fontSize: FONTS.sm,
    fontWeight: '600',
    color: COLORS.textSecondary,
    marginBottom: SPACING.xs,
  },
  value: {
    fontSize: FONTS.base,
    color: COLORS.textPrimary,
  },
  valueDisabled: {
    color: COLORS.textTertiary,
  },
  input: {
    fontSize: FONTS.base,
    borderWidth: 1,
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.md,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.xl,
  },
  modalBox: {
    borderRadius: BORDER_RADIUS.lg,
    overflow: 'hidden',
    width: '100%',
    maxWidth: 320,
  },
  modalItem: {
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.lg,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  modalItemSelected: {
    backgroundColor: COLORS.primaryLight + '22',
  },
  modalItemText: {
    fontSize: FONTS.base,
    fontWeight: '500',
  },
  modalItemTextSelected: {
    color: COLORS.primary,
    fontWeight: '700',
  },
  roleBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: SPACING.sm,
    paddingVertical: 4,
    borderRadius: BORDER_RADIUS.sm,
  },
  roleText: {
    fontSize: FONTS.sm,
    fontWeight: 'bold',
    textTransform: 'uppercase',
  },
  contractBadgeTemp: {
    alignSelf: 'flex-start',
    paddingHorizontal: SPACING.sm,
    paddingVertical: 4,
    borderRadius: BORDER_RADIUS.sm,
    backgroundColor: '#ea580c',
  },
  contractBadgeRotation: {
    alignSelf: 'flex-start',
    paddingHorizontal: SPACING.sm,
    paddingVertical: 4,
    borderRadius: BORDER_RADIUS.sm,
    backgroundColor: '#0d9488',
  },
  contractBadgeText: {
    fontSize: FONTS.sm,
    fontWeight: 'bold',
    color: COLORS.white,
  },
  actions: {
    flexDirection: 'row',
    gap: SPACING.md,
    marginTop: SPACING.md,
  },
  actionButton: {
    flex: 1,
  },
  settingsCard: {
    borderRadius: BORDER_RADIUS.lg,
    overflow: 'hidden',
    borderWidth: 1,
    ...SHADOWS.md,
  },
  settingsItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 76,
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.md,
    borderBottomWidth: 1,
  },
  settingsItemLast: {
    borderBottomWidth: 0,
  },
  settingsItemDisabled: {
    opacity: 0.5,
  },
  settingsItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  settingsIconContainer: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: SPACING.md,
    borderRadius: 11,
  },
  dangerIconContainer: {
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
  },
  settingsTextContainer: {
    flex: 1,
  },
  settingsLabel: {
    fontSize: FONTS.base,
    fontWeight: '600',
    marginBottom: 2,
  },
  settingsDescription: {
    fontSize: FONTS.sm,
  },
  versionInfo: {
    alignItems: 'center',
    paddingVertical: SPACING.xl,
  },
  versionText: {
    fontSize: FONTS.sm,
    marginBottom: 4,
  },
  versionSubtext: {
    fontSize: FONTS.xs,
  },
});
