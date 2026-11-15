/** Bound network fan-out and settle all started work before returning a failure. */
export async function runBoundedTasks(tasks: Array<() => Promise<void>>, limit = 4): Promise<void> {
  if (!Number.isInteger(limit) || limit < 1) throw new Error('Invalid concurrency');
  let next = 0;
  let failed = false;
  let failure: unknown;
  await Promise.all(
    Array.from({ length: Math.min(limit, tasks.length) }, async () => {
      while (!failed && next < tasks.length) {
        const task = tasks[next++];
        try {
          await task();
        } catch (error) {
          if (!failed) failure = error;
          failed = true;
        }
      }
    })
  );
  if (failed) throw failure;
}
