/** Bound a read-only access check even when the auth SDK waits for its refresh lock. */
export async function boundedCheck<T>(operation: PromiseLike<T>, milliseconds = 15000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve(operation),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('ONLINE_CHECK_UNAVAILABLE')), milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
