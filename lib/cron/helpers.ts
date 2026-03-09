import "server-only";

import { NextResponse } from "next/server";
import { logger } from "../logger";

/**
 * Validates cron request authentication using the CRON_SECRET header.
 * Returns null if valid, or a 401 response if invalid.
 */
export function validateCronAuth(request: Request): NextResponse | null {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    logger.warn("Cron request rejected: invalid or missing authorization", {
      hasHeader: Boolean(authHeader),
      hasSecret: Boolean(cronSecret)
    });

    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return null;
}

/**
 * Wraps a cron handler with structured logging and error recovery.
 * Catches unhandled exceptions and returns a 500 with details logged.
 */
export async function withCronErrorHandling(
  cronName: string,
  handler: () => Promise<NextResponse>
): Promise<NextResponse> {
  const startTime = Date.now();

  try {
    const result = await handler();
    const durationMs = Date.now() - startTime;

    logger.info(`Cron job completed: ${cronName}`, {
      cronName,
      durationMs,
      statusCode: 200
    });

    return result;
  } catch (error) {
    const durationMs = Date.now() - startTime;

    logger.error(`Cron job failed: ${cronName}`, {
      cronName,
      durationMs,
      error: error instanceof Error ? error.message : String(error)
    });

    return NextResponse.json(
      {
        error: `Cron job ${cronName} failed`,
        message: error instanceof Error ? error.message : "Unknown error"
      },
      { status: 500 }
    );
  }
}

/**
 * Retries an async operation with exponential backoff.
 * For use in cron jobs where transient failures (email, DB timeout) are expected.
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  options?: { maxAttempts?: number; label?: string }
): Promise<T> {
  const maxAttempts = options?.maxAttempts ?? 3;
  const label = options?.label ?? "operation";

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      if (attempt < maxAttempts) {
        const delayMs = Math.min(1000 * Math.pow(2, attempt - 1), 5000);

        logger.warn(`Retry ${attempt}/${maxAttempts} for ${label}`, {
          label,
          attempt,
          maxAttempts,
          delayMs,
          error: error instanceof Error ? error.message : String(error)
        });

        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  throw lastError;
}
