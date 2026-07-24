/**
 * Vessel Plans Screen
 * Subscription plan selection via Apple In-App Purchase, in compliance
 * with App Store Review Guideline 3.1.2 (auto-renewing subscriptions):
 * clear plan/price disclosure before purchase, explicit charge/renewal
 * terms, a working Restore Purchases action, subscription management
 * routed through the user's own Apple ID account (not a website we
 * control), and EULA/Privacy Policy links at the point of purchase.
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  Platform,
  ActivityIndicator,
  Linking,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { usePostHog } from 'posthog-react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SIZES } from '../constants/theme';
import { useThemeColors } from '../hooks/useThemeColors';
import { useAuthStore } from '../store';
import { useSubscriptionStatus } from '../hooks/useSubscriptionStatus';
import { Button } from '../components';
import {
  PLAN_TIERS,
  BILLING_PERIODS,
  PLAN_BOARD_SMALL_MEDIUM,
  PLAN_BOARD_MEDIUM_LARGE,
  getPrice,
  getPlanTier,
  getBillingPeriod,
  getAppleProductId,
  isAvailableViaIAP,
} from '../constants/subscriptionPlans';
import type { PlanTierId, BillingPeriodId } from '../constants/subscriptionPlans';
import { canAccessVesselManagement } from '../utils/access';
import {
  initIAP,
  endIAP,
  fetchIAPProducts,
  purchaseSubscription,
  restoreIAPPurchases,
  setupIAPListeners,
  verifyAndActivateIAPPurchase,
  type IAPProduct,
} from '../services/iap';

export const VesselPlansScreen = ({ navigation }: any) => {
  const themeColors = useThemeColors();
  const { user } = useAuthStore();
  const posthog = usePostHog();
  const [selectedPlanTier, setSelectedPlanTier] = useState<PlanTierId>('1_5');
  const [selectedBillingPeriod, setSelectedBillingPeriod] = useState<BillingPeriodId>('monthly');
  const [isProcessing, setIsProcessing] = useState(false);
  const [_iapProducts, setIapProducts] = useState<IAPProduct[]>([]);
  const [iapReady, setIapReady] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const cleanupListeners = useRef<(() => void) | null>(null);
  const processingTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const {
    hasActiveSubscription,
    subscription,
    refetch: refetchSubscription,
  } = useSubscriptionStatus(user?.vesselId ?? null);

  const currentPlan = subscription ? getPlanTier(subscription.planTier) : null;
  const planAvailableViaIAP = isAvailableViaIAP(selectedPlanTier, selectedBillingPeriod);

  useEffect(() => {
    posthog.capture('vessel_plans_viewed', {
      has_active_subscription: false,
      vessel_id: user?.vesselId ?? null,
    });

    if (Platform.OS !== 'ios') return;

    let mounted = true;

    const setup = async () => {
      try {
        const connected = await initIAP();
        if (!connected || !mounted) return;
        try {
          const products = await fetchIAPProducts();
          if (mounted) setIapProducts(products);
        } catch (e) {
          console.warn('[IAP] fetchIAPProducts error:', e);
        }
        if (!mounted) return;
        cleanupListeners.current = setupIAPListeners(
          async (purchase) => {
            Alert.alert('DEBUG: Listener fired', `Product: ${purchase.productId}\nTransaction: ${purchase.transactionId}\nvesselId: ${user?.vesselId ?? 'MISSING'}`);
            if (!user?.vesselId) {
              Alert.alert('DEBUG: Stopped here', 'user.vesselId was missing at this point.');
              return;
            }
            const result = await verifyAndActivateIAPPurchase(purchase, user.vesselId);
            Alert.alert('DEBUG: Verify result', JSON.stringify(result));
            if (result.success) {
              await refetchSubscription();
              Alert.alert('Success', 'Your subscription is now active. Welcome to Nautical Ops!');
            } else {
              Alert.alert('Purchase Error', result.error ?? 'Could not activate subscription. Please contact support.');
            }
            if (processingTimeout.current) clearTimeout(processingTimeout.current);
            setIsProcessing(false);
          },
          (error) => {
            Alert.alert('DEBUG: Error listener fired', JSON.stringify(error));
            if (processingTimeout.current) clearTimeout(processingTimeout.current);
            if ((error as any).code !== 'E_USER_CANCELLED') {
              Alert.alert('Purchase Failed', 'Something went wrong. Please try again.');
            }
            setIsProcessing(false);
          }
        );
        if (mounted) setIapReady(true);
      } catch (e) {
        console.warn('[IAP] setup error:', e);
        if (mounted) setIapReady(true);
      }
    };
    setup();

    return () => {
      mounted = false;
      cleanupListeners.current?.();
      endIAP();
    };
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (!canAccessVesselManagement(user)) {
        navigation.goBack();
        return;
      }
      refetchSubscription();
    }, [user, navigation, refetchSubscription])
  );

  const handleApplePurchase = async () => {
    if (!iapReady) {
      Alert.alert('Store Unavailable', 'Please try again in a moment.');
      return;
    }
    const productId = getAppleProductId(selectedPlanTier, selectedBillingPeriod);
    if (!productId) {
      Alert.alert('Unavailable', 'This plan is not available for purchase at this time.');
      return;
    }
    Alert.alert('DEBUG: Requesting purchase', `productId: ${productId}`);
    setIsProcessing(true);
    processingTimeout.current = setTimeout(() => {
      setIsProcessing(false);
      Alert.alert('Timed Out', 'The purchase request took too long. Please try again.');
    }, 45000);
    try {
      const result = await purchaseSubscription(productId);
      Alert.alert('DEBUG: requestPurchase resolved', `Raw result:\n${JSON.stringify(result, null, 2).slice(0, 600)}`);
      const candidate: any = Array.isArray(result) ? result[0] : result;
      if (candidate && candidate.transactionReceipt && user?.vesselId) {
        if (processingTimeout.current) clearTimeout(processingTimeout.current);
        const verifyResult = await verifyAndActivateIAPPurchase(candidate, user.vesselId);
        Alert.alert('DEBUG: Verify result (direct path)', JSON.stringify(verifyResult));
        if (verifyResult.success) {
          await refetchSubscription();
          Alert.alert('Success', 'Your subscription is now active. Welcome to Nautical Ops!');
        } else {
          Alert.alert('Purchase Error', verifyResult.error ?? 'Could not activate subscription. Please contact support.');
        }
        setIsProcessing(false);
      } else {
        Alert.alert('DEBUG: No usable purchase in result', 'Falling back to waiting on the purchase listener.');
      }
    } catch (err) {
      Alert.alert('DEBUG: requestPurchase THREW', err instanceof Error ? `${err.name}: ${err.message}` : JSON.stringify(err));
      if (processingTimeout.current) clearTimeout(processingTimeout.current);
      setIsProcessing(false);
    }
  };

  const handleRestorePurchases = async () => {
    setIsRestoring(true);
    try {
      await restoreIAPPurchases();
      await refetchSubscription();
      Alert.alert('Restore Complete', 'Your purchases have been restored.');
    } catch {
      Alert.alert('Restore Failed', 'Could not restore purchases. Please try again.');
    } finally {
      setIsRestoring(false);
    }
  };

  const renderBillingRow = (bp: (typeof BILLING_PERIODS)[number]) => {
    const isSelected = selectedBillingPeriod === bp.id;
    return (
      <TouchableOpacity
        key={bp.id}
        style={[
          styles.billingRow,
          {
            backgroundColor: themeColors.surface,
            borderColor: isSelected
              ? COLORS.primary
              : themeColors.isDark
                ? 'rgba(255,255,255,0.1)'
                : COLORS.border,
            borderWidth: isSelected ? 2 : 1,
          },
        ]}
        onPress={() => setSelectedBillingPeriod(bp.id)}
        activeOpacity={0.7}
      >
        <Text style={[styles.billingRowLabel, { color: themeColors.textPrimary }]}>{bp.label}</Text>
        {bp.discountPercent > 0 && (
          <View style={styles.discountPill}>
            <Text style={styles.discountPillText}>{bp.discountPercent}% OFF</Text>
          </View>
        )}
        <View
          style={[
            styles.radioOuter,
            { borderColor: isSelected ? COLORS.primary : themeColors.textSecondary },
          ]}
        >
          {isSelected && <View style={styles.radioInner} />}
        </View>
      </TouchableOpacity>
    );
  };

  const renderPlanCard = (planId: PlanTierId) => {
    const plan = PLAN_TIERS.find((p) => p.id === planId);
    if (!plan) return null;
    const price = getPrice(planId, selectedBillingPeriod);
    const isSelected = selectedPlanTier === planId;
    const available = isAvailableViaIAP(planId, selectedBillingPeriod);
    return (
      <TouchableOpacity
        key={planId}
        style={[
          styles.planCard,
          {
            backgroundColor: isSelected
              ? themeColors.isDark
                ? 'rgba(30,58,138,0.35)'
                : 'rgba(30,58,138,0.06)'
              : themeColors.surface,
            borderColor: isSelected
              ? COLORS.primary
              : themeColors.isDark
                ? 'rgba(255,255,255,0.1)'
                : COLORS.border,
            borderWidth: isSelected ? 2 : 1,
            opacity: available ? 1 : 0.5,
          },
        ]}
        onPress={() => {
          if (!available) {
            Alert.alert('Not Available', 'This plan is not available for the selected billing period.');
            return;
          }
          setSelectedPlanTier(planId);
        }}
        activeOpacity={0.7}
      >
        <Text style={[styles.planCrewRange, { color: themeColors.textSecondary }]}>
          {plan.label}
        </Text>
        <View style={styles.planBottomRow}>
          <View>
            {available ? (
              <>
                <Text style={[styles.planPrice, { color: themeColors.textPrimary }]}>
                  {price.displayMonthly}
                </Text>
                {price.savingsPercent > 0 && (
                  <Text style={[styles.planTotal, { color: themeColors.textSecondary }]}>
                    {price.displayTotal} total
                  </Text>
                )}
              </>
            ) : (
              <Text style={[styles.planPrice, { color: themeColors.textSecondary, fontSize: FONTS.sm }]}>
                Not available for this period
              </Text>
            )}
          </View>
          <View
            style={[
              styles.radioOuter,
              { borderColor: isSelected ? COLORS.primary : themeColors.textSecondary },
            ]}
          >
            {isSelected && <View style={styles.radioInner} />}
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  const renderBoard = (title: string, planIds: PlanTierId[]) => (
    <View
      key={title}
      style={[
        styles.boardCard,
        {
          backgroundColor: themeColors.surface,
          borderColor: themeColors.isDark ? 'rgba(255,255,255,0.1)' : COLORS.border,
        },
      ]}
    >
      <Text style={[styles.boardTitle, { color: themeColors.textPrimary }]}>{title}</Text>
      <Text style={[styles.boardSubtitle, { color: themeColors.textSecondary }]}>
        All plans include full access to Nautical Ops. Select the tier that fits your crew size.
      </Text>
      <View style={styles.planCardList}>{planIds.map(renderPlanCard)}</View>
    </View>
  );

  return (
    <View style={[styles.container, { backgroundColor: themeColors.background }]}>
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="chevron-back" size={28} color={themeColors.textPrimary} />
        </TouchableOpacity>

        <Text style={[styles.title, { color: themeColors.textPrimary }]}>Vessel Plans</Text>
        <Text style={[styles.subtitle, { color: themeColors.textSecondary }]}>
          Select a billing period and crew tier for your vessel
        </Text>

        {hasActiveSubscription ? (
          <View
            style={[
              styles.activeCard,
              {
                backgroundColor: themeColors.surface,
                borderColor: themeColors.isDark ? 'rgba(255,255,255,0.1)' : COLORS.border,
              },
            ]}
          >
            <Text style={[styles.currentPlanLabel, { color: themeColors.textSecondary }]}>
              Current Plan
            </Text>
            <Text style={[styles.currentPlanValue, { color: themeColors.textPrimary }]}>
              {subscription
                ? `${currentPlan?.label ?? subscription.planTier} · ${getBillingPeriod(subscription.billingPeriod)?.label ?? subscription.billingPeriod}`
                : 'Active'}
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
            <Button
              title="Manage Subscription"
              onPress={() => Linking.openURL('https://apps.apple.com/account/subscriptions')}
              variant="outline"
              fullWidth
              style={styles.manageButton}
            />
          </View>
        ) : (
          <>
            <Text style={[styles.sectionLabel, { color: themeColors.textSecondary }]}>
              BILLING PERIOD
            </Text>
            <View style={styles.billingList}>
              {BILLING_PERIODS.map(renderBillingRow)}
            </View>

            <Text style={[styles.sectionLabel, { color: themeColors.textSecondary }]}>
              CREW SIZE
            </Text>
            {renderBoard('Small to Medium Vessels', PLAN_BOARD_SMALL_MEDIUM)}
            {renderBoard('Medium to Large Vessels', PLAN_BOARD_MEDIUM_LARGE)}

            <View style={styles.actions}>
              <Button
                title={isProcessing ? 'Processing...' : !iapReady ? 'Loading Plans...' : 'Subscribe Now'}
                onPress={handleApplePurchase}
                disabled={isProcessing || !iapReady || !planAvailableViaIAP}
                loading={isProcessing}
                variant="primary"
                fullWidth
              />
            </View>

            <TouchableOpacity
              onPress={handleRestorePurchases}
              disabled={isRestoring}
              style={styles.restoreButton}
            >
              {isRestoring ? (
                <ActivityIndicator size="small" color={COLORS.primary} />
              ) : (
                <Text style={[styles.restoreText, { color: COLORS.primary }]}>
                  Restore Purchases
                </Text>
              )}
            </TouchableOpacity>

            <Text style={[styles.cancellationText, { color: themeColors.textSecondary }]}>
              Payment will be charged to your Apple ID account at confirmation of purchase. Your
              subscription automatically renews unless auto-renew is turned off at least 24 hours
              before the end of the current period. Your account will be charged for renewal
              within 24 hours prior to the end of the current period, at the price of the selected
              plan. You can manage your subscription and turn off auto-renewal at any time in your
              Apple ID Account Settings.
            </Text>
            <View style={styles.legalLinksRow}>
              <TouchableOpacity onPress={() => navigation.navigate('PrivacyPolicy')}>
                <Text style={[styles.legalLinkText, { color: COLORS.primary }]}>Privacy Policy</Text>
              </TouchableOpacity>
              <Text style={[styles.legalLinkDivider, { color: themeColors.textSecondary }]}> · </Text>
              <TouchableOpacity onPress={() => Linking.openURL('https://www.apple.com/legal/internet-services/itunes/dev/stdeula/')}>
                <Text style={[styles.legalLinkText, { color: COLORS.primary }]}>Terms of Use (EULA)</Text>
              </TouchableOpacity>
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  legalLinksRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: SPACING.sm,
    marginBottom: SPACING.lg,
  },
  legalLinkText: {
    fontSize: FONTS.sm,
    fontWeight: '500',
  },
  legalLinkDivider: {
    fontSize: FONTS.sm,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: SPACING.xl,
    paddingTop: 56,
    paddingBottom: (SIZES as any).bottomScrollPadding ?? 48,
  },
  backButton: {
    position: 'absolute',
    top: 56,
    left: SPACING.lg,
    zIndex: 10,
  },
  title: {
    fontSize: FONTS['2xl'],
    fontWeight: '700',
    textAlign: 'center',
    marginTop: 48,
    marginBottom: SPACING.xs,
    letterSpacing: -0.3,
  },
  subtitle: {
    fontSize: FONTS.sm,
    textAlign: 'center',
    marginBottom: SPACING.xl,
  },
  activeCard: {
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.xl,
    borderWidth: 1,
    marginBottom: SPACING.lg,
  },
  currentPlanLabel: {
    fontSize: FONTS.sm,
    fontWeight: '600',
    marginBottom: SPACING.xs,
  },
  currentPlanValue: {
    fontSize: FONTS.lg,
    fontWeight: '700',
    marginBottom: SPACING.xs,
  },
  renewalText: {
    fontSize: FONTS.sm,
    marginBottom: SPACING.md,
  },
  manageButton: {
    marginTop: SPACING.sm,
  },
  sectionLabel: {
    fontSize: FONTS.xs,
    fontWeight: '700',
    letterSpacing: 0.8,
    marginBottom: SPACING.sm,
  },
  billingList: {
    gap: SPACING.sm,
    marginBottom: SPACING.xl,
  },
  billingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
  },
  billingRowLabel: {
    fontSize: FONTS.base,
    fontWeight: '600',
    flex: 1,
  },
  discountPill: {
    backgroundColor: COLORS.success,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 2,
    borderRadius: BORDER_RADIUS.sm,
    marginRight: SPACING.sm,
  },
  discountPillText: {
    color: COLORS.white,
    fontSize: FONTS.xs,
    fontWeight: '700',
  },
  radioOuter: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: COLORS.primary,
  },
  boardCard: {
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.lg,
    marginBottom: SPACING.xl,
    borderWidth: 1,
  },
  boardTitle: {
    fontSize: FONTS.lg,
    fontWeight: '700',
    marginBottom: SPACING.xs,
  },
  boardSubtitle: {
    fontSize: FONTS.sm,
    lineHeight: 20,
    marginBottom: SPACING.md,
  },
  planCardList: {
    gap: SPACING.sm,
  },
  planCard: {
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.md,
  },
  planCrewRange: {
    fontSize: FONTS.xs,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: SPACING.xs,
  },
  planBottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  planPrice: {
    fontSize: FONTS.lg,
    fontWeight: '700',
  },
  planTotal: {
    fontSize: FONTS.xs,
    marginTop: 2,
  },
  actions: {
    marginBottom: SPACING.lg,
    gap: SPACING.sm,
  },
  restoreButton: {
    alignItems: 'center',
    paddingVertical: SPACING.md,
    marginBottom: SPACING.md,
  },
  restoreText: {
    fontSize: FONTS.sm,
    fontWeight: '600',
  },
  cancellationText: {
    fontSize: FONTS.xs,
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: SPACING.xl,
    opacity: 0.7,
  },
});
