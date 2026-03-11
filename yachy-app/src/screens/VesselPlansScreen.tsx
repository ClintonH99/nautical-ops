/**
 * Vessel Plans Screen
 * Dedicated page for subscription plans under Vessel Management.
 * Matches Captain/Crew create account board theme.
 */

import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  StatusBar,
  Linking,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONTS, SPACING, BORDER_RADIUS } from '../constants/theme';
import { useAuthStore } from '../store';
import { useSubscriptionStatus } from '../hooks/useSubscriptionStatus';
import { Button } from '../components';
import { createStripeCheckout } from '../services/subscription';
import {
  PLAN_TIERS,
  BILLING_PERIODS,
  PLAN_BOARD_SMALL_MEDIUM,
  PLAN_BOARD_MEDIUM_LARGE,
  getPrice,
  getPlanTier,
  getBillingPeriod,
} from '../constants/subscriptionPlans';
import type { PlanTierId, BillingPeriodId } from '../constants/subscriptionPlans';

const MARITIME = {
  bgDark: '#0f172a',
  textOnDark: '#f8fafc',
  textMuted: '#94a3b8',
  formCardBg: 'rgba(255, 255, 255, 0.95)',
  formCardBorder: 'rgba(255, 255, 255, 0.4)',
  infoBg: 'rgba(14, 165, 233, 0.12)',
  infoBorder: 'rgba(14, 165, 233, 0.3)',
  gold: '#c9a227',
};

const BOARD_DESCRIPTION =
  'All plans include full access to Nautical Ops. The only difference is the maximum number of crew members you can add to your vessel. To add more crew, upgrade to the plan that best suits your operational needs.';

