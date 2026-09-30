/** Dedicated webhook authentication survives changes to the gateway's JWT handling. */
export function isTrustedNotificationRequest(
  headers: Headers,
  serviceRoleKey: string | undefined,
  webhookSecret: string | undefined
): boolean {
  const suppliedSecret = headers.get('x-trip-webhook-secret');
  if (webhookSecret && suppliedSecret) {
    // Compare all characters, rather than exiting at the first differing character.
    let mismatch = webhookSecret.length ^ suppliedSecret.length;
    for (let i = 0; i < webhookSecret.length; i++) {
      mismatch |= webhookSecret.charCodeAt(i) ^ (suppliedSecret.charCodeAt(i) || 0);
    }
    return mismatch === 0;
  }
  // Compatibility for the separately configured reminder/checklist webhooks.
  return !!serviceRoleKey && headers.get('Authorization') === `Bearer ${serviceRoleKey}`;
}
