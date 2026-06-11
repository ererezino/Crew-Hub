import type { ReactNode } from "react";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";

import { pickMessages } from "../../lib/i18n/pick-messages";
import routeNamespaces from "../../lib/i18n/route-namespaces.generated.json";

type AreaName = keyof typeof routeNamespaces.areas;

/**
 * Per-area translation provider. Each (shell) area's layout wraps its pages
 * with this so the client only receives the namespaces that area uses
 * (17–56KB) instead of the full locale bundle (~250KB).
 *
 * The namespace sets live in lib/i18n/route-namespaces.generated.json and
 * are derived from the import graph by scripts/generate-route-namespaces.cjs.
 * Never hand-edit the map — regenerate it. A test fails when it drifts.
 *
 * Note: a nested NextIntlClientProvider REPLACES the parent's messages for
 * its subtree, so each area set is self-contained (the generator includes
 * every namespace the subtree references, plus shared chrome namespaces).
 */
export async function AreaMessages({
  area,
  children
}: {
  area: AreaName;
  children: ReactNode;
}) {
  const [locale, messages] = await Promise.all([getLocale(), getMessages()]);
  const namespaces = routeNamespaces.areas[area];

  return (
    <NextIntlClientProvider locale={locale} messages={pickMessages(messages, namespaces)}>
      {children}
    </NextIntlClientProvider>
  );
}
