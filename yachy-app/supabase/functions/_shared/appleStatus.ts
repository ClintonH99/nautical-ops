import { decodeJwt } from 'npm:jose@5';

// Fetch the CURRENT state rather than inferring renewal from a past purchase.
// Only payloads returned over authenticated HTTPS by Apple are decoded here.
export async function fetchCurrentAppleStatus(
  transactionId: string,
  originalId: string,
  jwt: string,
  bundleId: string
) {
  const headers = { Authorization: `Bearer ${jwt}` };
  let result = await fetch(
    `https://api.storekit.itunes.apple.com/inApps/v1/subscriptions/${transactionId}`,
    { headers }
  );
  if (result.status === 404) {
    result = await fetch(
      `https://api.storekit-sandbox.itunes.apple.com/inApps/v1/subscriptions/${transactionId}`,
      { headers }
    );
  }
  if (!result.ok) throw new Error('Apple subscription status unavailable');
  const body = await result.json();
  if (body.bundleId !== bundleId) throw new Error('Apple bundle mismatch');
  const candidates = (body.data ?? [])
    .flatMap((group: any) => group.lastTransactions ?? [])
    .filter((item: any) => item.signedTransactionInfo)
    .map((item: any) => ({
      status: Number(item.status),
      transaction: decodeJwt(item.signedTransactionInfo),
      renewal: item.signedRenewalInfo ? decodeJwt(item.signedRenewalInfo) : null,
    }))
    .filter(
      (item: any) =>
        item.transaction.bundleId === bundleId &&
        item.transaction.originalTransactionId === originalId
    )
    .sort(
      (a: any, b: any) => Number(b.transaction.expiresDate) - Number(a.transaction.expiresDate)
    );
  if (!candidates[0]) throw new Error('Apple subscription chain unavailable');
  return candidates[0] as {
    status: number;
    transaction: Record<string, unknown>;
    renewal: Record<string, unknown> | null;
  };
}
