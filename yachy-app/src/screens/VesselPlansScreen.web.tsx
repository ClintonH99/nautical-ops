import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  ScrollView,
  View,
  Text,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  Image,
} from 'react-native';
import { PageHeader, Button } from '../components';
import { BillingCountryPicker, billingCountryName } from '../components/BillingCountryPicker.web';
import { useThemeColors } from '../hooks/useThemeColors';
import { useAuthStore } from '../store';
import { canAccessVesselManagement } from '../utils/access';
import { useSubscriptionStatus } from '../hooks/useSubscriptionStatus';
import {
  paddleCheckoutEnabled,
  paddleEnvironment,
  preparePaddleCheckout,
  paddleBillingEnabled,
  startPaddleTrial,
  preparePaddleTrialPayment,
  preparePaddlePaymentRecovery,
  paddleManagementEnabled,
  getPaddleManagementStatus,
  preparePaddlePaymentMethod,
  cancelPaddleRenewal,
  keepPaddleSubscription,
  type PaddleManagementStatus,
} from '../services/paddleBilling';
import {
  previewPaddlePrices,
  usd,
  type BillingLocation,
  type PaddlePricePreview,
} from '../services/paddlePricing';
import {
  PADDLE_PLAN_TIERS,
  PADDLE_BILLING_PERIODS,
  getPaddlePrice,
  type PaddlePlanTier,
  type PaddleBillingPeriod,
} from '../constants/paddlePlans';

