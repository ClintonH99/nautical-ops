import {
  getPaddlePrice,
  PADDLE_PLAN_TIERS,
  PADDLE_BILLING_PERIODS,
} from '../../src/constants/paddlePlans';

test('all 24 approved web plans are available and use whole-period cent rounding', () => {
  const expected = [
    [7999, 22797, 44154, 86389],
    [8999, 25647, 49674, 97189],
    [11999, 34197, 66234, 129589],
    [14999, 42747, 82794, 161989],
    [19999, 56997, 110394, 215989],
    [24999, 71247, 137994, 269989],
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
