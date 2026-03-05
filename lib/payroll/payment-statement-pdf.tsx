import React from "react";
import { Readable } from "node:stream";
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  pdf
} from "@react-pdf/renderer";
import { AccrueLetterhead, AccrueFooter } from "../pdf/accrue-letterhead";

type StatementLineItem = {
  label: string;
  amount: number;
};

type StatementDeductionItem = {
  label: string;
  amount: number;
};

type PaymentStatementPdfInput = {
  companyName: string;
  periodLabel: string;
  contractorName: string;
  department: string | null;
  title: string | null;
  country: string | null;
  baseSalaryAmount: number;
  allowances: StatementLineItem[];
  adjustments: StatementLineItem[];
  grossAmount: number;
  deductions: StatementDeductionItem[];
  deductionsTotal: number;
  paymentAmount: number;
  currency: string;
  paymentReference: string | null;
  withholdingApplied: boolean;
};

/* ── Styles ── */

const SLATE_50 = "#F8FAFC";
const SLATE_100 = "#F1F5F9";
const SLATE_200 = "#E2E8F0";
const SLATE_500 = "#64748B";
const SLATE_700 = "#334155";
const SLATE_900 = "#0F172A";
const GREEN_50 = "#F0FDF4";
const GREEN_600 = "#16A34A";
const GREEN_800 = "#166534";
const BRAND_DARK = "#0F172A";

const styles = StyleSheet.create({
  page: {
    padding: 40,
    fontSize: 10,
    color: SLATE_900
  },

  /* ── Header ── */
  docHeader: {
    marginBottom: 24
  },
  docType: {
    fontSize: 14,
    fontWeight: 700,
    letterSpacing: 1,
    color: BRAND_DARK
  },
  periodText: {
    marginTop: 3,
    fontSize: 10,
    color: SLATE_500
  },

  /* ── Employee Section ── */
  employeeSection: {
    backgroundColor: SLATE_50,
    borderRadius: 6,
    padding: 14,
    marginBottom: 16
  },
  employeeSectionHeader: {
    fontSize: 9,
    fontWeight: 700,
    color: SLATE_500,
    letterSpacing: 0.5,
    marginBottom: 10,
    textTransform: "uppercase" as const
  },
  metaGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    rowGap: 10,
    columnGap: 8
  },
  metaItem: {
    width: "48%"
  },
  metaLabel: {
    fontSize: 8,
    color: SLATE_500,
    marginBottom: 2
  },
  metaValue: {
    fontSize: 10,
    fontWeight: 600,
    color: SLATE_900
  },

  /* ── Table Sections ── */
  tableSection: {
    marginBottom: 16
  },
  tableSectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: SLATE_100,
    borderRadius: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginBottom: 4
  },
  tableSectionTitle: {
    fontSize: 10,
    fontWeight: 700,
    color: SLATE_700
  },
  tableSectionTotal: {
    fontSize: 10,
    fontWeight: 700,
    color: SLATE_900
  },
  tableRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderBottomWidth: 0.5,
    borderBottomColor: SLATE_200
  },
  tableRowLabel: {
    fontSize: 9.5,
    color: SLATE_700
  },
  tableRowValue: {
    fontSize: 9.5,
    fontWeight: 600,
    color: SLATE_900
  },

  /* ── Net Pay ── */
  netPayBox: {
    backgroundColor: GREEN_50,
    borderWidth: 1.5,
    borderColor: GREEN_600,
    borderRadius: 8,
    padding: 16,
    marginBottom: 20,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center"
  },
  netPayLabel: {
    fontSize: 10,
    fontWeight: 700,
    color: GREEN_800,
    letterSpacing: 0.5
  },
  netPayAmount: {
    fontSize: 22,
    fontWeight: 700,
    color: GREEN_800
  },

  /* ── Footer ── */
  paymentRef: {
    fontSize: 8,
    color: SLATE_500,
    marginBottom: 4
  },
  contractorNote: {
    fontSize: 8,
    color: SLATE_500,
    fontStyle: "italic",
    marginBottom: 12
  }
});

/* ── Helpers ── */

function formatAmount(amount: number, currency: string): string {
  const normalizedCurrency = currency.trim().toUpperCase() || "USD";
  const majorAmount = amount / 100;

  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: normalizedCurrency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(majorAmount);
  } catch {
    return `${normalizedCurrency} ${majorAmount.toFixed(2)}`;
  }
}

/* ── Document ── */

