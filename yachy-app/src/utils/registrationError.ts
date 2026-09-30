/** A lost response does not prove that account creation failed on the server. */
export function registrationErrorMessage(error: unknown): string {
  const message =
    error && typeof error === 'object' && 'message' in error ? String(error.message) : '';
  if (
    /network|fetch failed|failed to fetch|timeout|timed out|connection.*lost|AuthRetryableFetchError/i.test(
      message
    )
  ) {
    return 'The connection was interrupted while creating your account. Your details are still here. Reconnect, then try signing in with this email first: the account may already have been created. If it has not, return here and try again.';
  }
  return message || 'We could not create your account. Please try again.';
}
