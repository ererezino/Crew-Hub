"use client";

const RETRY_DELAY_MS = 2000;
const MAX_RETRY_COUNT = 1;

/**
 * Fetch with automatic retry on network failures.
 *
 * 1. On a network error (not 4xx/5xx): wait 2 seconds, retry once.
 * 2. If the retry also fails: throw the error for the caller to handle.
 * 3. Server errors (4xx/5xx) are NOT retried — they're returned as-is.
 *
 * Usage inside useEffect:
 *   const response = await fetchWithRetry(endpoint, abortController.signal);
 */
export async function fetchWithRetry(
  endpoint: string,
  signal: AbortSignal,
  retryCount = 0
): Promise<Response> {
  try {
    return await fetch(endpoint, { method: "GET", signal });
  } catch (error) {
    if (signal.aborted) {
      throw error;
    }

    // Only retry on network errors (TypeError from fetch), not other failures
    if (error instanceof TypeError && retryCount < MAX_RETRY_COUNT) {
      await new Promise<void>((resolve) => {
        const timeoutId = setTimeout(resolve, RETRY_DELAY_MS);

        // Clean up timeout if signal is aborted while waiting
        const onAbort = () => {
          clearTimeout(timeoutId);
          resolve();
        };

        signal.addEventListener("abort", onAbort, { once: true });
      });

      if (signal.aborted) {
        throw new DOMException("The operation was aborted.", "AbortError");
      }

      return fetchWithRetry(endpoint, signal, retryCount + 1);
    }

    throw error;
  }
}