function PaymentStatementDocument(props: PaymentStatementPdfInput) {
  const docTitle = props.withholdingApplied ? "PAYSLIP" : "PAYMENT STATEMENT";
  const personLabel = props.withholdingApplied ? "Employee" : "Contractor";

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <AccrueLetterhead />

        <View style={styles.docHeader}>
          <Text style={styles.docType}>{docTitle}</Text>
          <Text style={styles.periodText}>{props.periodLabel}</Text>
        </View>

        {/* Employee / Contractor Details */}
        <View style={styles.employeeSection}>
          <Text style={styles.employeeSectionHeader}>{personLabel} Details</Text>
          <View style={styles.metaGrid}>
            <View style={styles.metaItem}>
              <Text style={styles.metaLabel}>Name</Text>
              <Text style={styles.metaValue}>{props.contractorName}</Text>
            </View>
            <View style={styles.metaItem}>
              <Text style={styles.metaLabel}>Department</Text>
              <Text style={styles.metaValue}>{props.department ?? "—"}</Text>
            </View>
            <View style={styles.metaItem}>
              <Text style={styles.metaLabel}>Title</Text>
              <Text style={styles.metaValue}>{props.title ?? "—"}</Text>
            </View>
            <View style={styles.metaItem}>
              <Text style={styles.metaLabel}>Country</Text>
              <Text style={styles.metaValue}>{props.country ?? "—"}</Text>
            </View>
          </View>
        </View>

        {/* Earnings */}
        <View style={styles.tableSection}>
          <View style={styles.tableSectionHeader}>
            <Text style={styles.tableSectionTitle}>Earnings</Text>
            <Text style={styles.tableSectionTotal}>
              {formatAmount(props.grossAmount, props.currency)}
            </Text>
          </View>
          <View style={styles.tableRow}>
            <Text style={styles.tableRowLabel}>Base salary</Text>
            <Text style={styles.tableRowValue}>
              {formatAmount(props.baseSalaryAmount, props.currency)}
            </Text>
          </View>
          {props.allowances.map((item, i) => (
            <View key={`a-${i}`} style={styles.tableRow}>
              <Text style={styles.tableRowLabel}>{item.label}</Text>
              <Text style={styles.tableRowValue}>
                {formatAmount(item.amount, props.currency)}
              </Text>
            </View>
          ))}
          {props.adjustments.map((item, i) => (
            <View key={`adj-${i}`} style={styles.tableRow}>
              <Text style={styles.tableRowLabel}>{item.label}</Text>
              <Text style={styles.tableRowValue}>
                {formatAmount(item.amount, props.currency)}
              </Text>
            </View>
          ))}
        </View>

        {/* Deductions */}
        <View style={styles.tableSection}>
          <View style={styles.tableSectionHeader}>
            <Text style={styles.tableSectionTitle}>Deductions</Text>
            <Text style={styles.tableSectionTotal}>
              {formatAmount(props.deductionsTotal, props.currency)}
            </Text>
          </View>
          {props.withholdingApplied ? (
            props.deductions.map((item, i) => (
              <View key={`d-${i}`} style={styles.tableRow}>
                <Text style={styles.tableRowLabel}>{item.label}</Text>
                <Text style={styles.tableRowValue}>
                  {formatAmount(item.amount, props.currency)}
                </Text>
              </View>
            ))
          ) : (
            <View style={styles.tableRow}>
              <Text style={{ ...styles.tableRowLabel, fontStyle: "italic" }}>
                None — taxes not withheld
              </Text>
              <Text style={styles.tableRowValue}>
                {formatAmount(0, props.currency)}
              </Text>
            </View>
          )}
        </View>

        {/* Net Pay */}
        <View style={styles.netPayBox}>
          <Text style={styles.netPayLabel}>NET PAY</Text>
          <Text style={styles.netPayAmount}>
            {formatAmount(props.paymentAmount, props.currency)}
          </Text>
        </View>

        {!props.withholdingApplied ? (
          <Text style={styles.contractorNote}>
            This is a payment statement for contractor services. The recipient is
            responsible for their own tax obligations.
          </Text>
        ) : null}

        {props.paymentReference ? (
          <Text style={styles.paymentRef}>
            Payment reference: {props.paymentReference}
          </Text>
        ) : null}

        <AccrueFooter note="Computer-generated document" />
      </Page>
    </Document>
  );
}

/* ── Stream Utilities ── */

function mergeChunks(chunks: Uint8Array[]): Uint8Array {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const merged = new Uint8Array(totalLength);
  let offset = 0;

  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }

  return merged;
}

function isWebReadableStream(value: unknown): value is ReadableStream<Uint8Array> {
  return (
    typeof value === "object" &&
    value !== null &&
    "getReader" in value &&
    typeof (value as { getReader?: unknown }).getReader === "function"
  );
}

async function readWebReadableStream(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    if (value) {
      chunks.push(value);
    }
  }

  return mergeChunks(chunks);
}

async function readNodeReadableStream(stream: Readable): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];

  for await (const chunk of stream) {
    if (typeof chunk === "string") {
      chunks.push(new TextEncoder().encode(chunk));
      continue;
    }

    chunks.push(chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk));
  }

  return mergeChunks(chunks);
}

export async function renderPaymentStatementPdf(
  input: PaymentStatementPdfInput
): Promise<Uint8Array> {
  const instance = pdf(<PaymentStatementDocument {...input} />);
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

  throw new Error("Payment statement PDF output could not be converted to bytes.");
}
