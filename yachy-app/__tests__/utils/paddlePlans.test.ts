import {
  getPaddlePrice,
  PADDLE_PLAN_TIERS,
  PADDLE_BILLING_PERIODS,
} from '../../src/constants/paddlePlans';

test('all 24 web plans use the exact approved Paddle catalogue totals', () => {
  const expected = [
    [7999, 22999, 44999, 86999],
    [8999, 25999, 49999, 97999],
    [11999, 34999, 66999, 129999],
    [14999, 42999, 82999, 161999],
    [19999, 56999, 110999, 215999],
    [24999, 71999, 137999, 269999],
  ];
  PADDLE_PLAN_TIERS.forEach((tier, i) =>
    PADDLE_BILLING_PERIODS.forEach((period, j) => {
      const price = getPaddlePrice(tier.id, period.id);
      expect(price.totalCents).toBe(expected[i][j]);
      expect(price.currency).toBe('USD');
      expect(`${price.displayTotal} ${price.suffix}`).not.toMatch(/%|off|save/i);
    })
  );
});
test('unknown plans are not presented as free', () => {
  expect(() => getPaddlePrice('unknown' as any, 'monthly')).toThrow('Unknown plan');
});
