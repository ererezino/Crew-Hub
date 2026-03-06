import type { Metadata } from "next";
import { DM_Sans, Playfair_Display } from "next/font/google";

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
  icons: {
    icon: [
      {
        url: "/brand/crew-hub-app-logo.svg",
        media: "(prefers-color-scheme: light)"
      },
      {
        url: "/brand/crew-hub-site-logo.svg",
        media: "(prefers-color-scheme: dark)"
      }
    ],
    shortcut: [
      {
        url: "/brand/crew-hub-app-logo.svg",
        media: "(prefers-color-scheme: light)"
      },
      {
        url: "/brand/crew-hub-site-logo.svg",
        media: "(prefers-color-scheme: dark)"
      }
    ],
    apple: "/brand/crew-hub-app-logo.svg"
  }
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${playfair.variable} ${dmSans.variable}`}>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
