import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";

import { ThemeProvider } from "../components/shared/theme-provider";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter"
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono"
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
      <body className={`${inter.variable} ${jetbrainsMono.variable}`}>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