/** Provider-calculated totals are previews, never an entitlement or a charge. */
export const VesselPlansScreen = () => {
  const navigation = useNavigation<NativeStackNavigationProp<{ MainTabs: { screen: 'Home' } }>>();
  const theme = useThemeColors();
  const { width } = useWindowDimensions();
  const wide = width >= 1000;
  const user = useAuthStore((state) => state.user);
  const permitted = canAccessVesselManagement(user) && !!user?.vesselId;
  const { subscription, accessState, isLoading, refetch } = useSubscriptionStatus(
    user?.vesselId ?? null
  );
  const [tier, setTier] = useState<PaddlePlanTier>('1_5');
  const [period, setPeriod] = useState<PaddleBillingPeriod>('monthly');
  const [location, setLocation] = useState<BillingLocation | null>(null);
  const [picker, setPicker] = useState(false);
  const [preview, setPreview] = useState<PaddlePricePreview | null>(null);
  const [previewOwner, setPreviewOwner] = useState('');
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [retry, setRetry] = useState(0);
  const [review, setReview] = useState(false);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const owner = `${user?.id}:${user?.vesselId}`;
  const [pendingOwner, setPendingOwner] = useState('');
  const trialPending = pendingOwner === owner;
  const [billingStepOwner, setBillingStepOwner] = useState('');
  const [newTrialStep, setNewTrialStep] = useState(false);
  const [paymentNotice, setPaymentNotice] = useState('');
  const [management, setManagement] = useState<PaddleManagementStatus | null>(null);
  const [managementOwner, setManagementOwner] = useState('');
  const [confirmCancellation, setConfirmCancellation] = useState(false);
  const [confirmRenewal, setConfirmRenewal] = useState(false);
  const [managementNotice, setManagementNotice] = useState('');
  const currentManagement =
    managementOwner === owner && subscription?.vesselId === user?.vesselId ? management : null;
  const cancellationEnd =
    subscription?.vesselId === user?.vesselId && subscription?.status === 'canceled'
      ? subscription.currentPeriodEnd
      : currentManagement?.cancellationScheduled
        ? currentManagement.periodEnd
        : null;
  const starting = useRef(false);
  const scroll = useRef<ScrollView>(null);
  useFocusEffect(
    useCallback(() => {
      void refetch();
    }, [refetch])
  );
  useEffect(() => {
    setLocation(null);
    setPreview(null);
    setReview(false);
    setNotice('');
    setPendingOwner('');
    setBillingStepOwner('');
    setPaymentNotice('');
    setManagement(null);
    setManagementOwner('');
    setConfirmCancellation(false);
    setConfirmRenewal(false);
    setManagementNotice('');
  }, [user?.id, user?.vesselId]);
  useEffect(() => {
    const refresh = () => {
      void refetch();
    };
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [refetch]);
  useEffect(() => {
    let active = true;
    setPreview(null);
    setPreviewError('');
    setPreviewBusy(false);
    if (!permitted || !location || !user?.vesselId) return;
    setPreviewBusy(true);
    void previewPaddlePrices(user.vesselId, period, location)
      .then((data) => {
        if (active) {
          setPreviewOwner(`${user.id}:${user.vesselId}`);
          setPreview(data);
        }
      })
      .catch((error) => {
        if (active)
          setPreviewError(
            error instanceof Error ? error.message : 'Tax preview is unavailable. Please retry.'
          );
      })
      .finally(() => {
        if (active) setPreviewBusy(false);
      });
    return () => {
      active = false;
    };
  }, [permitted, user?.vesselId, user?.id, location, period, retry]);
  // Reject stale totals synchronously, including the render before an effect runs.
  const currentPreview =
    preview &&
    previewOwner === `${user?.id}:${user?.vesselId}` &&
    location &&
    preview.billingPeriod === period &&
    preview.countryCode === location.countryCode &&
    preview.postalCode === location.postalCode
      ? preview
      : null;
  const quote = currentPreview?.quotes.find((q) => q.tier === tier);
  const plan = PADDLE_PLAN_TIERS.find((p) => p.id === tier)!;
  const price = getPaddlePrice(tier, period);
  const trialEnd =
    subscription?.status === 'trialing' ? Date.parse(subscription.currentPeriodEnd) : NaN;
  const trialDays = Number.isFinite(trialEnd) ? Math.ceil((trialEnd - Date.now()) / 86400000) : 0;
  const confirmedTrial =
    permitted &&
    !isLoading &&
    accessState === 'entitled' &&
    trialDays > 0 &&
    subscription?.vesselId === user?.vesselId;
  const billingStep =
    billingStepOwner === owner && subscription?.vesselId === user?.vesselId && trialDays > 0;
  useEffect(() => {
    if (!trialPending || !confirmedTrial || !subscription) return;
    setTier(subscription.planTier);
    setPeriod(subscription.billingPeriod);
    setNewTrialStep(true);
    setBillingStepOwner(owner);
    setPendingOwner('');
    setNotice('');
    scroll.current?.scrollTo({ y: 0, animated: false });
  }, [trialPending, confirmedTrial, subscription, owner]);
  // Read-only confirmation polling: never repeat the trial-creation request.
  useEffect(() => {
    if (!trialPending) return;
    let cancelled = false;
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout>;
    const check = async () => {
      try {
        await refetch();
      } catch {
        /* Manual refresh remains available. */
      }
      if (!cancelled && ++attempts < 10) timer = setTimeout(check, 3000);
    };
    timer = setTimeout(check, 3000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [trialPending, refetch]);
  const canCheckout =
    (paddleCheckoutEnabled || paddleBillingEnabled) &&
    !trialPending &&
    !!quote &&
    !previewBusy &&
    !isLoading &&
    !subscription &&
    accessState === 'never_subscribed';
  const card = [styles.card, { backgroundColor: theme.surface, borderColor: theme.border }];
  const text = [styles.copy, { color: theme.textPrimary }];
  const muted = [styles.copy, { color: theme.textSecondary }];
  const heading = [styles.heading, { color: theme.textPrimary }];
  const startCheckout = async () => {
    if (starting.current || !canCheckout || !permitted || !user?.vesselId) return;
    starting.current = true;
    setBusy(true);
    setNotice('');
    const vesselId = user.vesselId,
      userId = user.id;
    try {
      if (paddleBillingEnabled && location) {
        await startPaddleTrial(vesselId, tier, period, location);
        const current = useAuthStore.getState().user;
        if (current?.id !== userId || current.vesselId !== vesselId) return;
        setPendingOwner(`${userId}:${vesselId}`);
        setNotice(
          'Your trial request was sent. Refresh Plan Status to check for confirmation. No payment details or charge are required.'
        );
        await refetch();
        return;
      }
      const url = await preparePaddleCheckout(vesselId, tier, period, window.location.origin);
      const current = useAuthStore.getState().user;
      if (current?.id !== userId || current.vesselId !== vesselId) return;
      const destination = new URL(url);
      const transactionId = destination.searchParams.get('_ptxn')!;
      // Non-authoritative prefill only, isolated to this tab/transaction. No card
      // data or prices in browser storage; Paddle revalidates all billing data.
      try {
        window.sessionStorage.setItem(
          'paddle-prefill:' + transactionId,
          JSON.stringify({
            email: current.email,
            address: location,
            savedAt: Date.now(),
          })
        );
      } catch {
        /* Restricted browser storage: customer re-enters details in Paddle. */
      }
      destination.searchParams.delete('_ptxn');
      destination.searchParams.set('transaction', transactionId);
      window.location.assign(destination.href);
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : 'Checkout could not start. Please try again later.'
      );
    } finally {
      starting.current = false;
      setBusy(false);
    }
  };
  const addTrialPaymentDetails = async () => {
    if (
      starting.current ||
      !paddleBillingEnabled ||
      !permitted ||
      !user?.vesselId ||
      !subscription ||
      subscription.status !== 'trialing' ||
      trialDays <= 0 ||
      !confirmedTrial
    )
      return;
    starting.current = true;
    setBusy(true);
    setPaymentNotice('');
    const { id: userId, vesselId } = user;
    try {
      const url = await preparePaddleTrialPayment(
        vesselId,
        window.location.origin,
        subscription.currentPeriodEnd
      );
      const current = useAuthStore.getState().user;
      if (current?.id !== userId || current.vesselId !== vesselId) return;
      const destination = new URL(url);
      const transaction = destination.searchParams.get('_ptxn')!;
      // Display-only date, after the service verifies it against Paddle's
      // existing trial. Never restart the trial or persist payment credentials.
      try {
        window.sessionStorage.setItem(
          'paddle-trial-summary:' + transaction,
          JSON.stringify({ trialEnd: subscription.currentPeriodEnd, savedAt: Date.now() })
        );
      } catch {
        /* Paddle still displays the authoritative dates if storage is unavailable. */
      }
      destination.searchParams.delete('_ptxn');
      destination.searchParams.set('transaction', transaction);
      destination.searchParams.set('flow', 'payment-method');
      window.location.assign(destination.href);
    } catch (error) {
      const current = useAuthStore.getState().user;
      if (current?.id === userId && current.vesselId === vesselId)
        setPaymentNotice(
          error instanceof Error ? error.message : 'Payment setup could not be confirmed.'
        );
    } finally {
      starting.current = false;
      setBusy(false);
    }
  };
  const recoverPayment = async () => {
    if (
      starting.current ||
      !permitted ||
      !user?.vesselId ||
      !paddleBillingEnabled ||
      isLoading ||
      subscription?.vesselId !== user.vesselId ||
      subscription?.status !== 'past_due' ||
      !['grace_period', 'payment_required'].includes(accessState)
    )
      return;
    starting.current = true;
    setBusy(true);
    setPaymentNotice('');
    const { id, vesselId } = user;
    try {
      const url = await preparePaddlePaymentRecovery(vesselId, window.location.origin);
      const current = useAuthStore.getState().user;
      if (current?.id !== id || current.vesselId !== vesselId) return;
      const destination = new URL(url);
      const transaction = destination.searchParams.get('_ptxn')!;
      destination.searchParams.delete('_ptxn');
      destination.searchParams.set('transaction', transaction);
      // The existing checkout shows Paddle's actual outstanding amount.
      // Only a verified webhook, never this redirect, can restore access.
      window.location.assign(destination.href);
    } catch (error) {
      const current = useAuthStore.getState().user;
      if (current?.id === id && current.vesselId === vesselId)
        setPaymentNotice(
          error instanceof Error ? error.message : 'Payment recovery could not be confirmed.'
        );
    } finally {
      starting.current = false;
      setBusy(false);
    }
  };
  const openBillingStep = () => {
    if (!confirmedTrial || !subscription) return;
    setTier(subscription.planTier);
    setPeriod(subscription.billingPeriod);
    setNewTrialStep(false);
    setPaymentNotice('');
    setBillingStepOwner(owner);
    scroll.current?.scrollTo({ y: 0, animated: false });
  };
  const manageSubscription = async (
    action: 'status' | 'payment_method' | 'cancel_renewal' | 'review_renewal' | 'keep_subscription'
  ) => {
    if (
      starting.current ||
      !paddleManagementEnabled ||
      !permitted ||
      !user?.vesselId ||
      isLoading ||
      accessState === 'unavailable' ||
      subscription?.vesselId !== user.vesselId
    )
      return;
    if (action === 'cancel_renewal' && (!confirmCancellation || !currentManagement)) return;
    if (
      action === 'keep_subscription' &&
      (!confirmRenewal || !currentManagement?.cancellationScheduled)
    )
      return;
    starting.current = true;
    setBusy(true);
    setManagementNotice('');
    const { id, vesselId } = user;
    const stillCurrent = () => {
      const current = useAuthStore.getState().user;
      return current?.id === id && current.vesselId === vesselId;
    };
    try {
      if (action === 'status' || action === 'review_renewal') {
        setConfirmCancellation(false);
        setConfirmRenewal(false);
        setManagement(null);
        const result = await getPaddleManagementStatus(vesselId);
        if (!stillCurrent()) return;
        setManagement(result);
        setManagementOwner(`${id}:${vesselId}`);
        if (action === 'review_renewal') {
          if (
            result.cancellationScheduled &&
            ['active', 'trialing'].includes(result.status) &&
            Date.parse(result.periodEnd) > Date.now()
          ) {
            setConfirmRenewal(true);
          } else {
            setManagementNotice(
              'Subscription status has changed. The current plan is being refreshed; no renewal change was sent.'
            );
            await refetch();
          }
        }
      } else if (action === 'payment_method') {
        const url = await preparePaddlePaymentMethod(vesselId, window.location.origin);
        if (!stillCurrent()) return;
        const destination = new URL(url);
        const transaction = destination.searchParams.get('_ptxn')!;
        destination.searchParams.delete('_ptxn');
        destination.searchParams.set('transaction', transaction);
        destination.searchParams.set('flow', 'payment-method');
        window.location.assign(destination.href);
      } else if (action === 'keep_subscription') {
        await keepPaddleSubscription(vesselId, currentManagement!.periodEnd);
        if (!stillCurrent()) return;
        setManagement(null);
        setConfirmRenewal(false);
        setManagementNotice(
          'Renewal restoration requested. Refresh Plan Status to confirm it. Your plan and billing date have not been changed.'
        );
        await refetch();
      } else {
        await cancelPaddleRenewal(vesselId, currentManagement!.periodEnd);
        if (!stillCurrent()) return;
        setManagement(null);
        setConfirmCancellation(false);
        setConfirmRenewal(false);
        setManagementNotice(
          'Cancellation requested. Refresh Plan Status to confirm it. No vessel records or crew memberships are removed.'
        );
        await refetch();
      }
    } catch {
      if (stillCurrent()) {
        setManagement(null);
        setConfirmCancellation(false);
        setConfirmRenewal(false);
        setManagementNotice(
          'Subscription action could not be confirmed. Refresh Plan Status and check subscription management before retrying.'
        );
      }
    } finally {
      starting.current = false;
      setBusy(false);
    }
  };
  const optionalBilling = (
    <View style={[...card, styles.optionalBilling]} testID="optional-trial-billing">
      <Text accessibilityRole="header" style={heading}>
        {newTrialStep ? 'Your 30-day free trial is ready' : 'Set up your billing details'}
      </Text>
      <Text style={text}>
        Add payment details now to help avoid an interruption when your trial ends, or continue
        without them.
      </Text>
      <Text style={[styles.planTitle, { color: theme.textPrimary }]}>
        {plan.label} · {PADDLE_BILLING_PERIODS.find((p) => p.id === period)?.label}
      </Text>
      <Text style={text}>Due today: US$0.00</Text>
      <Text style={text}>
        First subscription payment:{' '}
        {new Date(trialEnd).toLocaleDateString(undefined, {
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        })}
        , if you add payment details.
      </Text>
      <View style={[styles.total, { borderColor: theme.border }]}>
        <Text style={muted}>Recurring total after your trial</Text>
        <Text style={heading}>
          {quote ? `${usd(quote.totalCents)} ${price.suffix}` : 'Awaiting tax total'}
        </Text>
        <Text style={muted}>
          {quote
            ? `${usd(quote.baseCents)} base + ${usd(quote.taxCents)} VAT / sales tax`
            : `${usd(price.totalCents)} ${price.suffix} before tax`}
        </Text>
      </View>
      <Button
        title={
          location
            ? `Billing country: ${billingCountryName(location.countryCode)} — Change`
            : 'Choose billing country'
        }
        variant="outline"
        disabled={busy}
        onPress={() => setPicker(true)}
      />
      <Text style={muted}>
        {previewBusy
          ? 'Calculating regional tax…'
          : quote
            ? 'Includes applicable tax for your selected billing location. Paddle confirms the final recurring amount using your full billing details.'
            : 'Choose your billing country to review the tax-inclusive total.'}
      </Text>
      {!!previewError && (
        <Text accessibilityRole="alert" style={text}>
          {previewError}
        </Text>
      )}
      {!!previewError && (
        <Button
          title="Retry Tax Calculation"
          variant="outline"
          onPress={() => setRetry((n) => n + 1)}
        />
      )}
      <Text style={muted}>
        Payment details are entered securely in Paddle. Your original trial end date stays the same.
        No subscription payment is taken today. Adding details authorises automatic billing when
        your trial ends unless you cancel beforehand.
      </Text>
      {paddleEnvironment === 'sandbox' && (
        <Text style={text}>Sandbox test — no real payment. Use test card details only.</Text>
      )}
      {!!paymentNotice && (
        <Text accessibilityRole="alert" style={text}>
          {paymentNotice}
        </Text>
      )}
      {!confirmedTrial && (
        <Text accessibilityRole="alert" style={text}>
          Confirming your trial status. Payment setup is paused until it can be verified.
        </Text>
      )}
      <Button
        title={busy ? 'Preparing secure checkout…' : 'Set up billing details'}
        onPress={addTrialPaymentDetails}
        disabled={busy || !confirmedTrial || !quote || previewBusy}
      />
      <Button
        title="Continue without payment details"
        variant="outline"
        disabled={busy || !confirmedTrial}
        onPress={() => {
          setBillingStepOwner('');
          navigation.navigate('MainTabs', { screen: 'Home' });
        }}
      />
      <Text style={muted}>
        You can add payment details later in Vessel Plans. Without them, access will be restricted
        when your trial ends.
      </Text>
      <Button
        title="Back to Plans"
        variant="outline"
        disabled={busy}
        onPress={() => setBillingStepOwner('')}
      />
      {!confirmedTrial && (
        <Button
          title="Refresh Plan Status"
          variant="outline"
          disabled={isLoading}
          onPress={() => {
            void refetch();
          }}
        />
      )}
    </View>
  );
  const summary = (
    <View style={[...card, styles.summary]} testID="billing-summary">
      <Text accessibilityRole="header" style={heading}>
        {review ? 'Set up billing' : 'Your plan'}
      </Text>
      <Text style={[styles.planTitle, { color: theme.textPrimary }]}>{plan.label}</Text>
      <Text style={muted}>
        {PADDLE_BILLING_PERIODS.find((p) => p.id === period)?.label} billing · USD
      </Text>
      <View style={styles.between}>
        <Text style={text}>Subscription before tax</Text>
        <Text style={text}>{usd(price.totalCents)}</Text>
      </View>
      <View style={styles.between}>
        <Text style={text}>VAT / sales tax</Text>
        <Text style={text}>{quote ? usd(quote.taxCents) : 'Not yet calculated'}</Text>
      </View>
      <View style={[styles.total, { borderColor: theme.border }]}>
        <Text style={[styles.planTitle, { color: theme.textPrimary }]}>Total {price.suffix}</Text>
        <Text style={heading}>{quote ? usd(quote.totalCents) : 'Awaiting tax total'}</Text>
      </View>
      <Text style={muted}>
        {quote
          ? 'Includes the tax calculated for your selected billing location. Paddle confirms the final amount using your full billing details.'
          : 'Select your billing country to calculate the total. No unverified tax estimate will be charged.'}
      </Text>
      {trialDays > 0 && (
        <View style={styles.trial}>
          <Text style={text}>
            Your existing trial ends {new Date(trialEnd).toLocaleDateString()}.
          </Text>
          <Text style={muted}>
            Adding payment details must not change this date or charge you early.
          </Text>
        </View>
      )}
      {!subscription && (
        <Text style={muted}>
          Start a 30-day free trial without card details. Add payment details before the trial ends
          to continue. No subscription payment is taken before the trial expires.
        </Text>
      )}
      {review && !paddleBillingEnabled && (
        <Text style={muted}>
          Enter payment details and any business tax ID securely in Paddle. Applicable tax may
          change after validation. Nautical Ops does not collect your card details on this page.
        </Text>
      )}
      {!!notice && (
        <Text accessibilityRole="alert" style={text}>
          {notice}
        </Text>
      )}
      {subscription && subscription.status !== 'past_due' && (
        <Text style={muted}>
          {cancellationEnd
            ? 'Renewal is cancelled. See the end date on your current plan above. Use Refresh Plan Status to check for updates.'
            : trialDays > 0
              ? paddleBillingEnabled
                ? 'Use Set up new billing details on your current plan above. This keeps your original trial end date.'
                : 'Payment setup for your existing trial is being connected. It is not available yet; do not start a second subscription.'
              : paddleManagementEnabled
                ? 'Use Manage Subscription above for payment details or cancellation. Plan and billing-period changes are not available yet. Do not start a second subscription.'
                : 'Existing subscription management is being connected. A second subscription cannot be created here.'}
        </Text>
      )}
      {!paddleCheckoutEnabled && !paddleBillingEnabled && (
        <Text style={muted}>Paddle checkout is being configured. No payment can be taken yet.</Text>
      )}
      {(paddleCheckoutEnabled || paddleBillingEnabled) && paddleEnvironment === 'sandbox' && (
        <Text style={text}>Sandbox test — no real payment.</Text>
      )}
      <Button
        title={
          review
            ? (!paddleCheckoutEnabled && !paddleBillingEnabled) || !!subscription
              ? 'Payments not yet available'
              : busy
                ? 'Preparing…'
                : trialPending
                  ? 'Awaiting trial confirmation'
                  : paddleBillingEnabled
                    ? 'Start 30-day free trial'
                    : 'Continue to Secure Checkout'
            : 'Continue'
        }
        onPress={
          review
            ? startCheckout
            : () => {
                setReview(true);
                scroll.current?.scrollTo({ y: 0, animated: false });
              }
        }
        disabled={busy || (review ? !canCheckout : !quote || previewBusy)}
      />
      {review && (
        <Button
          title="Back to Plans"
          variant="outline"
          disabled={busy}
          onPress={() => setReview(false)}
        />
      )}
      <Button
        title="Refresh Plan Status"
        variant="outline"
        onPress={() => {
          void refetch();
        }}
        disabled={busy || isLoading}
      />
    </View>
  );
  return (
    <View style={[styles.page, { backgroundColor: theme.background }]}>
      <PageHeader title="Vessel Plans" />
      <ScrollView
        ref={scroll}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.scroll, width < 400 && { padding: 12 }]}
      >
        <View style={styles.content}>
          {!permitted ? (
            <Text style={text}>Only the vessel’s Captain / MOV can manage its subscription.</Text>
          ) : (
            <>
              <View style={styles.brand}>
                <Image
                  source={require('../../assets/nautical-ops-vessel-logo.png')}
                  style={styles.logo}
                />
                <Text style={heading}>Nautical Ops</Text>
              </View>
              {billingStep ? (
                optionalBilling
              ) : (
                <>
                  {subscription && (
                    <View style={card}>
                      <Text style={muted}>CURRENT PLAN</Text>
                      <Text style={[styles.planTitle, { color: theme.textPrimary }]}>
                        {PADDLE_PLAN_TIERS.find((p) => p.id === subscription.planTier)?.label ??
                          subscription.planTier}{' '}
                        ·{' '}
                        {PADDLE_BILLING_PERIODS.find((p) => p.id === subscription.billingPeriod)
                          ?.label ?? subscription.billingPeriod}
                      </Text>
                      {cancellationEnd ? (
                        <View accessibilityLiveRegion="polite" style={{ gap: 8 }}>
                          <Text style={[styles.planTitle, { color: theme.textPrimary }]}>
                            Renewal cancelled
                          </Text>
                          <Text style={text}>
                            {subscription.status === 'past_due'
                              ? 'Cancellation takes effect '
                              : Date.parse(cancellationEnd) > Date.now()
                                ? 'Access ends '
                                : 'Access ended '}
                            {new Date(cancellationEnd).toLocaleString(undefined, {
                              day: 'numeric',
                              month: 'long',
                              year: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                            .
                          </Text>
                          {paddleManagementEnabled &&
                            Date.parse(cancellationEnd) > Date.now() &&
                            subscription.status !== 'past_due' &&
                            (confirmRenewal && currentManagement?.cancellationScheduled ? (
                              <View style={{ gap: 10 }}>
                                <Text style={text}>
                                  Keep this subscription and restore automatic renewal on{' '}
                                  {new Date(currentManagement.periodEnd).toLocaleString()}? Your
                                  current plan and billing date stay the same. This does not start a
                                  new trial or take a payment today.
                                </Text>
                                <Button
                                  title={busy ? 'Checking…' : 'Confirm Renewal'}
                                  disabled={busy || isLoading || accessState === 'unavailable'}
                                  onPress={() => void manageSubscription('keep_subscription')}
                                />
                                <Button
                                  title="Leave Cancelled"
                                  variant="outline"
                                  disabled={busy}
                                  onPress={() => setConfirmRenewal(false)}
                                />
                              </View>
                            ) : (
                              <Button
                                title={busy ? 'Checking…' : 'Keep Subscription'}
                                variant="outline"
                                disabled={busy || isLoading || accessState === 'unavailable'}
                                onPress={() => void manageSubscription('review_renewal')}
                              />
                            ))}
                        </View>
                      ) : (
                        <Text style={muted}>
                          {subscription.status === 'trialing'
                            ? 'Trial ends '
                            : 'Current period ends '}
                          {new Date(subscription.currentPeriodEnd).toLocaleDateString()}
                        </Text>
                      )}
                      {paddleBillingEnabled && trialDays > 0 && (
                        <>
                          <Text style={muted}>
                            Add payment details securely in Paddle. Your trial end date stays the
                            same; no subscription payment is taken today.
                          </Text>
                          <Button
                            title={busy ? 'Preparing…' : 'Set up new billing details'}
                            onPress={openBillingStep}
                            disabled={busy || !confirmedTrial}
                          />
                        </>
                      )}
                      {subscription.status === 'past_due' && (
                        <>
                          <Text style={muted}>
                            {accessState === 'grace_period'
                              ? subscription.gracePeriodEnd
                                ? `Payment is overdue. Grace access ends ${new Date(subscription.gracePeriodEnd).toLocaleDateString()}.`
                                : 'Payment is overdue. Please resolve it before grace access ends.'
                              : 'Payment is overdue. Access returns after the payment is confirmed.'}{' '}
                            Resolve the existing payment in Paddle; this will not create a second
                            subscription.
                          </Text>
                          <Button
                            title={busy ? 'Preparing…' : 'Resolve payment'}
                            onPress={recoverPayment}
                            disabled={
                              busy ||
                              isLoading ||
                              !paddleBillingEnabled ||
                              subscription.vesselId !== user?.vesselId ||
                              accessState === 'unavailable'
                            }
                          />
                          {!paddleBillingEnabled && (
                            <Text style={muted}>
                              Payment recovery is not enabled on this release. Contact support.
                            </Text>
                          )}
                          {!!paymentNotice && (
                            <Text accessibilityRole="alert" style={text}>
                              {paymentNotice}
                            </Text>
                          )}
                        </>
                      )}
                      {paddleManagementEnabled && !cancellationEnd && (
                        <>
                          <Button
                            title={busy ? 'Checking…' : 'Manage Subscription'}
                            variant="outline"
                            disabled={busy || isLoading || accessState === 'unavailable'}
                            onPress={() => {
                              void manageSubscription('status');
                            }}
                          />
                          {currentManagement && (
                            <>
                              {currentManagement.cancellationScheduled ? (
                                <Text style={text}>
                                  Renewal cancellation is scheduled for{' '}
                                  {new Date(currentManagement.periodEnd).toLocaleString()}.
                                </Text>
                              ) : (
                                <>
                                  {currentManagement.status === 'active' && (
                                    <Button
                                      title="Update Payment Method"
                                      variant="outline"
                                      disabled={busy}
                                      onPress={() => {
                                        void manageSubscription('payment_method');
                                      }}
                                    />
                                  )}
                                  {!confirmCancellation ? (
                                    <Button
                                      title="Cancel Renewal"
                                      variant="outline"
                                      disabled={busy}
                                      onPress={() => setConfirmCancellation(true)}
                                    />
                                  ) : (
                                    <View style={{ gap: 10 }}>
                                      <Text style={text}>
                                        Cancel renewal at the end of this period,{' '}
                                        {new Date(currentManagement.periodEnd).toLocaleString()}?{' '}
                                        This does not delete vessel records or remove crew. Any
                                        overdue payment remains due; cancellation does not restore
                                        unpaid access.
                                      </Text>
                                      <Button
                                        title="Confirm Cancellation"
                                        disabled={busy}
                                        onPress={() => {
                                          void manageSubscription('cancel_renewal');
                                        }}
                                      />
                                      <Button
                                        title="Keep Subscription"
                                        variant="outline"
                                        disabled={busy}
                                        onPress={() => setConfirmCancellation(false)}
                                      />
                                    </View>
                                  )}
                                </>
                              )}
                            </>
                          )}
                        </>
                      )}
                      {!!managementNotice && (
                        <Text accessibilityRole="alert" style={text}>
                          {managementNotice}
                        </Text>
                      )}
                    </View>
                  )}
                  {trialDays > 0 && (
                    <Text style={text}>{trialDays} days left in your free trial</Text>
                  )}
                  {accessState === 'unavailable' && (
                    <Text accessibilityRole="alert" style={text}>
                      Your subscription status could not be confirmed. Checkout is paused to prevent
                      a duplicate subscription.
                    </Text>
                  )}
                  <View style={[styles.columns, wide && styles.wide]} testID="billing-layout">
                    <View style={styles.selection}>
                      <Text accessibilityRole="header" style={heading}>
                        {review ? 'Review your billing details' : 'Choose your vessel plan'}
                      </Text>
                      <View style={card}>
                        <View style={styles.between}>
                          <View style={styles.grow}>
                            <Text style={muted}>Billing country</Text>
                            <Text style={[styles.planTitle, { color: theme.textPrimary }]}>
                              {location
                                ? billingCountryName(location.countryCode)
                                : 'Choose your billing country'}
                            </Text>
                            {!!location?.postalCode && (
                              <Text style={muted}>{location.postalCode}</Text>
                            )}
                          </View>
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="Change billing country"
                            disabled={busy}
                            onPress={() => setPicker(true)}
                            style={styles.linkButton}
                          >
                            <Text style={{ color: theme.textPrimary, fontWeight: '600' }}>
                              {location ? 'Change' : 'Select'}
                            </Text>
                          </Pressable>
                        </View>
                        <Text style={muted}>
                          Use your billing address, not your vessel’s current location.
                        </Text>
                      </View>
                      {!!location && (
                        <View accessibilityLiveRegion="polite">
                          {previewBusy ? (
                            <Text style={muted}>Calculating regional tax…</Text>
                          ) : previewError ? (
                            <>
                              <Text accessibilityRole="alert" style={text}>
                                {previewError}
                              </Text>
                              <Button
                                title="Retry Tax Calculation"
                                variant="outline"
                                onPress={() => setRetry((n) => n + 1)}
                              />
                            </>
                          ) : currentPreview ? (
                            <Text style={muted}>
                              Prices below include applicable tax for{' '}
                              {billingCountryName(location.countryCode)}.
                            </Text>
                          ) : null}
                        </View>
                      )}
                      {!review && (
                        <>
                          <Text style={[styles.label, { color: theme.textPrimary }]}>
                            BILLING PERIOD
                          </Text>
                          <View style={styles.periods}>
                            {PADDLE_BILLING_PERIODS.map((p) => (
                              <Pressable
                                key={p.id}
                                accessibilityRole="radio"
                                accessibilityState={{ checked: p.id === period }}
                                disabled={busy}
                                onPress={() => setPeriod(p.id)}
                                style={[
                                  styles.period,
                                  {
                                    borderColor: theme.border,
                                    backgroundColor:
                                      p.id === period ? theme.controlSelected : theme.surface,
                                  },
                                ]}
                              >
                                <Text
                                  style={{
                                    color: p.id === period ? theme.textOnAccent : theme.textPrimary,
                                    fontSize: 16,
                                    fontWeight: '600',
                                  }}
                                >
                                  {p.label}
                                </Text>
                              </Pressable>
                            ))}
                          </View>
                          <Text style={[styles.label, { color: theme.textPrimary }]}>
                            CREW SIZE
                          </Text>
                          <Text style={[styles.taxNote, { color: theme.textSecondary }]}>
                            Tax/VAT is calculated at checkout based on your billing region.
                          </Text>
                          {PADDLE_PLAN_TIERS.map((p) => {
                            const base = getPaddlePrice(p.id, period),
                              q = currentPreview?.quotes.find((item) => item.tier === p.id);
                            return (
                              <Pressable
                                key={p.id}
                                disabled={busy}
                                accessibilityRole="radio"
                                accessibilityState={{ checked: tier === p.id }}
                                accessibilityLabel={
                                  p.label +
                                  ', ' +
                                  (q
                                    ? usd(q.totalCents) + ' including tax'
                                    : usd(base.totalCents) + ' before tax') +
                                  ' ' +
                                  base.suffix
                                }
                                onPress={() => setTier(p.id)}
                                style={[
                                  ...card,
                                  styles.plan,
                                  {
                                    borderColor:
                                      tier === p.id ? theme.controlSelected : theme.border,
                                  },
                                ]}
                              >
                                <View
                                  style={[
                                    styles.radio,
                                    {
                                      borderColor:
                                        tier === p.id ? theme.controlSelected : theme.textSecondary,
                                    },
                                  ]}
                                >
                                  {tier === p.id && (
                                    <View
                                      style={[
                                        styles.dot,
                                        { backgroundColor: theme.controlSelected },
                                      ]}
                                    />
                                  )}
                                </View>
                                <View style={styles.grow}>
                                  <Text style={[styles.planTitle, { color: theme.textPrimary }]}>
                                    {p.label}
                                  </Text>
                                  <Text style={[styles.planPrice, { color: theme.accent }]}>
                                    {q ? usd(q.totalCents) : usd(base.totalCents)}{' '}
                                    <Text
                                      style={[styles.planPeriod, { color: theme.textSecondary }]}
                                    >
                                      {base.suffix}
                                    </Text>
                                  </Text>
                                </View>
                              </Pressable>
                            );
                          })}
                        </>
                      )}
                    </View>
                    <View style={wide ? styles.summaryColumn : undefined}>{summary}</View>
                  </View>
                </>
              )}
            </>
          )}
        </View>
      </ScrollView>
      {permitted && (
        <BillingCountryPicker
          visible={picker}
          value={location}
          onClose={() => setPicker(false)}
          onConfirm={(value) => {
            setPreview(null);
            setLocation(value);
            setPicker(false);
          }}
        />
      )}
    </View>
  );
};
const styles = StyleSheet.create({
  page: { flex: 1 },
  scroll: { padding: 24, paddingBottom: 48 },
  content: { width: '100%', maxWidth: 1160, alignSelf: 'center', gap: 20 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  logo: { width: 38, height: 38, resizeMode: 'contain' },
  columns: { gap: 24 },
  wide: { flexDirection: 'row', alignItems: 'flex-start' },
  selection: { flex: 1, minWidth: 0, gap: 14 },
  summaryColumn: { width: 360, flexShrink: 0 },
  optionalBilling: { width: '100%', maxWidth: 720, alignSelf: 'center', gap: 16 },
  card: { borderWidth: 1, borderRadius: 16, padding: 20, gap: 10 },
  summary: { gap: 16 },
  heading: { fontSize: 23, fontWeight: '700' },
  copy: { fontSize: 15, lineHeight: 23, flexShrink: 1 },
  planTitle: { fontSize: 17, fontWeight: '600', flexShrink: 1 },
  planPrice: { fontSize: 24, lineHeight: 32, fontWeight: '700', flexShrink: 1 },
  planPeriod: { fontSize: 18, fontWeight: '400' },
  taxNote: { fontSize: 13, lineHeight: 20 },
  label: { fontSize: 12, fontWeight: '700', letterSpacing: 1 },
  grow: { flex: 1, minWidth: 0, gap: 4 },
  between: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 10,
  },
  linkButton: { minHeight: 44, justifyContent: 'center', padding: 8 },
  periods: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  period: {
    flexGrow: 1,
    flexBasis: '45%',
    minHeight: 50,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 10,
    borderWidth: 1,
    borderRadius: 12,
  },
  plan: { flexDirection: 'row', alignItems: 'center', borderWidth: 2 },
  radio: {
    width: 24,
    height: 24,
    borderWidth: 2,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: { width: 12, height: 12, borderRadius: 6 },
  total: { borderTopWidth: 1, paddingTop: 14, gap: 8 },
  trial: { gap: 6 },
});