export const VesselPlansScreen = ({ navigation }: any) => {
  const { user } = useAuthStore();
  const [selectedPlanTier, setSelectedPlanTier] = useState<PlanTierId>('1_5');
  const [selectedBillingPeriod, setSelectedBillingPeriod] = useState<BillingPeriodId>('monthly');
  const [isStartingCheckout, setIsStartingCheckout] = useState(false);

  const {
    hasActiveSubscription,
    subscription,
    refetch: refetchSubscription,
  } = useSubscriptionStatus(user?.vesselId ?? null);
  const currentPlan = subscription ? getPlanTier(subscription.planTier) : null;

  useFocusEffect(
    useCallback(() => {
      refetchSubscription();
    }, [refetchSubscription])
  );

  const handlePayWithCard = async () => {
    if (!user?.vesselId) return;
    setIsStartingCheckout(true);
    try {
      const successUrl = 'nauticalops://subscription-success';
      const cancelUrl = 'nauticalops://subscription-cancel';
      const url = await createStripeCheckout(
        user.vesselId,
        selectedPlanTier,
        selectedBillingPeriod,
        successUrl,
        cancelUrl
      );
      if (url) {
        await Linking.openURL(url);
      } else {
        Alert.alert(
          'Payment Unavailable',
          'Stripe checkout is not configured yet. Please use Subscribe in App or contact support.'
        );
      }
    } catch (error) {
      Alert.alert('Error', 'Failed to start checkout');
    } finally {
      setIsStartingCheckout(false);
    }
  };

  const handleSubscribeInApp = () => {
    Alert.alert(
      'Coming Soon',
      'In-app subscription via App Store / Play Store will be available soon. Use Pay with Card for now.'
    );
  };

  const renderPlanCard = (planId: PlanTierId) => {
    const plan = PLAN_TIERS.find((p) => p.id === planId);
    if (!plan) return null;
    const price = getPrice(planId, selectedBillingPeriod);
    const isSelected = selectedPlanTier === planId;
    return (
      <TouchableOpacity
        key={planId}
        style={[
          styles.planOption,
          {
            backgroundColor: isSelected ? 'rgba(14, 165, 233, 0.08)' : 'rgba(248, 250, 252, 0.9)',
            borderColor: isSelected ? COLORS.primary : MARITIME.formCardBorder,
          },
        ]}
        onPress={() => setSelectedPlanTier(planId)}
      >
        <Text style={[styles.planOptionLabel, { color: COLORS.textPrimary }]}>{plan.label}</Text>
        <Text style={[styles.planOptionPrice, { color: COLORS.textPrimary }]}>
          {price.displayMonthly}
        </Text>
        {price.savingsPercent > 0 && (
          <Text style={[styles.planOptionTotal, { color: COLORS.textSecondary }]}>
            {price.displayTotal} total
          </Text>
        )}
      </TouchableOpacity>
    );
  };

  const renderBoard = (title: string, planIds: PlanTierId[]) => (
    <View
      style={[
        styles.boardCard,
        { backgroundColor: MARITIME.formCardBg, borderColor: MARITIME.formCardBorder },
      ]}
    >
      <Text style={[styles.boardTitle, { color: COLORS.textPrimary }]}>{title}</Text>
      <View
        style={[
          styles.boardDescription,
          { backgroundColor: MARITIME.infoBg, borderColor: MARITIME.infoBorder },
        ]}
      >
        <Text style={[styles.boardDescriptionText, { color: COLORS.textPrimary }]}>
          {BOARD_DESCRIPTION}
        </Text>
      </View>
      <View style={styles.planOptionsList}>{planIds.map(renderPlanCard)}</View>
    </View>
  );

  return (
    <View style={[styles.container, { backgroundColor: MARITIME.bgDark }]}>
      <StatusBar barStyle="light-content" backgroundColor={MARITIME.bgDark} />
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="chevron-back" size={28} color={MARITIME.textOnDark} />
        </TouchableOpacity>

        <Text style={styles.title}>Vessel Plans</Text>
        <Text style={styles.subtitle}>Select a plan and payment option to invite crew</Text>

        {hasActiveSubscription ? (
          <View
            style={[
              styles.formCard,
              { backgroundColor: MARITIME.formCardBg, borderColor: MARITIME.formCardBorder },
            ]}
          >
            <Text style={[styles.currentPlanLabel, { color: COLORS.textPrimary }]}>
              Current Plan
            </Text>
            <Text style={[styles.currentPlanValue, { color: COLORS.textPrimary }]}>
              {subscription
                ? `${currentPlan?.label ?? subscription.planTier} • ${getBillingPeriod(subscription.billingPeriod)?.label ?? subscription.billingPeriod}`
                : 'Active (via App Store)'}
            </Text>
            {subscription && (
              <Text style={[styles.renewalText, { color: COLORS.textSecondary }]}>
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
              onPress={() => Linking.openURL('https://nautical-ops.com/account')}
              variant="outline"
              fullWidth
              style={styles.manageButton}
            />
          </View>
        ) : (
          <>
            <View
              style={[
                styles.infoBanner,
                { backgroundColor: MARITIME.infoBg, borderColor: MARITIME.infoBorder },
              ]}
            >
              <Text style={styles.infoBannerText}>
                Choose a billing period and select a plan tier for your vessel size. All plans
                include full access to Nautical Ops.
              </Text>
            </View>

            <View style={styles.billingRow}>
              {BILLING_PERIODS.map((bp) => (
                <TouchableOpacity
                  key={bp.id}
                  style={[
                    styles.billingChip,
                    { backgroundColor: MARITIME.formCardBg, borderColor: MARITIME.formCardBorder },
                    selectedBillingPeriod === bp.id && {
                      backgroundColor: COLORS.primary,
                      borderColor: COLORS.primary,
                    },
                  ]}
                  onPress={() => setSelectedBillingPeriod(bp.id)}
                >
                  <Text
                    style={[
                      styles.billingChipText,
                      {
                        color: selectedBillingPeriod === bp.id ? COLORS.white : COLORS.textPrimary,
                      },
                    ]}
                  >
                    {bp.label}
                  </Text>
                  {bp.discountPercent > 0 && (
                    <Text
                      style={[
                        styles.billingChipDiscount,
                        {
                          color:
                            selectedBillingPeriod === bp.id
                              ? 'rgba(255,255,255,0.9)'
                              : COLORS.success,
                        },
                      ]}
                    >
                      {bp.discountPercent}% off
                    </Text>
                  )}
                </TouchableOpacity>
              ))}
            </View>

            {renderBoard('Small to Medium Vessels', PLAN_BOARD_SMALL_MEDIUM)}
            {renderBoard('Medium to Large Vessels', PLAN_BOARD_MEDIUM_LARGE)}

            <View style={styles.actions}>
              <Button
                title={isStartingCheckout ? 'Opening...' : 'Pay with Card'}
                onPress={handlePayWithCard}
                variant="primary"
                fullWidth
                style={styles.actionButton}
                disabled={isStartingCheckout}
              />
              <Button
                title="Subscribe in App"
                onPress={handleSubscribeInApp}
                variant="outline"
                fullWidth
                style={styles.actionButton}
              />
            </View>

            <View
              style={[
                styles.cancellationNote,
                { backgroundColor: MARITIME.infoBg, borderColor: MARITIME.infoBorder },
              ]}
            >
              <Text style={[styles.cancellationText, { color: MARITIME.textOnDark }]}>
                Subscriptions can be cancelled at any time. Access to the app will be restricted
                upon cancellation.
              </Text>
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: SPACING.xl,
    paddingTop: 56,
    paddingBottom: SPACING['2xl'],
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
    color: MARITIME.textOnDark,
    textAlign: 'center',
    marginTop: 48,
    marginBottom: SPACING.xs,
    letterSpacing: -0.3,
  },
  subtitle: {
    fontSize: FONTS.sm,
    color: MARITIME.textMuted,
    textAlign: 'center',
    marginBottom: SPACING.lg,
  },
  infoBanner: {
    backgroundColor: MARITIME.infoBg,
    borderWidth: 1,
    borderColor: MARITIME.infoBorder,
    padding: SPACING.lg,
    borderRadius: BORDER_RADIUS.lg,
    marginBottom: SPACING.xl,
  },
  infoBannerText: {
    fontSize: FONTS.sm,
    color: MARITIME.textOnDark,
    fontWeight: '500',
    textAlign: 'center',
    lineHeight: 22,
  },
  billingRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.sm,
    marginBottom: SPACING.xl,
  },
  billingChip: {
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1,
  },
  billingChipText: {
    fontSize: FONTS.sm,
    fontWeight: '600',
  },
  billingChipDiscount: {
    fontSize: FONTS.xs,
    marginTop: 2,
  },
  boardCard: {
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.xl,
    marginBottom: SPACING.xl,
    borderWidth: 1,
  },
  boardTitle: {
    fontSize: FONTS.lg,
    fontWeight: '700',
    marginBottom: SPACING.md,
  },
  boardDescription: {
    padding: SPACING.lg,
    borderRadius: BORDER_RADIUS.md,
    marginBottom: SPACING.lg,
    borderWidth: 1,
  },
  boardDescriptionText: {
    fontSize: FONTS.sm,
    fontWeight: '500',
    lineHeight: 22,
    textAlign: 'center',
  },
  planOptionsList: {
    gap: SPACING.sm,
  },
  planOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1,
  },
  planOptionLabel: {
    fontSize: FONTS.base,
    fontWeight: '500',
    flex: 1,
  },
  planOptionPrice: {
    fontSize: FONTS.base,
    fontWeight: '700',
  },
  planOptionTotal: {
    fontSize: FONTS.xs,
    marginLeft: SPACING.sm,
  },
  actions: {
    marginBottom: SPACING.lg,
    gap: SPACING.sm,
  },
  actionButton: {
    marginBottom: SPACING.sm,
  },
  currentPlanLabel: {
    fontSize: FONTS.sm,
    fontWeight: '600',
    marginBottom: SPACING.xs,
  },
  currentPlanValue: {
    fontSize: FONTS.lg,
    fontWeight: 'bold',
    marginBottom: SPACING.xs,
  },
  renewalText: {
    fontSize: FONTS.sm,
    marginBottom: SPACING.md,
  },
  manageButton: {
    marginTop: SPACING.sm,
  },
  cancellationNote: {
    padding: SPACING.lg,
    borderRadius: BORDER_RADIUS.lg,
    borderWidth: 1,
  },
  cancellationText: {
    fontSize: FONTS.sm,
    fontWeight: '500',
    textAlign: 'center',
    lineHeight: 22,
  },
});
