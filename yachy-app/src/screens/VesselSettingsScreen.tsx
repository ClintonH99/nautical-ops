/**
 * Vessel Settings Screen
 * Captain/MOV can manage vessel name, subscription plans, and invite code.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  TextInput,
  Share,
  Image,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SIZES } from '../constants/theme';
import { useAuthStore } from '../store';
import { useThemeColors } from '../hooks/useThemeColors';
import { useSubscriptionStatus } from '../hooks/useSubscriptionStatus';
import { Button, LoadingSpinner, PageHeader } from '../components';
import vesselService from '../services/vessel';
import userService from '../services/user';
import { Vessel } from '../types';
import { getPlanTier, getBillingPeriod } from '../constants/subscriptionPlans';
import { canAccessVesselManagement } from '../utils/access';
import { usePostHog } from 'posthog-react-native';

// React Native resolves static image assets through require().
// eslint-disable-next-line @typescript-eslint/no-require-imports
const DEFAULT_VESSEL_BANNER = require('../../assets/default-vessel-banner.png');

export const VesselSettingsScreen = ({ navigation }: any) => {
  const themeColors = useThemeColors();
  const { user } = useAuthStore();
  const posthog = usePostHog();
  const [vessel, setVessel] = useState<Vessel | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isEditingName, setIsEditingName] = useState(false);
  const [isSavingName, setIsSavingName] = useState(false);
  const [isRegeneratingCode, setIsRegeneratingCode] = useState(false);
  const [isUploadingBanner, setIsUploadingBanner] = useState(false);
  const [vesselName, setVesselName] = useState('');
  const [imoNumber, setImoNumber] = useState('');
  const [isEditingImo, setIsEditingImo] = useState(false);
  const [isSavingImo, setIsSavingImo] = useState(false);
  const [crewCount, setCrewCount] = useState(0);
  const [bannerUrl, setBannerUrl] = useState<string | null>(null);
  const [bannerLoadFailed, setBannerLoadFailed] = useState(false);

  const {
    hasActiveSubscription: _hasActiveSubscription,
    subscription,
    accessState: subscriptionAccessState,
    refetch: refetchSubscription,
  } = useSubscriptionStatus(user?.vesselId ?? null);
  const hasActiveSubscription = _hasActiveSubscription;

  const isCaptain = user?.role === 'CAPTAIN_MOV';

  const loadVessel = useCallback(async () => {
    if (!user?.vesselId) return;
    setIsLoading(true);
    try {
      const [vesselData, crew] = await Promise.all([
        vesselService.getVessel(user.vesselId),
        userService.getVesselCrew(user.vesselId),
      ]);
      if (vesselData) {
        setVessel(vesselData);
        setBannerUrl(vesselService.getBannerPublicUrl(user.vesselId));
        setBannerLoadFailed(false);
        setVesselName(vesselData.name);
        setImoNumber(vesselData.imoNumber || '');
      }
      setCrewCount(crew?.length ?? 0);
    } catch (error) {
      console.error('Load vessel error:', error);
      Alert.alert('Error', 'Failed to load vessel information');
    } finally {
      setIsLoading(false);
    }
  }, [user?.vesselId]);

  useEffect(() => {
    if (!isCaptain) {
      Alert.alert('Access Denied', 'Only the Captain can access vessel settings', [
        { text: 'OK', onPress: () => navigation.goBack() },
      ]);
      return;
    }
    loadVessel();
  }, [isCaptain, loadVessel, navigation]);

  useFocusEffect(
    useCallback(() => {
      if (!canAccessVesselManagement(user)) {
        navigation.goBack();
        return;
      }
      refetchSubscription();
    }, [user, navigation, refetchSubscription])
  );

  const handleSaveName = async () => {
    if (!vesselName.trim()) {
      Alert.alert('Error', 'Vessel name is required');
      return;
    }
    if (!user?.vesselId) return;
    setIsSavingName(true);
    try {
      await vesselService.updateVesselName(user.vesselId, vesselName.trim());
      const updatedVessel = await vesselService.getVessel(user.vesselId);
      if (updatedVessel) setVessel(updatedVessel);
      setIsEditingName(false);
      Alert.alert('Success', 'Vessel name updated successfully!');
    } catch (error) {
      console.error('Save name error:', error);
      Alert.alert('Error', 'Failed to update vessel name');
    } finally {
      setIsSavingName(false);
    }
  };

  const handleCancelEditName = () => {
    setVesselName(vessel?.name || '');
    setIsEditingName(false);
  };

  const handleSaveImo = async () => {
    if (!user?.vesselId) return;
    setIsSavingImo(true);
    try {
      await vesselService.updateVesselImo(user.vesselId, imoNumber.trim());
      const updatedVessel = await vesselService.getVessel(user.vesselId);
      if (updatedVessel) setVessel(updatedVessel);
      setIsEditingImo(false);
    } catch (error) {
      console.error('Save IMO error:', error);
      Alert.alert('Error', 'Failed to update IMO number');
    } finally {
      setIsSavingImo(false);
    }
  };

  const handleCancelEditImo = () => {
    setImoNumber(vessel?.imoNumber || '');
    setIsEditingImo(false);
  };

  const handleRegenerateCode = () => {
    Alert.alert(
      'Regenerate Invite Code',
      'This will create a new invite code and expire the old one. Crew members using the old code will no longer be able to join. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Regenerate',
          style: 'destructive',
          onPress: async () => {
            if (!user?.vesselId) return;
            setIsRegeneratingCode(true);
            try {
              const newCode = await vesselService.regenerateInviteCode(user.vesselId);
              const updatedVessel = await vesselService.getVessel(user.vesselId);
              if (updatedVessel) setVessel(updatedVessel);
              Alert.alert(
                'Success',
                `New invite code: ${newCode}\n\nShare this with crew members to join your vessel.`
              );
            } catch (error) {
              console.error('Regenerate code error:', error);
              Alert.alert('Error', 'Failed to regenerate invite code');
            } finally {
              setIsRegeneratingCode(false);
            }
          },
        },
      ]
    );
  };

  const handleChangeVesselPhoto = async () => {
    if (!user?.vesselId) return;
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Required', 'Please grant permission to access your photos');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [16, 9],
        quality: 0.75,
      });
      if (!result.canceled && result.assets[0]) {
        setIsUploadingBanner(true);
        try {
          const uploadedUrl = await vesselService.uploadBannerImage(
            user.vesselId,
            result.assets[0].uri
          );
          setBannerUrl(uploadedUrl);
          setBannerLoadFailed(false);
          Alert.alert('Success', 'Vessel photo updated.');
        } catch (error) {
          console.error('Banner upload error:', error);
          Alert.alert('Error', 'Failed to upload photo.');
        } finally {
          setIsUploadingBanner(false);
        }
      }
    } catch (error) {
      console.error('Pick image error:', error);
      Alert.alert('Error', 'Failed to pick image. Please try again.');
    }
  };

  const handleCopyCode = async () => {
    if (!vessel?.inviteCode) return;
    await Clipboard.setStringAsync(vessel.inviteCode);
    posthog.capture('invite_code_copied', { vessel_id: vessel.id });
    Alert.alert('Copied!', 'Invite code copied to clipboard');
  };

  const handleShareCode = async () => {
    if (!vessel?.inviteCode) return;
    try {
      await Share.share({
        message: `Join our yacht crew on Nautical Ops!\n\nVessel: ${vessel.name}\nInvite Code: ${vessel.inviteCode}\n\nDownload the app and use this code to get started.`,
        title: 'Nautical Ops Invite',
      });
      posthog.capture('invite_code_shared', { vessel_id: vessel.id });
    } catch (error) {
      console.error('Share error:', error);
    }
  };

  const currentPlan = subscription ? getPlanTier(subscription.planTier) : null;
  const needsUpgrade =
    currentPlan && crewCount >= currentPlan.maxCrew && currentPlan.maxCrew !== Infinity;
  const crewLimitReached =
    currentPlan && crewCount >= currentPlan.maxCrew && currentPlan.maxCrew !== Infinity;

  const formatExpiry = (expiryDate: string) => {
    const date = new Date(expiryDate);
    const now = new Date();
    const daysUntilExpiry = Math.ceil((date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    if (daysUntilExpiry < 0) return 'Expired';
    else if (daysUntilExpiry === 0) return 'Expires today';
    else if (daysUntilExpiry === 1) return 'Expires tomorrow';
    else if (daysUntilExpiry < 30) return `Expires in ${daysUntilExpiry} days`;
    else
      return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  };

  if (!isCaptain) return null;

  if (isLoading) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: themeColors.background }]}>
        <LoadingSpinner />
        <Text style={[styles.loadingText, { color: themeColors.textSecondary }]}>
          Loading vessel settings...
        </Text>
      </View>
    );
  }

  if (!vessel) {
    return (
      <View style={[styles.errorContainer, { backgroundColor: themeColors.background }]}>
        <Text style={[styles.errorText, { color: themeColors.textPrimary }]}>Vessel not found</Text>
        <Button title="Go Back" onPress={() => navigation.goBack()} variant="primary" />
      </View>
    );
  }

  return (
    <View style={[styles.pageWrap, { backgroundColor: themeColors.background }]}>
      <PageHeader title="Vessel Settings" />
      <ScrollView style={[styles.container, { backgroundColor: themeColors.background }]}>
        <View style={styles.content}>
          {/* Subscription / Vessel Plans Link */}
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: themeColors.textSecondary }]}>
              Subscription
            </Text>
            <View
              style={[
                styles.card,
                {
                  backgroundColor: themeColors.surface,
                  borderColor: themeColors.border,
                },
              ]}
            >
              {hasActiveSubscription ? (
                <>
                  <Text style={[styles.currentPlanLabel, { color: themeColors.textPrimary }]}>
                    Current Plan
                  </Text>
                  <Text style={[styles.currentPlanValue, { color: themeColors.textPrimary }]}>
                    {subscription
                      ? `${currentPlan?.label ?? subscription.planTier} • ${getBillingPeriod(subscription.billingPeriod)?.label ?? subscription.billingPeriod}`
                      : 'Active (via App Store)'}
                  </Text>
                  {subscription && (
                    <Text style={[styles.renewalText, { color: themeColors.textSecondary }]}>
                      Renews{' '}
                      {new Date(subscription.currentPeriodEnd).toLocaleDateString('en-US', {
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric',
                      })}
                    </Text>
                  )}
                  {needsUpgrade && (
                    <View
                      style={[
                        styles.upgradeBanner,
                        { backgroundColor: 'rgba(245, 158, 11, 0.2)', borderColor: COLORS.warning },
                      ]}
                    >
                      <Text style={[styles.upgradeBannerText, { color: themeColors.textPrimary }]}>
                        You have reached your crew limit ({crewCount}/{currentPlan!.maxCrew}).
                        Upgrade your plan to invite more crew members.
                      </Text>
                    </View>
                  )}
                </>
              ) : subscriptionAccessState === 'unavailable' ? (
                <Text style={[styles.plansLinkText, { color: themeColors.textPrimary }]}>
                  Subscription details are temporarily unavailable. Your access has not been
                  changed; please try again shortly.
                </Text>
              ) : (
                <Text style={[styles.plansLinkText, { color: themeColors.textPrimary }]}>
                  Choose a subscription plan to unlock your invite code and invite crew.
                </Text>
              )}
              <Button
                title="Manage"
                onPress={() => navigation.navigate('VesselPlans')}
                variant="outline"
                style={styles.planButton}
              />
            </View>
          </View>

          {/* Vessel Photo Section */}
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: themeColors.textSecondary }]}>
              Vessel Photo
            </Text>
            <View
              style={[
                styles.card,
                {
                  backgroundColor: themeColors.surface,
                  borderColor: themeColors.border,
                },
              ]}
            >
              <Image
                source={bannerUrl && !bannerLoadFailed ? { uri: bannerUrl } : DEFAULT_VESSEL_BANNER}
                style={styles.vesselPhoto}
                onError={() => setBannerLoadFailed(true)}
              />
              <TouchableOpacity
                style={[
                  styles.photoButton,
                  { borderColor: themeColors.isDark ? themeColors.borderStrong : COLORS.primary },
                ]}
                onPress={handleChangeVesselPhoto}
                disabled={isUploadingBanner}
                activeOpacity={0.75}
              >
                <Ionicons
                  name="camera-outline"
                  size={19}
                  color={themeColors.isDark ? themeColors.textPrimary : COLORS.primary}
                />
                <Text
                  style={[
                    styles.photoButtonText,
                    { color: themeColors.isDark ? themeColors.textPrimary : COLORS.primary },
                  ]}
                >
                  {isUploadingBanner ? 'Uploading...' : 'Change Photo'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Vessel Name Section */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={[styles.sectionTitle, { color: themeColors.textSecondary }]}>
                Vessel Name
              </Text>
              {!isEditingName && (
                <TouchableOpacity onPress={() => setIsEditingName(true)}>
                  <Text style={[styles.editButton, { color: themeColors.accent }]}>Edit</Text>
                </TouchableOpacity>
              )}
            </View>
            <View
              style={[
                styles.card,
                {
                  backgroundColor: themeColors.surface,
                  borderColor: themeColors.border,
                },
              ]}
            >
              {isEditingName ? (
                <>
                  <TextInput
                    style={[
                      styles.input,
                      {
                        backgroundColor: themeColors.control,
                        color: themeColors.textPrimary,
                        borderColor: themeColors.isDark ? themeColors.borderStrong : COLORS.border,
                      },
                    ]}
                    value={vesselName}
                    onChangeText={setVesselName}
                    placeholder="Enter vessel name"
                    placeholderTextColor={themeColors.textSecondary}
                    autoFocus
                  />
                  <View style={styles.actions}>
                    <Button
                      title="Cancel"
                      onPress={handleCancelEditName}
                      variant="outline"
                      fullWidth
                      style={styles.actionButton}
                      disabled={isSavingName}
                    />
                    <Button
                      title={isSavingName ? 'Saving…' : 'Save Changes'}
                      onPress={handleSaveName}
                      variant="primary"
                      fullWidth
                      style={styles.actionButton}
                      disabled={isSavingName}
                    />
                  </View>
                </>
              ) : (
                <Text style={[styles.vesselNameDisplay, { color: themeColors.textPrimary }]}>
                  {vessel.name}
                </Text>
              )}
            </View>
          </View>

          {/* IMO Number Section */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={[styles.sectionTitle, { color: themeColors.textSecondary }]}>
                IMO Number
              </Text>
              {!isEditingImo && (
                <TouchableOpacity onPress={() => setIsEditingImo(true)}>
                  <Text style={[styles.editButton, { color: themeColors.accent }]}>Edit</Text>
                </TouchableOpacity>
              )}
            </View>
            <View
              style={[
                styles.card,
                {
                  backgroundColor: themeColors.surface,
                  borderColor: themeColors.border,
                },
              ]}
            >
              {isEditingImo ? (
                <>
                  <TextInput
                    style={[
                      styles.input,
                      {
                        backgroundColor: themeColors.control,
                        color: themeColors.textPrimary,
                        borderColor: themeColors.isDark ? themeColors.borderStrong : COLORS.border,
                      },
                    ]}
                    value={imoNumber}
                    onChangeText={setImoNumber}
                    placeholder="Enter IMO number"
                    placeholderTextColor={themeColors.textSecondary}
                    autoFocus
                    keyboardType="number-pad"
                  />
                  <View style={styles.actions}>
                    <Button
                      title="Cancel"
                      onPress={handleCancelEditImo}
                      variant="outline"
                      fullWidth
                      style={styles.actionButton}
                      disabled={isSavingImo}
                    />
                    <Button
                      title={isSavingImo ? 'Saving…' : 'Save Changes'}
                      onPress={handleSaveImo}
                      variant="primary"
                      fullWidth
                      style={styles.actionButton}
                      disabled={isSavingImo}
                    />
                  </View>
                </>
              ) : (
                <Text style={[styles.vesselNameDisplay, { color: themeColors.textPrimary }]}>
                  {vessel.imoNumber || 'Not set'}
                </Text>
              )}
            </View>
          </View>

          {/* Invite Code Section */}
          <View style={[styles.section, !hasActiveSubscription && { opacity: 0.6 }]}>
            <Text style={[styles.sectionTitle, { color: themeColors.textSecondary }]}>
              Invite Code
            </Text>

            {hasActiveSubscription && !crewLimitReached ? (
              <>
                <View
                  style={[
                    styles.card,
                    {
                      backgroundColor: themeColors.surface,
                      borderColor: themeColors.border,
                    },
                  ]}
                >
                  <View style={styles.codeContainer}>
                    <Text style={[styles.codeLabel, { color: themeColors.textSecondary }]}>
                      Current Code
                    </Text>
                    <View
                      style={[styles.codeBox, { backgroundColor: themeColors.controlSelected }]}
                    >
                      <Text
                        style={[
                          styles.codeText,
                          {
                            color: themeColors.isDark ? themeColors.textOnAccent : COLORS.primary,
                          },
                        ]}
                      >
                        {vessel.inviteCode}
                      </Text>
                    </View>
                    <Text style={[styles.expiryText, { color: themeColors.textSecondary }]}>
                      {formatExpiry(vessel.inviteExpiry)}
                    </Text>
                  </View>
                  <View style={styles.codeActions}>
                    <Button
                      title="Copy"
                      onPress={handleCopyCode}
                      variant="outline"
                      fullWidth
                      style={styles.codeButton}
                    />
                    <Button
                      title="Share"
                      onPress={handleShareCode}
                      variant="outline"
                      fullWidth
                      style={styles.codeButton}
                    />
                  </View>
                  <View
                    style={[styles.regenerateContainer, { borderTopColor: themeColors.border }]}
                  >
                    <Button
                      title={isRegeneratingCode ? 'Generating...' : 'Regenerate Code'}
                      onPress={handleRegenerateCode}
                      variant="outline"
                      fullWidth
                      disabled={isRegeneratingCode}
                    />
                    <View style={styles.regenerateWarningRow}>
                      <Ionicons name="warning-outline" size={16} color={COLORS.warning} />
                      <Text
                        style={[styles.regenerateWarning, { color: themeColors.textSecondary }]}
                      >
                        Regenerating expires the current code. Each code can be used by one crew
                        member.
                      </Text>
                    </View>
                  </View>
                </View>
              </>
            ) : hasActiveSubscription && crewLimitReached ? (
              <View
                style={[
                  styles.card,
                  styles.gatedCard,
                  {
                    backgroundColor: themeColors.surface,
                    borderColor: themeColors.border,
                  },
                ]}
              >
                <Text style={[styles.gatedText, { color: themeColors.textPrimary }]}>
                  You have reached your crew limit of{' '}
                  <Text style={styles.gatedBold}>{currentPlan!.maxCrew}</Text>. Upgrade your plan in{' '}
                  <Text style={styles.gatedBold}>Vessel Plans</Text> to invite more crew members.
                </Text>
              </View>
            ) : subscriptionAccessState === 'unavailable' ? (
              <View
                style={[
                  styles.card,
                  styles.gatedCard,
                  {
                    backgroundColor: themeColors.surface,
                    borderColor: themeColors.border,
                  },
                ]}
              >
                <Text style={[styles.gatedText, { color: themeColors.textPrimary }]}>
                  The subscription service is temporarily unavailable. Your payment status has not
                  been changed; please try again shortly.
                </Text>
              </View>
            ) : (
              <View
                style={[
                  styles.card,
                  styles.gatedCard,
                  {
                    backgroundColor: themeColors.surface,
                    borderColor: themeColors.border,
                  },
                ]}
              >
                <Text style={[styles.gatedText, { color: themeColors.textPrimary }]}>
                  In order to invite Crew Members to the Vessel, please refer to{' '}
                  <Text style={styles.gatedBold}>Vessel Plans</Text> to see the different plans that
                  will best suit your operations. Once a plan has been chosen and payment has been
                  made then you will have access to the Invite Code for Crew.
                </Text>
              </View>
            )}
          </View>

          {/* Vessel Info Section */}
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: themeColors.textSecondary }]}>
              Vessel Information
            </Text>
            <View
              style={[
                styles.card,
                {
                  backgroundColor: themeColors.surface,
                  borderColor: themeColors.border,
                },
              ]}
            >
              <View style={[styles.infoRow, { borderBottomColor: themeColors.border }]}>
                <Text style={[styles.infoRowLabel, { color: themeColors.textSecondary }]}>
                  Vessel ID
                </Text>
                <Text style={[styles.infoRowValue, { color: themeColors.textPrimary }]}>
                  {vessel.id.slice(0, 8)}...
                </Text>
              </View>
              <View style={[styles.infoRow, { borderBottomColor: themeColors.border }]}>
                <Text style={[styles.infoRowLabel, { color: themeColors.textSecondary }]}>
                  Created
                </Text>
                <Text style={[styles.infoRowValue, { color: themeColors.textPrimary }]}>
                  {new Date(vessel.createdAt).toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                  })}
                </Text>
              </View>
              <View style={[styles.infoRow, styles.infoRowLast]}>
                <Text style={[styles.infoRowLabel, { color: themeColors.textSecondary }]}>
                  Last Updated
                </Text>
                <Text style={[styles.infoRowValue, { color: themeColors.textPrimary }]}>
                  {new Date(vessel.updatedAt).toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                  })}
                </Text>
              </View>
            </View>
          </View>
        </View>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  pageWrap: { flex: 1 },
  container: { flex: 1 },
  content: { padding: SPACING.lg, paddingBottom: SIZES.bottomScrollPadding },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { marginTop: SPACING.md, fontSize: FONTS.base },
  errorContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: SPACING.lg },
  errorText: { fontSize: FONTS.lg, color: COLORS.error, marginBottom: SPACING.lg },
  section: { marginBottom: SPACING.lg },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.sm,
  },
  sectionTitle: {
    fontSize: FONTS.xs,
    fontWeight: '600',
    letterSpacing: 0.7,
    textTransform: 'uppercase',
  },
  sectionSubtitle: { fontSize: FONTS.sm, marginBottom: SPACING.md },
  billingPeriodRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.sm,
    marginBottom: SPACING.lg,
  },
  billingPeriodChip: {
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  billingPeriodChipText: { fontSize: FONTS.sm, fontWeight: '600' },
  billingPeriodDiscount: { fontSize: FONTS.xs, marginTop: 2 },
  planCard: {
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.md,
    marginBottom: SPACING.sm,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  planCardSelected: { borderColor: COLORS.primary },
  planCardContent: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  planCardLabel: { fontSize: FONTS.base, fontWeight: '500', flex: 1 },
  planCardPriceCol: { alignItems: 'flex-end' },
  planCardPrice: { fontSize: FONTS.base, fontWeight: '700' },
  planCardTotal: { fontSize: FONTS.xs, marginTop: 2 },
  planActions: { marginTop: SPACING.lg, gap: SPACING.sm },
  planButton: { marginTop: SPACING.sm, alignSelf: 'flex-start', minWidth: 110 },
  plansLinkText: { fontSize: FONTS.base, marginBottom: SPACING.md, lineHeight: 22 },
  currentPlanLabel: { fontSize: FONTS.sm, fontWeight: '600', marginBottom: SPACING.xs },
  currentPlanValue: { fontSize: FONTS.lg, fontWeight: 'bold', marginBottom: SPACING.xs },
  renewalText: { fontSize: FONTS.sm, marginBottom: SPACING.md },
  upgradeBanner: {
    padding: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1,
    marginBottom: SPACING.md,
  },
  upgradeBannerText: { fontSize: FONTS.sm },
  gatedCard: { padding: SPACING.xl },
  gatedText: { fontSize: FONTS.base, lineHeight: 24, textAlign: 'center' },
  gatedBold: { fontWeight: '700' },
  editButton: { fontSize: FONTS.base, color: COLORS.primary, fontWeight: '600' },
  card: {
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.md,
    shadowColor: COLORS.black,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
    borderWidth: 1,
  },
  vesselNameDisplay: { fontSize: FONTS.xl, fontWeight: 'bold' },
  input: {
    fontSize: FONTS.base,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.md,
    marginBottom: SPACING.md,
  },
  actions: { flexDirection: 'row', gap: SPACING.md },
  actionButton: { flex: 1 },
  codeContainer: { alignItems: 'center', marginBottom: SPACING.lg },
  codeLabel: { fontSize: FONTS.sm, fontWeight: '600', marginBottom: SPACING.sm },
  codeBox: {
    backgroundColor: COLORS.primaryLight,
    paddingHorizontal: SPACING.xl,
    paddingVertical: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    marginBottom: SPACING.xs,
  },
  codeText: { fontSize: FONTS['2xl'], fontWeight: 'bold', color: COLORS.primary, letterSpacing: 4 },
  expiryText: { fontSize: FONTS.sm },
  codeActions: { flexDirection: 'row', gap: SPACING.md, marginBottom: SPACING.lg },
  codeButton: { flex: 1 },
  regenerateContainer: { borderTopWidth: 1, borderTopColor: COLORS.border, paddingTop: SPACING.lg },
  regenerateWarningRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'center',
    gap: SPACING.xs,
    marginTop: SPACING.sm,
  },
  regenerateWarning: {
    flex: 1,
    fontSize: FONTS.xs,
    lineHeight: 17,
  },
  infoCard: {
    backgroundColor: COLORS.primaryLight,
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.lg,
    marginTop: SPACING.md,
    borderWidth: 1,
  },
  infoTitle: {
    fontSize: FONTS.base,
    fontWeight: '600',
    color: COLORS.primary,
    marginBottom: SPACING.sm,
  },
  infoText: { fontSize: FONTS.sm, marginBottom: SPACING.xs, lineHeight: 20 },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: SPACING.sm,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  infoRowLast: { borderBottomWidth: 0 },
  vesselPhoto: {
    width: '100%',
    height: 150,
    borderRadius: BORDER_RADIUS.md,
    marginBottom: SPACING.md,
  },
  photoButton: {
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.sm,
    borderWidth: 1,
    borderRadius: BORDER_RADIUS.md,
  },
  photoButtonText: { fontSize: FONTS.sm, fontWeight: '600' },
  infoRowLabel: { fontSize: FONTS.sm },
  infoRowValue: { fontSize: FONTS.sm, fontWeight: '500' },
});
