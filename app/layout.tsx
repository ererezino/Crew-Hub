import type { Metadata } from "next";
import { DM_Sans, Playfair_Display } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";

import { ThemeProvider } from "../components/shared/theme-provider";
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

  return (
    <html lang={locale} suppressHydrationWarning>
      <body className={`${playfair.variable} ${dmSans.variable}`}>
        <NextIntlClientProvider messages={messages}>
          <ThemeProvider>{children}</ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
