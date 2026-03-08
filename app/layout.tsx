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
        url: "/brand/icon-dark.png",
        type: "image/png",
        media: "(prefers-color-scheme: light)"
      },
      {
        url: "/brand/icon-light.png",
        type: "image/png",
        media: "(prefers-color-scheme: dark)"
      }
    ]
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
