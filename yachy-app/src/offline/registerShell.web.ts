export async function registerOfflineShell(): Promise<boolean> {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return false;
  try {
    await navigator.serviceWorker.register('/offline-worker.js', {
      scope: '/',
      updateViaCache: 'none',
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const registration = await Promise.race([
        navigator.serviceWorker.ready,
        new Promise<null>((resolve) => {
          timer = setTimeout(() => resolve(null), 30_000);
        }),
      ]);
      return !!registration?.active;
    } finally {
      if (timer) clearTimeout(timer);
    }
  } catch {
    return false;
  }
}
