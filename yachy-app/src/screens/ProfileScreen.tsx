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
  Modal,
  Pressable,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SIZES, SHADOWS } from '../constants/theme';
import { useAuthStore, useThemeStore, BACKGROUND_THEMES } from '../store';
import { supabase } from '../services/supabase';
import authService from '../services/auth';
import { Button, LoadingSpinner, PageHeader, LabeledDropdown } from '../components';
import userService from '../services/user';
import { Department } from '../types';
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
  const [departmentDropdownOpen, setDepartmentDropdownOpen] = useState(false);
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

  const departments: Department[] = ['BRIDGE', 'ENGINEERING', 'EXTERIOR', 'INTERIOR', 'GALLEY'];

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

  const handleRemovePhoto = async () => {
    Alert.alert('Remove Photo', 'Are you sure you want to remove your profile photo?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          setIsUploadingPhoto(true);
          try {
            await userService.deleteProfilePhoto(user!.id);
            setProfilePhoto(undefined);
            setPhotoLoadFailed(true);

            const updatedUser = await userService.updateProfile(user!.id, {
              profilePhoto: '',
            });

            if (updatedUser) {
              setUser(updatedUser);
            }

            Alert.alert('Success', 'Profile photo removed!');
          } catch (error) {
            console.error('Remove photo error:', error);
            Alert.alert('Error', 'Failed to remove photo. Please try again.');
          } finally {
            setIsUploadingPhoto(false);
          }
        },
      },
    ]);
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

  const settingsSections: Array<{
    title: string;
    items: Array<{
      icon: string;
      label: string;
      description: string;
      onPress: () => void;
      disabled: boolean;
    }>;
  }> = [];

  return (
    <View style={styles.pageWrap}>
      <PageHeader title="Settings & Profile" />
      <ScrollView style={[styles.container, { backgroundColor: themeColors.background }]}>
        <View style={styles.content}>
          {/* Profile Photo Section */}
          <View style={styles.photoSection}>
            <View style={styles.photoContainer}>
              {isUploadingPhoto ? (
                <View style={styles.photoLoading}>
                  <LoadingSpinner />
                </View>
              ) : displayPhotoUri && !photoLoadFailed ? (
                <Image
                  source={{ uri: displayPhotoUri }}
                  style={styles.photo}
                  onError={() => !localPreviewUri && setPhotoLoadFailed(true)}
                />
              ) : (
                <View style={styles.photoPlaceholder}>
                  <Text style={styles.photoPlaceholderText}>
                    {user?.name.charAt(0).toUpperCase()}
                  </Text>
                </View>
              )}
            </View>
            <View style={styles.photoActions}>
              <Button
                title="Change Photo"
                onPress={handlePickImage}
                variant="outline"
                shape="pill"
                size="small"
                style={styles.photoButton}
                disabled={isUploadingPhoto}
              />
              {profilePhoto && (
                <Button
                  title="Remove"
                  onPress={handleRemovePhoto}
                  variant="outline"
                  shape="pill"
                  size="small"
                  style={styles.photoButton}
                  disabled={isUploadingPhoto}
                />
              )}
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
                  <Text
                    style={[
                      styles.editButton,
                      { color: themeColors.isDark ? COLORS.white : COLORS.primary },
                    ]}
                  >
                    Edit
                  </Text>
                </TouchableOpacity>
              )}
            </View>

            <View style={[styles.card, { backgroundColor: themeColors.surface }]}>
              {/* Name */}
              <View style={styles.field}>
                <Text
                  style={[
                    styles.label,
                    { color: themeColors.isDark ? COLORS.white : themeColors.textSecondary },
                  ]}
                >
                  Name
                </Text>
                {isEditing ? (
                  <TextInput
                    style={[
                      styles.input,
                      { backgroundColor: themeColors.surface, color: themeColors.textPrimary },
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
              <View style={styles.field}>
                <Text
                  style={[
                    styles.label,
                    { color: themeColors.isDark ? COLORS.white : themeColors.textSecondary },
                  ]}
                >
                  Position
                </Text>
                {isEditing ? (
                  <TextInput
                    style={[
                      styles.input,
                      { backgroundColor: themeColors.surface, color: themeColors.textPrimary },
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
              <View style={styles.field}>
                {isEditing ? (
                  <>
                    <LabeledDropdown
                      label="Department"
                      value={department.charAt(0) + department.slice(1).toLowerCase()}
                      open={departmentDropdownOpen}
                      onPress={() => setDepartmentDropdownOpen(true)}
                      tightTop
                    />
                    {departmentDropdownOpen && (
                      <Modal visible transparent animationType="fade">
                        <Pressable
                          style={styles.modalBackdrop}
                          onPress={() => setDepartmentDropdownOpen(false)}
                        >
                          <View
                            style={[styles.modalBox, { backgroundColor: themeColors.surface }]}
                            onStartShouldSetResponder={() => true}
                          >
                            {departments.map((dept) => (
                              <TouchableOpacity
                                key={dept}
                                style={[
                                  styles.modalItem,
                                  department === dept && styles.modalItemSelected,
                                ]}
                                onPress={() => {
                                  setDepartment(dept);
                                  setDepartmentDropdownOpen(false);
                                }}
                              >
                                <Text
                                  style={[
                                    styles.modalItemText,
                                    { color: themeColors.textPrimary },
                                    department === dept && styles.modalItemTextSelected,
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
                ) : (
                  <>
                    <Text
                      style={[
                        styles.label,
                        { color: themeColors.isDark ? COLORS.white : themeColors.textSecondary },
                      ]}
                    >
                      Department
                    </Text>
                    <Text style={[styles.value, { color: themeColors.textPrimary }]}>
                      {user?.department}
                    </Text>
                  </>
                )}
              </View>

              {/* Email (read-only) */}
              <View style={[styles.field, styles.fieldLast]}>
                <Text
                  style={[
                    styles.label,
                    { color: themeColors.isDark ? COLORS.white : themeColors.textSecondary },
                  ]}
                >
                  Email
                </Text>
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
            <Text style={[styles.sectionTitle, { color: themeColors.textSecondary }]}>
              Account Information
            </Text>
            <View style={[styles.card, { backgroundColor: themeColors.surface }]}>
              <View style={styles.field}>
                <Text
                  style={[
                    styles.label,
                    { color: themeColors.isDark ? COLORS.white : themeColors.textSecondary },
                  ]}
                >
                  Role
                </Text>
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: SPACING.sm,
                    flexWrap: 'wrap',
                  }}
                >
                  <View style={styles.roleBadge}>
                    <Text style={[styles.roleText, { textTransform: 'none' }]}>
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
              <View style={[styles.field, styles.fieldLast]}>
                <Text
                  style={[
                    styles.label,
                    { color: themeColors.isDark ? COLORS.white : themeColors.textSecondary },
                  ]}
                >
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

          {/* E-signature */}
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: themeColors.textSecondary }]}>
              E-signature
            </Text>
            <View style={[styles.settingsCard, { backgroundColor: themeColors.surface }]}>
              <TouchableOpacity
                style={[styles.settingsItem, styles.settingsItemLast]}
                onPress={() => navigation.navigate('SignatureSetup')}
                activeOpacity={0.7}
              >
                <View style={styles.settingsItemLeft}>
                  <Text style={styles.settingsIcon}>{'\u270D\uFE0F'}</Text>
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
                <Text style={[styles.chevron, { color: themeColors.textSecondary }]}>
                  {'\u203A'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
          {/* Join Vessel */}
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: themeColors.textSecondary }]}>
              Join Vessel
            </Text>
            <View style={[styles.settingsCard, { backgroundColor: themeColors.surface }]}>
              <TouchableOpacity
                style={[styles.settingsItem, isCaptain ? undefined : styles.settingsItemLast]}
                onPress={() => navigation.navigate('JoinVessel')}
                activeOpacity={0.7}
              >
                <View style={styles.settingsItemLeft}>
                  <Text style={styles.settingsIcon}>{'\u2693'}</Text>
                  <View style={styles.settingsTextContainer}>
                    <Text style={[styles.settingsLabel, { color: themeColors.textPrimary }]}>
                      Join a different vessel
                    </Text>
                    <Text
                      style={[styles.settingsDescription, { color: themeColors.textSecondary }]}
                    >
                      Switch vessels using a new invite code
                    </Text>
                  </View>
                </View>
                <Text style={[styles.chevron, { color: themeColors.textSecondary }]}>
                  {'\u203A'}
                </Text>
              </TouchableOpacity>
              {!!user?.vesselId && (
                <TouchableOpacity
                  style={styles.settingsItem}
                  onPress={handleLeaveVessel}
                  activeOpacity={0.7}
                >
                  <View style={styles.settingsItemLeft}>
                    <Text style={styles.settingsIcon}>{'\u26F5'}</Text>
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
                  <Text style={[styles.chevron, { color: themeColors.textSecondary }]}>
                    {'\u203A'}
                  </Text>
                </TouchableOpacity>
              )}
              {isCaptain && (
                <TouchableOpacity
                  style={[styles.settingsItem, styles.settingsItemLast]}
                  onPress={handleDeleteVessel}
                  activeOpacity={0.7}
                >
                  <View style={styles.settingsItemLeft}>
                    <Text style={styles.settingsIcon}>{'\u26A0\uFE0F'}</Text>
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
                  <Text style={[styles.chevron, { color: themeColors.textSecondary }]}>
                    {'\u203A'}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
          {/* Settings Sections */}
          {settingsSections.map((section, sectionIndex) => (
            <View key={sectionIndex} style={styles.section}>
              <Text style={[styles.sectionTitle, { color: themeColors.textSecondary }]}>
                {section.title}
              </Text>
              <View style={[styles.settingsCard, { backgroundColor: themeColors.surface }]}>
                {section.items.map((item, itemIndex) => (
                  <TouchableOpacity
                    key={itemIndex}
                    style={[
                      styles.settingsItem,
                      item.disabled && styles.settingsItemDisabled,
                      itemIndex === section.items.length - 1 && styles.settingsItemLast,
                    ]}
                    onPress={item.onPress}
                    disabled={item.disabled}
                    activeOpacity={0.7}
                  >
                    <View style={styles.settingsItemLeft}>
                      <Text style={styles.settingsIcon}>{item.icon}</Text>
                      <View style={styles.settingsTextContainer}>
                        <Text style={[styles.settingsLabel, { color: themeColors.textPrimary }]}>
                          {item.label}
                        </Text>
                        <Text
                          style={[styles.settingsDescription, { color: themeColors.textSecondary }]}
                        >
                          {item.description}
                        </Text>
                      </View>
                    </View>
                    <Text style={[styles.chevron, { color: themeColors.textSecondary }]}>›</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          ))}

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
                title={isSaving ? 'Saving...' : 'Save Changes'}
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
    backgroundColor: COLORS.background,
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
  photoSection: {
    alignItems: 'center',
    marginBottom: SPACING.xl,
  },
  photoContainer: {
    marginBottom: SPACING.md,
  },
  photo: {
    width: 120,
    height: 120,
    borderRadius: 60,
  },
  photoPlaceholder: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: COLORS.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  photoPlaceholderText: {
    fontSize: 48,
    fontWeight: 'bold',
    color: COLORS.white,
  },
  photoLoading: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: COLORS.background,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: COLORS.border,
  },
  photoActions: {
    flexDirection: 'row',
    gap: SPACING.sm,
  },
  photoButton: {
    minWidth: 100,
  },
  section: {
    marginBottom: SPACING.xl,
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
  editButton: {
    fontSize: FONTS.base,
    fontWeight: '600',
  },
  card: {
    backgroundColor: COLORS.white,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.lg,
    ...SHADOWS.md,
  },
  field: {
    marginBottom: SPACING.lg,
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
    color: COLORS.textPrimary,
    backgroundColor: COLORS.background,
    borderWidth: 1,
    borderColor: COLORS.border,
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
    backgroundColor: COLORS.primary,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 4,
    borderRadius: BORDER_RADIUS.sm,
  },
  roleText: {
    fontSize: FONTS.sm,
    fontWeight: 'bold',
    color: COLORS.white,
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
    ...SHADOWS.md,
  },
  settingsItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: SPACING.lg,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
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
  settingsIcon: {
    fontSize: 24,
    marginRight: SPACING.md,
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
  chevron: {
    fontSize: 24,
    fontWeight: '300',
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
