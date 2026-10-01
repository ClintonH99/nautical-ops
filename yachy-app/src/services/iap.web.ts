/** Native-store reconciliation is deliberately absent on the Paddle-only website. */
export async function reconcileAppleSubscription(_vesselId: string): Promise<boolean> {
  return false;
}
