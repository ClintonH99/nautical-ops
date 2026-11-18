/** An access denial or a failed record download is not proof of lost internet. */
export function isOfflineConnectionFailure(error: unknown, browserOnline: boolean): boolean {
  if (!browserOnline) return true;
  if (!error || typeof error !== 'object') return false;
  const { name, message } = error as { name?: string; message?: string };
  return (
    name === 'AbortError' ||
    name === 'TimeoutError' ||
    (name === 'Error' && message === 'ONLINE_CHECK_UNAVAILABLE') ||
    (name === 'TypeError' &&
      /failed to fetch|fetch failed|network|load failed/i.test(message ?? ''))
  );
}
