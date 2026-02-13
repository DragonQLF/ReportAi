/**
 * Map over items with a maximum concurrency cap.
 * Like Promise.all but limits how many run simultaneously.
 *
 * Each worker picks up the next item as soon as it finishes its current one,
 * so the pool stays saturated without ever exceeding `concurrency` in-flight calls.
 */
export async function concurrentMap<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const i = nextIndex++;
      results[i] = await fn(items[i]);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
  );

  return results;
}
