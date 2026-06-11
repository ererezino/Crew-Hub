import type { AbstractIntlMessages } from "next-intl";

/**
 * Returns only the requested top-level namespaces from a full messages
 * object. Used to keep NextIntlClientProvider payloads small — the full
 * locale bundle is ~250KB and must never be shipped to the client whole.
 */
export function pickMessages(
  messages: AbstractIntlMessages,
  namespaces: readonly string[]
): AbstractIntlMessages {
  const picked: AbstractIntlMessages = {};

  for (const namespace of namespaces) {
    const value = messages[namespace];
    if (value !== undefined) {
      picked[namespace] = value;
    }
  }

  return picked;
}
