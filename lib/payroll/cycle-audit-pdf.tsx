import React from "react";
import { Readable } from "node:stream";
import { Document, Page, Text, View, StyleSheet, pdf } from "@react-pdf/renderer";

import { formatCurrency } from "../format-currency";
import { AccrueFooter, AccrueLetterhead } from "../pdf/accrue-letterhead";
import type { PayrollCurrencyTotals, PayrollCycleApprovalSnapshot } from "../../types/payroll-runs";

type CycleAuditPdfInput = {
  companyName: string;
  cycleLabel: string;
  currency: string;
  targetPayDate: string | null;
  submittedAt: string;
  submittedByName: string;
  approvedAt: string | null;
  paidAt: string | null;
  paymentReference: string | null;
  paymentNote: string | null;
  snapshot: PayrollCycleApprovalSnapshot;
};

const SLATE_50 = "#F8FAFC";
const SLATE_100 = "#F1F5F9";
const SLATE_200 = "#E2E8F0";
const SLATE_400 = "#94A3B8";
const SLATE_700 = "#334155";
const SLATE_900 = "#0F172A";
const GREEN_50 = "#F0FDF4";
const GREEN_700 = "#15803D";

const styles = StyleSheet.create({
  page: {
    padding: 34,
    fontSize: 9,
    color: SLATE_900
  },
  header: {
    marginBottom: 18
  },
  title: {
    fontSize: 16,
    fontWeight: 700,
    marginBottom: 4
  },
  subtitle: {
    fontSize: 10,
    color: SLATE_700
  },
  metaGrid: {
    display: "flex",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 14
  },
  metaCard: {
    width: "48%",
    backgroundColor: SLATE_50,
    borderRadius: 6,
    padding: 10,
    borderWidth: 1,
    borderColor: SLATE_200
  },
  metaLabel: {
    fontSize: 8,
    color: SLATE_400,
    textTransform: "uppercase",
    marginBottom: 2
  },
  metaValue: {
    fontSize: 10,
    fontWeight: 600
  },
  summaryRow: {
    display: "flex",
    flexDirection: "row",
    gap: 8,
    marginBottom: 14
  },
  summaryCard: {
    flexGrow: 1,
    backgroundColor: GREEN_50,
    borderRadius: 6,
    padding: 10,
    borderWidth: 1,
    borderColor: GREEN_700
  },
  summaryLabel: {
    fontSize: 8,
    color: GREEN_700,
    textTransform: "uppercase",
    marginBottom: 2
  },
  summaryValue: {
    fontSize: 12,
    fontWeight: 700,
    color: GREEN_700
  },
  sectionTitle: {
    fontSize: 10,
    fontWeight: 700,
    marginBottom: 6
  },
  tableHeader: {
    display: "flex",
    flexDirection: "row",
    backgroundColor: SLATE_100,
    borderTopLeftRadius: 4,
    borderTopRightRadius: 4,
    paddingVertical: 6,
    paddingHorizontal: 6,
    borderWidth: 1,
    borderColor: SLATE_200
  },
  tableRow: {
    display: "flex",
    flexDirection: "row",
    paddingVertical: 6,
    paddingHorizontal: 6,
    borderBottomWidth: 1,
    borderBottomColor: SLATE_200,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderLeftColor: SLATE_200,
    borderRightColor: SLATE_200
  },
  colEmployee: { width: "25%" },
  colTitle: { width: "15%" },
  colAmounts: { width: "10%", textAlign: "right" },
  colNotes: { width: "20%" },
  tableHeaderText: {
    fontSize: 8,
    fontWeight: 700,
    color: SLATE_700
  },
  tableText: {
    fontSize: 8,
    color: SLATE_900
  },
  footerNotes: {
    marginTop: 12,
    padding: 10,
    backgroundColor: SLATE_50,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: SLATE_200
  },
  footerNotesTitle: {
    fontSize: 9,
    fontWeight: 700,
    marginBottom: 4
  }
});

function money(amount: number, currency: string) {
  return formatCurrency(amount / 100, currency);
}

function moneyTotals(
  totals: PayrollCurrencyTotals | null | undefined,
  fallbackCurrency: string,
  fallbackAmount: number
) {
  const entries = Object.entries(totals ?? {})
    .filter(([, amount]) => Number.isFinite(amount) && amount !== 0)
    .sort((left, right) => right[1] - left[1]);

  if (entries.length === 0) {
    return money(fallbackAmount, fallbackCurrency);
  }

  return entries.map(([currencyCode, amount]) => money(amount, currencyCode)).join(" | ");
}

