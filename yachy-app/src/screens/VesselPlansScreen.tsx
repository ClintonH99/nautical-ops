/**
 * Vessel Plans Screen
 * Subscription plan selection — respects Day/Night theme.
 */

import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  Linking,
  Platform,
} from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SIZES } from '../constants/theme';
import { useThemeColors } from '../hooks/useThemeColors';
import { useAuthStore } from '../store';
import { useSubscriptionStatus } from '../hooks/useSubscriptionStatus';
import { Button } from '../components';
import { createPaddleCheckout, purchaseWithRevenueCat } from '../services/subscription';
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

export const VesselPlansScreen = ({ navigation }: any) => {
  const themeColors = useThemeColors();
  const { user } = useAuthStore();
  const [selectedPlanTier, setSelectedPlanTier] = useState<PlanTierId>('1_5');
  const [selectedBillingPeriod, setSelectedBillingPeriod] = useState<BillingPeriodId>('monthly');
  const [isProcessing, setIsProcessing] = useState(false);

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
    setIsProcessing(true);
    try {
      const { url, errorMessage } = await createPaddleCheckout(
        user.vesselId,
        selectedPlanTier,
        selectedBillingPeriod
      );
      if (!url) {
        Alert.alert(
          'Checkout unavailable',
          errorMessage ?? 'Could not start card checkout. Please try again or contact support.'
        );
        return;
      }

      if (Platform.OS === 'web') {
        const opened =
          typeof window !== 'undefined' && window.open(url, '_blank', 'noopener,noreferrer');
        if (!opened) {
          Alert.alert(
            'Popup blocked',
            'Allow popups for this site to open checkout, or open the payment page in a new tab.'
          );
          return;
        }
      } else {
        await WebBrowser.openBrowserAsync(url, {
          enableBarCollapsing: true,
          presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET,
        });
      }

      await refetchSubscription();
    } catch {
      Alert.alert('Error', 'Failed to open checkout. Please try again.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSubscribeInApp = async () => {
    if (Platform.OS === 'web') {
      Alert.alert(
        'Not Available',
        'In-app purchases are not available on web. Use Pay with Card instead.'
      );
      return;
    }
    setIsProcessing(true);
    try {
      const success = await purchaseWithRevenueCat(selectedPlanTier, selectedBillingPeriod);
      if (success) {
        await refetchSubscription();
        Alert.alert('Subscribed!', 'Your subscription is now active.');
      }
    } catch {
      Alert.alert('Purchase Failed', 'Could not complete the purchase. Please try again.');
    } finally {
      setIsProcessing(false);
    }
  };

  // ─── Billing period row ────────────────────────────────────────────────────
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
            {
              borderColor: isSelected ? COLORS.primary : themeColors.textSecondary,
            },
          ]}
        >
          {isSelected && <View style={styles.radioInner} />}
        </View>
      </TouchableOpacity>
    );
  };

  // ─── Plan tier card ────────────────────────────────────────────────────────
  const renderPlanCard = (planId: PlanTierId) => {
    const plan = PLAN_TIERS.find((p) => p.id === planId);
    if (!plan) return null;
    const price = getPrice(planId, selectedBillingPeriod);
    const isSelected = selectedPlanTier === planId;
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
          },
        ]}
        onPress={() => setSelectedPlanTier(planId)}
        activeOpacity={0.7}
      >
        {/* Line 1: crew range */}
        <Text style={[styles.planCrewRange, { color: themeColors.textSecondary }]}>
          {plan.label}
        </Text>

        {/* Line 2: price left — title + radio right */}
        <View style={styles.planBottomRow}>
          <View>
            <Text style={[styles.planPrice, { color: themeColors.textPrimary }]}>
              {price.displayMonthly}
            </Text>
            {price.savingsPercent > 0 && (
              <Text style={[styles.planTotal, { color: themeColors.textSecondary }]}>
                {price.displayTotal} total
              </Text>
            )}
          </View>
          <View
            style={[
              styles.radioOuter,
              {
                borderColor: isSelected ? COLORS.primary : themeColors.textSecondary,
              },
            ]}
          >
            {isSelected && <View style={styles.radioInner} />}
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  // ─── Board card ────────────────────────────────────────────────────────────
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

  // ─── Render ────────────────────────────────────────────────────────────────
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

        {/* ── Active subscription view ── */}
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
                ? `${currentPlan?.label ?? subscription.planTier} · ${
                    getBillingPeriod(subscription.billingPeriod)?.label ??
                    subscription.billingPeriod
                  }`
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
            {/* ── Payment policy warning ── */}
            <View
              style={[
                styles.warningBanner,
                {
                  backgroundColor: themeColors.surface,
                  borderColor: COLORS.warning,
                },
              ]}
            >
              <View style={styles.warningHeader}>
                <Ionicons
                  name="warning-outline"
                  size={16}
                  color={COLORS.warning}
                  style={{ marginRight: SPACING.xs }}
                />
                <Text style={[styles.warningTitle, { color: COLORS.warning }]}>Payment Policy</Text>
              </View>
              <Text style={[styles.warningText, { color: themeColors.textSecondary }]}>
                If payment is not made by the due date, access for all crew members will be
                restricted until payment is completed. Access resumes immediately once payment is
                made.
              </Text>
            </View>

            {/* ── Billing period selector ── */}
            <Text style={[styles.sectionLabel, { color: themeColors.textSecondary }]}>
              BILLING PERIOD
            </Text>
            <View style={styles.billingList}>{BILLING_PERIODS.map(renderBillingRow)}</View>

            {/* ── Plan boards ── */}
            {renderBoard('Small to Medium Vessels', PLAN_BOARD_SMALL_MEDIUM)}
            {renderBoard('Medium to Large Vessels', PLAN_BOARD_MEDIUM_LARGE)}

            {/* ── Action buttons ── */}
            <View style={styles.actions}>
              <Button
                title={isProcessing ? 'Opening...' : 'Pay with Card'}
                onPress={handlePayWithCard}
                variant="primary"
                fullWidth
                style={styles.actionButton}
                disabled={isProcessing}
              />
              <Button
                title={isProcessing ? 'Processing...' : 'Subscribe via App Store'}
                onPress={handleSubscribeInApp}
                variant="outline"
                fullWidth
                style={styles.actionButton}
                disabled={isProcessing}
              />
            </View>

            {/* ── Cancellation note ── */}
            <View
              style={[
                styles.cancellationNote,
                {
                  backgroundColor: themeColors.surface,
                  borderColor: themeColors.isDark ? 'rgba(255,255,255,0.1)' : COLORS.border,
                },
              ]}
            >
              <Text style={[styles.cancellationText, { color: themeColors.textSecondary }]}>
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
  container: { flex: 1 },
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

  // Active plan card
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

  // Payment warning banner
  warningBanner: {
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.md,
    borderWidth: 1.5,
    marginBottom: SPACING.xl,
  },
  warningHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: SPACING.xs,
  },
  warningTitle: {
    fontSize: FONTS.sm,
    fontWeight: '700',
  },
  warningText: {
    fontSize: FONTS.sm,
    lineHeight: 20,
  },

  // Section label
  sectionLabel: {
    fontSize: FONTS.xs,
    fontWeight: '700',
    letterSpacing: 0.8,
    marginBottom: SPACING.sm,
  },

  // Billing period rows
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

  // Radio button
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

  // Board card
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

  // Plan tier cards
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

  // Action buttons
  actions: {
    marginBottom: SPACING.lg,
    gap: SPACING.sm,
  },
  actionButton: {
    marginBottom: SPACING.sm,
  },

  // Cancellation note
  cancellationNote: {
    padding: SPACING.lg,
    borderRadius: BORDER_RADIUS.lg,
    borderWidth: 1,
    marginBottom: SPACING.lg,
  },
  cancellationText: {
    fontSize: FONTS.sm,
    textAlign: 'center',
    lineHeight: 20,
  },
});
