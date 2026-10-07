import React, { useState, useRef, useCallback } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { ScrollView, View, Text, Pressable, StyleSheet } from 'react-native';
import { PageHeader, Button } from '../components';
import { useThemeColors } from '../hooks/useThemeColors';
import { useAuthStore } from '../store';
import { canAccessVesselManagement } from '../utils/access';
import { useSubscriptionStatus } from '../hooks/useSubscriptionStatus';
import {
  paddleCheckoutEnabled,
  paddleEnvironment,
  preparePaddleCheckout,
} from '../services/paddleBilling';
import {
  PADDLE_PLAN_TIERS,
  PADDLE_BILLING_PERIODS,
  getPaddlePrice,
  type PaddlePlanTier,
  type PaddleBillingPeriod,
} from '../constants/paddlePlans';

/** Paddle web checkout. Entitlements come only from server-verified subscription state. */
export const VesselPlansScreen = () => {
  const theme = useThemeColors();
  const colors = { ...theme, text: theme.textPrimary, primary: theme.controlSelected };
  const user = useAuthStore((state) => state.user);
  const [tier, setTier] = useState<PaddlePlanTier>('1_5');
  const [period, setPeriod] = useState<PaddleBillingPeriod>('monthly');
  const permitted = canAccessVesselManagement(user) && !!user?.vesselId;
  const price = getPaddlePrice(tier, period);
  const { subscription, accessState, isLoading, refetch } = useSubscriptionStatus(
    user?.vesselId ?? null
  );
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const starting = useRef(false);
  useFocusEffect(
    useCallback(() => {
      void refetch();
    }, [refetch])
  );
  const hasExistingPlan = !!subscription;
  const startCheckout = async () => {
    if (starting.current || !permitted || !user?.vesselId || accessState !== 'never_subscribed')
      return;
    starting.current = true;
    setBusy(true);
    setNotice('');
    const vesselId = user.vesselId;
    const userId = user.id;
    try {
      const url = await preparePaddleCheckout(vesselId, tier, period, window.location.origin);
      const currentUser = useAuthStore.getState().user;
      if (currentUser?.id !== userId || currentUser.vesselId !== vesselId) return;
      window.location.assign(url);
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : 'Checkout could not start. Please try again later.'
      );
    } finally {
      starting.current = false;
      setBusy(false);
    }
  };
  return (
    <View style={[styles.page, { backgroundColor: colors.background }]}>
      <PageHeader title="Vessel Plans" />
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.content}>
          {!permitted ? (
            <Text style={[styles.copy, { color: colors.text }]}>
              Only the vessel’s Captain / MOV can manage its subscription.
            </Text>
          ) : (
            <>
              {subscription && (
                <View
                  style={[
                    styles.plan,
                    { backgroundColor: colors.surface, borderColor: colors.border },
                  ]}
                >
                  <View style={styles.planDetails}>
                    <Text style={[styles.label, { color: colors.textSecondary }]}>
                      CURRENT PLAN
                    </Text>
                    <Text style={[styles.planTitle, { color: colors.text }]}>
                      {PADDLE_PLAN_TIERS.find((item) => item.id === subscription.planTier)?.label ??
                        subscription.planTier}
                      {' · '}
                      {PADDLE_BILLING_PERIODS.find((item) => item.id === subscription.billingPeriod)
                        ?.label ?? subscription.billingPeriod}
                    </Text>
                    <Text style={[styles.copy, { color: colors.textSecondary }]}>
                      {subscription.status === 'canceled'
                        ? 'Renewal cancelled. Access ends '
                        : subscription.status === 'trialing'
                          ? 'Trial ends '
                          : 'Current period ends '}
                      {new Date(subscription.currentPeriodEnd).toLocaleDateString()}
                    </Text>
                  </View>
                </View>
              )}
              {accessState === 'unavailable' && (
                <Text
                  accessibilityRole="alert"
                  style={[styles.copy, { color: colors.textSecondary }]}
                >
                  Your subscription status could not be confirmed. Checkout is paused to prevent a
                  duplicate subscription.
                </Text>
              )}
              {!!notice && (
                <Text accessibilityRole="alert" style={[styles.copy, { color: colors.text }]}>
                  {notice}
                </Text>
              )}
              <Text style={[styles.heading, { color: colors.text }]}>Choose your vessel plan</Text>
              <Text style={[styles.copy, { color: colors.textSecondary }]}>
                Choose your billing period and crew size. Prices are in USD for the full selected
                period, including applicable tax. New subscriptions include a 30-day free trial.
              </Text>
              <Text style={[styles.label, { color: colors.textSecondary }]}>BILLING PERIOD</Text>
              <View style={styles.periods}>
                {PADDLE_BILLING_PERIODS.map((option) => (
                  <Pressable
                    key={option.id}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: period === option.id }}
                    disabled={busy}
                    onPress={() => setPeriod(option.id)}
                    style={[
                      styles.period,
                      {
                        backgroundColor: period === option.id ? colors.primary : colors.surface,
                        borderColor: colors.border,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.periodText,
                        { color: period === option.id ? colors.textOnAccent : colors.text },
                      ]}
                    >
                      {option.label}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <Text style={[styles.label, { color: colors.textSecondary }]}>CREW SIZE</Text>
              {PADDLE_PLAN_TIERS.map((option) => {
                const quote = getPaddlePrice(option.id, period);
                return (
                  <Pressable
                    key={option.id}
                    disabled={busy}
                    onPress={() => setTier(option.id)}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: tier === option.id }}
                    accessibilityLabel={`${option.label}, ${quote.displayTotal} USD ${quote.suffix}`}
                    style={[
                      styles.plan,
                      {
                        backgroundColor: colors.surface,
                        borderColor: tier === option.id ? colors.primary : colors.border,
                      },
                    ]}
                  >
                    <View style={styles.planDetails}>
                      <Text style={[styles.planTitle, { color: colors.text }]}>{option.label}</Text>
                      <Text style={[styles.copy, { color: colors.textSecondary }]}>
                        {quote.displayTotal} {quote.suffix}
                      </Text>
                    </View>
                    <View
                      style={[
                        styles.radio,
                        { borderColor: tier === option.id ? colors.primary : colors.textSecondary },
                      ]}
                    >
                      {tier === option.id && (
                        <View style={[styles.dot, { backgroundColor: colors.primary }]} />
                      )}
                    </View>
                  </Pressable>
                );
              })}
              <Text style={[styles.heading, { color: colors.text }]}>
                {price.displayTotal} {price.suffix}
              </Text>
              <Text style={[styles.copy, { color: colors.textSecondary }]}>
                {paddleCheckoutEnabled
                  ? 'Review your trial, renewal date and billing details in secure Paddle checkout before confirming. Your plan renews automatically until cancelled.'
                  : 'Paddle checkout is being configured. No payment can be taken yet.'}
              </Text>
              {paddleCheckoutEnabled && paddleEnvironment === 'sandbox' && (
                <Text style={[styles.copy, { color: colors.text }]}>
                  Sandbox test — no real payment.
                </Text>
              )}
              {hasExistingPlan && (
                <Text style={[styles.copy, { color: colors.textSecondary }]}>
                  You already have a subscription record. Subscription management is being
                  connected; do not create another subscription.
                </Text>
              )}
              <Button
                title={
                  !paddleCheckoutEnabled
                    ? 'Payments not yet available'
                    : busy
                      ? 'Preparing Checkout…'
                      : 'Continue to Secure Checkout'
                }
                onPress={startCheckout}
                disabled={
                  !paddleCheckoutEnabled || busy || isLoading || accessState !== 'never_subscribed'
                }
              />
              <Button
                title="Refresh Plan Status"
                variant="outline"
                onPress={() => {
                  void refetch();
                }}
                disabled={busy || isLoading}
              />
            </>
          )}
        </View>
      </ScrollView>
    </View>
  );
};
const styles = StyleSheet.create({
  page: { flex: 1 },
  scroll: { padding: 20, paddingBottom: 40 },
  content: { width: '100%', maxWidth: 680, alignSelf: 'center', gap: 14 },
  heading: { fontSize: 24, fontWeight: '700' },
  copy: { fontSize: 16, lineHeight: 24 },
  label: { fontSize: 13, fontWeight: '700', marginTop: 12, letterSpacing: 1 },
  periods: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  period: {
    flexGrow: 1,
    flexBasis: '45%',
    minHeight: 52,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    padding: 12,
  },
  periodText: { fontSize: 17, fontWeight: '600' },
  plan: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 18,
    gap: 12,
    borderWidth: 2,
    borderRadius: 16,
  },
  planDetails: { flex: 1 },
  planTitle: { fontSize: 18, fontWeight: '600' },
  radio: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: { width: 14, height: 14, borderRadius: 7 },
});