function formatDate(value: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function CycleAuditDocument({
  companyName,
  cycleLabel,
  currency,
  targetPayDate,
  submittedAt,
  submittedByName,
  approvedAt,
  paidAt,
  paymentReference,
  paymentNote,
  snapshot
}: CycleAuditPdfInput) {
  return (
    <Document title={`${cycleLabel} Audit Pack`}>
      <Page size="A4" style={styles.page}>
        <AccrueLetterhead />

        <View style={styles.header}>
          <Text style={styles.title}>{cycleLabel} Audit Pack</Text>
          <Text style={styles.subtitle}>{companyName}</Text>
        </View>

        <View style={styles.metaGrid}>
          <View style={styles.metaCard}>
            <Text style={styles.metaLabel}>Target pay date</Text>
            <Text style={styles.metaValue}>{targetPayDate ?? "-"}</Text>
          </View>
          <View style={styles.metaCard}>
            <Text style={styles.metaLabel}>Submitted by</Text>
            <Text style={styles.metaValue}>{submittedByName}</Text>
          </View>
          <View style={styles.metaCard}>
            <Text style={styles.metaLabel}>Submitted at</Text>
            <Text style={styles.metaValue}>{formatDate(submittedAt)}</Text>
          </View>
          <View style={styles.metaCard}>
            <Text style={styles.metaLabel}>Approved at</Text>
            <Text style={styles.metaValue}>{formatDate(approvedAt)}</Text>
          </View>
          <View style={styles.metaCard}>
            <Text style={styles.metaLabel}>Paid at</Text>
            <Text style={styles.metaValue}>{formatDate(paidAt)}</Text>
          </View>
          <View style={styles.metaCard}>
            <Text style={styles.metaLabel}>Payment reference</Text>
            <Text style={styles.metaValue}>{paymentReference ?? "-"}</Text>
          </View>
        </View>

        <View style={styles.summaryRow}>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>Employees</Text>
            <Text style={styles.summaryValue}>{snapshot.employeeCount}</Text>
          </View>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>Total payable</Text>
            <Text style={styles.summaryValue}>
              {moneyTotals(snapshot.totalNetByCurrency, currency, snapshot.totalNet)}
            </Text>
          </View>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>Overtime</Text>
            <Text style={styles.summaryValue}>
              {moneyTotals(snapshot.totalOvertimeByCurrency, currency, snapshot.totalOvertime)}
            </Text>
          </View>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>Bonus / Fees</Text>
            <Text style={styles.summaryValue}>
              {moneyTotals(snapshot.totalBonusByCurrency, currency, snapshot.totalBonus)} / {moneyTotals(snapshot.totalFeesByCurrency, currency, snapshot.totalFees)}
            </Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>Approved cycle snapshot</Text>

        <View style={styles.tableHeader}>
          <Text style={[styles.tableHeaderText, styles.colEmployee]}>Employee</Text>
          <Text style={[styles.tableHeaderText, styles.colTitle]}>Designation</Text>
          <Text style={[styles.tableHeaderText, styles.colAmounts]}>Cycle</Text>
          <Text style={[styles.tableHeaderText, styles.colAmounts]}>OT</Text>
          <Text style={[styles.tableHeaderText, styles.colAmounts]}>Bonus</Text>
          <Text style={[styles.tableHeaderText, styles.colAmounts]}>Fees</Text>
          <Text style={[styles.tableHeaderText, styles.colAmounts]}>Final</Text>
          <Text style={[styles.tableHeaderText, styles.colNotes]}>Notes</Text>
        </View>
        {snapshot.rows.map((row) => (
          <View key={row.employeeId} style={styles.tableRow}>
            <Text style={[styles.tableText, styles.colEmployee]}>{row.employeeName}</Text>
            <Text style={[styles.tableText, styles.colTitle]}>{row.designation ?? "-"}</Text>
            <Text style={[styles.tableText, styles.colAmounts]}>{money(row.cycleBaseAmount, row.currency ?? currency)}</Text>
            <Text style={[styles.tableText, styles.colAmounts]}>{money(row.overtimeAmount, row.currency ?? currency)}</Text>
            <Text style={[styles.tableText, styles.colAmounts]}>{money(row.bonus, row.currency ?? currency)}</Text>
            <Text style={[styles.tableText, styles.colAmounts]}>{money(row.fees, row.currency ?? currency)}</Text>
            <Text style={[styles.tableText, styles.colAmounts]}>{money(row.finalPayable, row.currency ?? currency)}</Text>
            <Text style={[styles.tableText, styles.colNotes]}>
              {[row.comment, row.exceptionReason].filter(Boolean).join(" | ") || "-"}
            </Text>
          </View>
        ))}

        {paymentNote ? (
          <View style={styles.footerNotes}>
            <Text style={styles.footerNotesTitle}>Payment note</Text>
            <Text style={styles.tableText}>{paymentNote}</Text>
          </View>
        ) : null}

        <AccrueFooter />
      </Page>
    </Document>
  );
}

function isWebReadableStream(value: unknown): value is ReadableStream<Uint8Array> {
  return typeof value === "object" && value !== null && "getReader" in value;
}

async function readNodeReadableStream(stream: Readable): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk));
  }
  return mergeChunks(chunks);
}

async function readWebReadableStream(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }

  return mergeChunks(chunks);
}

function mergeChunks(chunks: Uint8Array[]): Uint8Array {
  const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const merged = new Uint8Array(length);
  let offset = 0;

  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }

  return merged;
}

export async function renderPayrollCycleAuditPdf(input: CycleAuditPdfInput): Promise<Uint8Array> {
  const instance = pdf(<CycleAuditDocument {...input} />);
  const fileBuffer = await instance.toBuffer();

  if (fileBuffer instanceof Uint8Array) {
    return fileBuffer;
  }

  if (fileBuffer instanceof ArrayBuffer) {
    return new Uint8Array(fileBuffer);
  }

  if (fileBuffer instanceof Readable) {
    return readNodeReadableStream(fileBuffer);
  }

  if (isWebReadableStream(fileBuffer)) {
    return readWebReadableStream(fileBuffer);
  }

  throw new Error("Payroll cycle PDF output could not be converted to bytes.");
}
