import React from "react";
import path from "node:path";
import fs from "node:fs";
import { Image, Text, View, StyleSheet } from "@react-pdf/renderer";

/* ── Constants ── */

export const ACCRUE_ADDRESS = "611 South Dupont Highway, Dover, Delaware, USA";
export const ACCRUE_EMAIL = "leads@useaccrue.com";
export const ACCRUE_WEBSITE = "https://useaccrue.com";

/* ── Logo ── */

function getLogoDataUri(): string {
  const logoPath = path.join(process.cwd(), "public/brand/dark.png");
  const buffer = fs.readFileSync(logoPath);
  return `data:image/png;base64,${buffer.toString("base64")}`;
}

/* ── Shared Styles ── */

export const letterheadStyles = StyleSheet.create({
  headerContainer: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 20,
    paddingBottom: 12,
    borderBottomWidth: 1.5,
    borderBottomColor: "#0F172A"
  },
  logoImage: {
    width: 120,
    height: "auto"
  },
  companyInfo: {
    alignItems: "flex-end",
    gap: 2
  },
  companyAddress: {
    fontSize: 8,
    color: "#475569"
  },
  companyContact: {
    fontSize: 8,
    color: "#475569"
  },
  footerContainer: {
    borderTopWidth: 1,
    borderTopColor: "#CBD5E1",
    paddingTop: 8,
    marginTop: 16,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center"
  },
  footerText: {
    fontSize: 7,
    color: "#94A3B8"
  },
  footerAddress: {
    fontSize: 7,
    color: "#94A3B8"
  }
});

/* ── Letterhead Component ── */

export function AccrueLetterhead({ address }: { address?: string }) {
  const displayAddress = address ?? ACCRUE_ADDRESS;
  const addressLines = displayAddress.split(",").map((s) => s.trim());

  return (
    <View style={letterheadStyles.headerContainer}>
      {/* react-pdf Image does not support alt text props. */}
      {/* eslint-disable-next-line jsx-a11y/alt-text */}
      <Image src={getLogoDataUri()} style={letterheadStyles.logoImage} />
      <View style={letterheadStyles.companyInfo}>
        {addressLines.map((line, i) => (
          <Text key={i} style={letterheadStyles.companyAddress}>
            {line}
          </Text>
        ))}
        <Text style={letterheadStyles.companyContact}>
          {ACCRUE_EMAIL}
        </Text>
        <Text style={letterheadStyles.companyContact}>
          useaccrue.com
        </Text>
      </View>
    </View>
  );
}

/* ── Footer Component ── */

export function AccrueFooter({ note, address }: { note?: string; address?: string }) {
  const displayAddress = address ?? ACCRUE_ADDRESS;

  return (
    <View style={letterheadStyles.footerContainer}>
      <Text style={letterheadStyles.footerAddress}>
        {displayAddress} | {ACCRUE_EMAIL} | useaccrue.com
      </Text>
      {note ? (
        <Text style={letterheadStyles.footerText}>{note}</Text>
      ) : null}
    </View>
  );
}
