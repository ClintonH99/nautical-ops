import { LoadingSpinner as ActivityIndicator } from '../components/LoadingSpinner';
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
  Linking,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { usePostHog } from 'posthog-react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SIZES } from '../constants/theme';
import { useThemeColors } from '../hooks/useThemeColors';
import { useAuthStore } from '../store';
import { useSubscriptionStatus } from '../hooks/useSubscriptionStatus';
import { Button, PageHeader } from '../components';
import {
  PLAN_TIERS,
  BILLING_PERIODS,
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
  restoreAndActivateIAPPurchases,
  setupIAPListeners,
  verifyAndActivateIAPPurchase,
  type IAPProduct,
} from '../services/iap';
import type { Purchase } from 'expo-iap';

export const VesselPlansScreen = ({ navigation }: any) => {
  const themeColors = useThemeColors();
  const { user, captainPaymentRequired, setCaptainPaymentRequired } = useAuthStore();
  const posthog = usePostHog();
  const [selectedPlanTier, setSelectedPlanTier] = useState<PlanTierId>('1_5');
  const [selectedBillingPeriod, setSelectedBillingPeriod] = useState<BillingPeriodId>('monthly');
  const [isProcessing, setIsProcessing] = useState(false);
  const [iapProducts, setIapProducts] = useState<IAPProduct[]>([]);
  const [iapReady, setIapReady] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const cleanupListeners = useRef<(() => void) | null>(null);
  const processingTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const purchaseVerificationInFlight = useRef(new Map<string, Promise<boolean>>());
  const verifiedTransactionIds = useRef(new Set<string>());

  const {
    hasActiveSubscription,
    subscription,
    isLoading: subscriptionLoading,
    refetch: refetchSubscription,
  } = useSubscriptionStatus(user?.vesselId ?? null);

  const currentPlan = subscription ? getPlanTier(subscription.planTier) : null;
  const planAvailableViaIAP = isAvailableViaIAP(selectedPlanTier, selectedBillingPeriod);

  const getStorePrice = useCallback(
    (planTierId: PlanTierId, billingPeriodId: BillingPeriodId) => {
      const productId = getAppleProductId(planTierId, billingPeriodId);
      const storeProduct = productId
        ? iapProducts.find((product) => product.id === productId)
        : undefined;
      const periodSuffix: Record<BillingPeriodId, string> = {
        monthly: '/ month',
        '3_months': '/ 3 months',
        '6_months': '/ 6 months',
        '12_months': '/ year',
      };

      if (storeProduct?.displayPrice) {
        return {
          displayMonthly: `${storeProduct.displayPrice} ${periodSuffix[billingPeriodId]}`,
          displayTotal: storeProduct.displayPrice,
          savingsPercent: 0,
        };
      }

      return getPrice(planTierId, billingPeriodId);
    },
    [iapProducts]
  );

  const handleDeliveredPurchase = useCallback(
    async (purchase: Purchase): Promise<boolean> => {
      const transactionId = purchase.transactionId ?? purchase.id;
      if (!transactionId || !user?.vesselId) return false;
      if (verifiedTransactionIds.current.has(transactionId)) return true;

      const existing = purchaseVerificationInFlight.current.get(transactionId);
      if (existing) return existing;

      const verification = (async () => {
        const result = await verifyAndActivateIAPPurchase(purchase, user.vesselId!);
        if (result.success) {
          verifiedTransactionIds.current.add(transactionId);
          await refetchSubscription();
          Alert.alert('Success', 'Your subscription is now active. Welcome to Nautical Ops!');
          return true;
        }

        Alert.alert(
          'Purchase Error',
          result.error ?? 'Could not activate subscription. Please contact support.'
        );
        return false;
      })().finally(() => {
        purchaseVerificationInFlight.current.delete(transactionId);
        if (processingTimeout.current) clearTimeout(processingTimeout.current);
        setIsProcessing(false);
      });

      purchaseVerificationInFlight.current.set(transactionId, verification);
      return verification;
    },
    [refetchSubscription, user?.vesselId]
  );

  useEffect(() => {
    if (captainPaymentRequired && hasActiveSubscription) {
      setCaptainPaymentRequired(false);
    }
  }, [captainPaymentRequired, hasActiveSubscription, setCaptainPaymentRequired]);

  useEffect(() => {
    if (subscriptionLoading) return;
    posthog.capture('vessel_plans_viewed', {
      has_active_subscription: hasActiveSubscription,
      vessel_id: user?.vesselId ?? null,
    });
  }, [hasActiveSubscription, posthog, subscriptionLoading, user?.vesselId]);

  useEffect(() => {
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
          (purchase) => void handleDeliveredPurchase(purchase),
          (error) => {
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
  }, [handleDeliveredPurchase]);

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
    setIsProcessing(true);
    processingTimeout.current = setTimeout(() => {
      setIsProcessing(false);
      Alert.alert('Timed Out', 'The purchase request took too long. Please try again.');
    }, 45000);
    try {
      if (!user?.vesselId) {
        Alert.alert('Vessel Required', 'Create or join a vessel before choosing a plan.');
        setIsProcessing(false);
        return;
      }
      const result = await purchaseSubscription(productId, user.vesselId);
      const candidate: any = Array.isArray(result) ? result[0] : result;
      if (candidate && (candidate.transactionId || candidate.id) && user?.vesselId) {
        await handleDeliveredPurchase(candidate as Purchase);
      }
      // If no usable purchase in the result, fall through to let the
      // purchase listener (set up in useEffect) or the timeout handle it.
    } catch (err) {
      if (processingTimeout.current) clearTimeout(processingTimeout.current);
      setIsProcessing(false);
    }
  };

  const handleRestorePurchases = async () => {
    if (!user?.vesselId) {
      Alert.alert('Vessel Required', 'Create or join a vessel before restoring a subscription.');
      return;
    }
    setIsRestoring(true);
    try {
      const result = await restoreAndActivateIAPPurchases(user.vesselId);
      if (!result.success) {
        Alert.alert(
          'Restore Failed',
          result.error ?? 'Could not restore purchases. Please try again.'
        );
        return;
      }
      await refetchSubscription();
      Alert.alert('Restore Complete', 'Your active subscription has been restored.');
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
            borderColor: isSelected ? themeColors.accent : themeColors.border,
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
            {
              borderColor: isSelected
                ? themeColors.accent
                : themeColors.isDark
                  ? themeColors.borderStrong
                  : themeColors.textSecondary,
            },
          ]}
        >
          {isSelected && (
            <View style={[styles.radioInner, { backgroundColor: themeColors.controlSelected }]} />
          )}
        </View>
      </TouchableOpacity>
    );
  };

  const renderPlanCard = (planId: PlanTierId) => {
    const plan = PLAN_TIERS.find((p) => p.id === planId);
    if (!plan) return null;
    const price = getStorePrice(planId, selectedBillingPeriod);
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
                ? themeColors.accentSoft
                : 'rgba(30,58,138,0.06)'
              : themeColors.surface,
            borderColor: isSelected ? themeColors.accent : themeColors.border,
            borderWidth: isSelected ? 2 : 1,
            opacity: available ? 1 : 0.5,
          },
        ]}
        onPress={() => {
          if (!available) {
            Alert.alert(
              'Not Available',
              'This plan is not available for the selected billing period.'
            );
            return;
          }
          setSelectedPlanTier(planId);
        }}
        activeOpacity={0.7}
      >
        <Text style={[styles.planCrewRange, { color: themeColors.textPrimary }]}>{plan.label}</Text>
        <View style={styles.planPriceColumn}>
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
            <Text
              style={[styles.planPrice, { color: themeColors.textSecondary, fontSize: FONTS.sm }]}
            >
              Not available for this period
            </Text>
          )}
        </View>
        <View
          style={[
            styles.radioOuter,
            {
              borderColor: isSelected
                ? themeColors.accent
                : themeColors.isDark
                  ? themeColors.borderStrong
                  : themeColors.textSecondary,
            },
          ]}
        >
          {isSelected && (
            <View style={[styles.radioInner, { backgroundColor: themeColors.controlSelected }]} />
          )}
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: themeColors.background }]}>
      <PageHeader title="Vessel Plans" showBack={!captainPaymentRequired} />
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {captainPaymentRequired ? (
          <View style={styles.paymentNotice}>
            <Ionicons name="alert-circle-outline" size={22} color={COLORS.danger} />
            <Text style={styles.paymentNoticeText}>
              Your vessel subscription payment is overdue. Access to the rest of the app will be
              restored automatically after payment is confirmed.
            </Text>
          </View>
        ) : null}

        {hasActiveSubscription ? (
          <View
            style={[
              styles.activeCard,
              {
                backgroundColor: themeColors.surface,
                borderColor: themeColors.border,
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
            <View style={styles.billingList}>{BILLING_PERIODS.map(renderBillingRow)}</View>

            <Text style={[styles.sectionLabel, { color: themeColors.textSecondary }]}>
              CREW SIZE
            </Text>
            <View style={styles.planCardList}>
              {PLAN_TIERS.map((plan) => renderPlanCard(plan.id))}
            </View>

            <View style={styles.actions}>
              <Button
                title={
                  isProcessing ? 'Processing...' : !iapReady ? 'Loading Plans...' : 'Subscribe Now'
                }
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
                <ActivityIndicator size="small" color={themeColors.accent} />
              ) : (
                <Text style={[styles.restoreText, { color: themeColors.accent }]}>
                  Restore Purchases
                </Text>
              )}
            </TouchableOpacity>

            <Text style={[styles.cancellationText, { color: themeColors.textSecondary }]}>
              Payment will be charged to your Apple ID account at confirmation of purchase. Your
              subscription automatically renews unless auto-renew is turned off at least 24 hours
              before the end of the current period. Your account will be charged for renewal within
              24 hours prior to the end of the current period, at the price of the selected plan.
              You can manage your subscription and turn off auto-renewal at any time in your Apple
              ID Account Settings.
            </Text>
            <View style={styles.legalLinksRow}>
              <TouchableOpacity onPress={() => navigation.navigate('PrivacyPolicy')}>
                <Text style={[styles.legalLinkText, { color: themeColors.accent }]}>
                  Privacy Policy
                </Text>
              </TouchableOpacity>
              <Text style={[styles.legalLinkDivider, { color: themeColors.textSecondary }]}>
                {' '}
                ·{' '}
              </Text>
              <TouchableOpacity
                onPress={() =>
                  Linking.openURL(
                    'https://www.apple.com/legal/internet-services/itunes/dev/stdeula/'
                  )
                }
              >
                <Text style={[styles.legalLinkText, { color: themeColors.accent }]}>
                  Terms of Use (EULA)
                </Text>
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
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.lg,
    paddingBottom: (SIZES as any).bottomScrollPadding ?? 48,
  },
  paymentNotice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: SPACING.sm,
    padding: SPACING.md,
    marginBottom: SPACING.lg,
    borderWidth: 1,
    borderColor: COLORS.danger,
    borderRadius: BORDER_RADIUS.md,
    backgroundColor: 'rgba(220, 38, 38, 0.08)',
  },
  paymentNoticeText: {
    flex: 1,
    color: COLORS.danger,
    fontSize: FONTS.sm,
    lineHeight: 20,
    fontWeight: '600',
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
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.sm,
    marginBottom: SPACING.xl,
  },
  billingRow: {
    width: '48.5%',
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
  planCardList: {
    gap: SPACING.sm,
    marginBottom: SPACING.xl,
  },
  planCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.md,
  },
  planCrewRange: {
    flex: 1,
    fontSize: FONTS.sm,
    fontWeight: '600',
    marginRight: SPACING.sm,
  },
  planPriceColumn: { alignItems: 'flex-end', marginRight: SPACING.md },
  planPrice: {
    fontSize: FONTS.sm,
    fontWeight: '600',
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
