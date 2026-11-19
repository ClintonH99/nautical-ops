/** Receipt tax is entered by the user, never inferred from location. */
export function validFuelTaxPercentage(rate: number | null): boolean {
  return (
    rate === null ||
    (Number.isFinite(rate) &&
      rate >= 0 &&
      rate <= 100 &&
      Math.abs(rate * 10000 - Math.round(rate * 10000)) < 0.000001)
  );
}
export function fuelReceiptTotals(net: number, rate: number | null) {
  if (!Number.isFinite(net) || net < 0 || !validFuelTaxPercentage(rate)) {
    throw new Error('Enter a tax percentage from 0 to 100 with up to four decimal places.');
  }
  const money = (n: number) =>
    Math.round((n + Number.EPSILON * Math.max(1, Math.abs(n))) * 100) / 100;
  const subtotal = money(net);
  const taxAmount = money((subtotal * (rate ?? 0)) / 100);
  return { subtotal, taxAmount, totalPrice: money(subtotal + taxAmount) };
}
