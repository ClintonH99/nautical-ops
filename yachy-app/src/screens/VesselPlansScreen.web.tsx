import React, { useState } from 'react';
import { ScrollView, View, Text, Pressable, StyleSheet } from 'react-native';
import { PageHeader, Button } from '../components';
import { useThemeColors } from '../hooks/useThemeColors';
import { useAuthStore } from '../store';
import { canAccessVesselManagement } from '../utils/access';
import {
  PADDLE_PLAN_TIERS,
  PADDLE_BILLING_PERIODS,
  getPaddlePrice,
  type PaddlePlanTier,
  type PaddleBillingPeriod,
} from '../constants/paddlePlans';

/** Web payment UI is isolated from StoreKit. Activation waits for verified Paddle integration. */
export const VesselPlansScreen = () => {
  const theme = useThemeColors();
  const colors = { ...theme, text: theme.textPrimary, primary: theme.controlSelected };
  const user = useAuthStore((state) => state.user);
  const [tier, setTier] = useState<PaddlePlanTier>('1_5');
  const [period, setPeriod] = useState<PaddleBillingPeriod>('monthly');
  const permitted = canAccessVesselManagement(user) && !!user?.vesselId;
  const price = getPaddlePrice(tier, period);
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
              <Text style={[styles.heading, { color: colors.text }]}>Choose your vessel plan</Text>
              <Text style={[styles.copy, { color: colors.textSecondary }]}>
                Choose your billing period and crew size. Prices are in USD for the full selected
                period.
              </Text>
              <Text style={[styles.label, { color: colors.textSecondary }]}>BILLING PERIOD</Text>
              <View style={styles.periods}>
                {PADDLE_BILLING_PERIODS.map((option) => (
                  <Pressable
                    key={option.id}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: period === option.id }}
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
                Paddle checkout is being configured. No payment can be taken yet. Any applicable tax
                and the final amount will be shown at checkout before you confirm.
              </Text>
              <Button title="Payments not yet available" onPress={() => {}} disabled />
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
