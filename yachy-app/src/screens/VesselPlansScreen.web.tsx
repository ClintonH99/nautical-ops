import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useFocusEffect } from '@react-navigation/native';
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
  }, [user?.id, user?.vesselId]);
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
  const canCheckout =
    paddleCheckoutEnabled &&
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
          New subscriptions include a 30-day free trial. Review the first payment date and recurring
          total in Paddle before confirming.
        </Text>
      )}
      {review && (
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
      {subscription && (
        <Text style={muted}>
          {trialDays > 0
            ? 'Payment setup for your existing trial is being connected. It is not available yet; do not start a second subscription.'
            : 'Existing subscription management is being connected. A second subscription cannot be created here.'}
        </Text>
      )}
      {!paddleCheckoutEnabled && (
        <Text style={muted}>Paddle checkout is being configured. No payment can be taken yet.</Text>
      )}
      {paddleCheckoutEnabled && paddleEnvironment === 'sandbox' && (
        <Text style={text}>Sandbox test — no real payment.</Text>
      )}
      <Button
        title={
          review
            ? !paddleCheckoutEnabled || !!subscription
              ? 'Payments not yet available'
              : busy
                ? 'Preparing Checkout…'
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
                  <Text style={muted}>
                    {subscription.status === 'canceled'
                      ? 'Renewal cancelled. Access ends '
                      : subscription.status === 'trialing'
                        ? 'Trial ends '
                        : 'Current period ends '}
                    {new Date(subscription.currentPeriodEnd).toLocaleDateString()}
                  </Text>
                </View>
              )}
              {trialDays > 0 && <Text style={text}>{trialDays} days left in your free trial</Text>}
              {accessState === 'unavailable' && (
                <Text accessibilityRole="alert" style={text}>
                  Your subscription status could not be confirmed. Checkout is paused to prevent a
                  duplicate subscription.
                </Text>
              )}
              <View style={[styles.columns, wide && styles.wide]} testID="billing-layout">
                <View style={styles.selection}>
                  <Text accessibilityRole="header" style={heading}>
                    {review ? 'Review your billing details' : 'Choose your vessel plan'}
                  </Text>
                  <Text style={muted}>
                    The same USD base prices worldwide. Your billing location determines applicable
                    VAT / sales tax.
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
                        {!!location?.postalCode && <Text style={muted}>{location.postalCode}</Text>}
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
                      <Text style={[styles.label, { color: theme.textPrimary }]}>CREW SIZE</Text>
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
                              { borderColor: tier === p.id ? theme.controlSelected : theme.border },
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
                                  style={[styles.dot, { backgroundColor: theme.controlSelected }]}
                                />
                              )}
                            </View>
                            <View style={styles.grow}>
                              <Text style={[styles.planTitle, { color: theme.textPrimary }]}>
                                {p.label}
                              </Text>
                              <Text style={text}>
                                {q ? usd(q.totalCents) : usd(base.totalCents)} {base.suffix}
                                {q ? '' : ' before tax'}
                              </Text>
                              {q && (
                                <Text style={muted}>
                                  {usd(q.baseCents)} base + {usd(q.taxCents)} VAT / tax
                                </Text>
                              )}
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
  card: { borderWidth: 1, borderRadius: 16, padding: 20, gap: 10 },
  summary: { gap: 16 },
  heading: { fontSize: 23, fontWeight: '700' },
  copy: { fontSize: 15, lineHeight: 23, flexShrink: 1 },
  planTitle: { fontSize: 17, fontWeight: '600', flexShrink: 1 },
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
