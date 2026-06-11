import type { Metadata } from "next";
import { DM_Sans, Playfair_Display } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";

import { EnvironmentBanner } from "../components/shared/environment-banner";
import { ThemeProvider } from "../components/shared/theme-provider";
import { pickMessages } from "../lib/i18n/pick-messages";
import routeNamespaces from "../lib/i18n/route-namespaces.generated.json";
import "./globals.css";

const playfair = Playfair_Display({
  subsets: ["latin"],
  weight: ["400", "700", "900"],
  style: ["normal", "italic"],
  variable: "--font-serif",
  display: "swap"
});

const dmSans = DM_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans",
  display: "swap"
});

export const metadata: Metadata = {
  title: "Crew Hub",
  description: "Crew Hub employee operations platform.",
  themeColor: "#1A2B3C",
  icons: {
    icon: [
      { url: "/favicon.ico?v=20260311a", sizes: "any" },
      { url: "/favicon-32x32.png?v=20260311a", type: "image/png", sizes: "32x32" },
      { url: "/favicon-16x16.png?v=20260311a", type: "image/png", sizes: "16x16" }
    ],
    shortcut: ["/favicon.ico?v=20260311a"],
    apple: [{ url: "/apple-touch-icon.png?v=20260311a", sizes: "180x180", type: "image/png" }]
  }
};

export default async function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocale();
  const messages = await getMessages();

  /* Ship only the shell namespaces (~10KB) to the client here — the app
   * chrome (sidebar, top bar, notifications) plus all routes outside
   * (shell). Each (shell) area provides its own namespaces via its
   * layout's AreaMessages wrapper, so the full ~250KB bundle is never
   * serialized into the RSC payload. Map: lib/i18n/route-namespaces.generated.json */
  const shellMessages = pickMessages(messages, routeNamespaces.shell);

  return (
    <html lang={locale} suppressHydrationWarning>
      <body className={`${playfair.variable} ${dmSans.variable}`}>
        <EnvironmentBanner />
        <NextIntlClientProvider locale={locale} messages={shellMessages}>
          <ThemeProvider>{children}</ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
