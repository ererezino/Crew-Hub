/**
 * Structured logger for production use.
 *
 * Outputs JSON-formatted log lines with:
 * - timestamp
 * - level
 * - message
 * - correlation/request ID (when available)
 * - safe metadata (no PII by default)
 *
 * Usage:
 *   import { logger } from "@/lib/logger";
 *   logger.info("User created", { userId: "...", orgId: "..." });
 *   logger.error("Payment failed", { paymentId: "...", error: err.message });
 */

type LogLevel = "debug" | "info" | "warn" | "error";

type LogEntry = {
  timestamp: string;
  level: LogLevel;
  message: string;
  requestId?: string;
  [key: string]: unknown;
};

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3
};

const MIN_LEVEL: LogLevel =
  (process.env.LOG_LEVEL as LogLevel) || (process.env.NODE_ENV === "production" ? "info" : "debug");

/** PII-sensitive field names that should never be logged */
const REDACTED_FIELDS = new Set([
  "password",
  "currentPassword",
  "newPassword",
  "token",
  "secret",
  "apiKey",
  "authorization",
  "cookie",
  "ssn",
  "socialSecurityNumber",
  "bankAccount",
  "creditCard",
  "cvv"
]);

function redactSensitiveFields(
  data: Record<string, unknown>
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(data)) {
    if (REDACTED_FIELDS.has(key.toLowerCase())) {
      result[key] = "[REDACTED]";
    } else if (value && typeof value === "object" && !Array.isArray(value)) {
      result[key] = redactSensitiveFields(value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }

  return result;
}

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[MIN_LEVEL];
}

function formatEntry(
  level: LogLevel,
  message: string,
  meta?: Record<string, unknown>
): string {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...(meta ? redactSensitiveFields(meta) : {})
  };

  return JSON.stringify(entry);
}

export const logger = {
  debug(message: string, meta?: Record<string, unknown>) {
    if (shouldLog("debug")) {
      console.debug(formatEntry("debug", message, meta));
    }
  },

  info(message: string, meta?: Record<string, unknown>) {
    if (shouldLog("info")) {
      console.info(formatEntry("info", message, meta));
    }
  },

  warn(message: string, meta?: Record<string, unknown>) {
    if (shouldLog("warn")) {
      console.warn(formatEntry("warn", message, meta));
    }
  },

  error(message: string, meta?: Record<string, unknown>) {
    if (shouldLog("error")) {
      console.error(formatEntry("error", message, meta));
    }
  }
};
