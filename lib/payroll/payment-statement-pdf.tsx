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

const styles = StyleSheet.create({
  page: {
    padding: 28,
    fontSize: 10,
    color: "#0F172A"
  },
  headerRow: {
    marginBottom: 14
  },
  brand: {
    fontSize: 16,
    fontWeight: 600
  },
  company: {
    fontSize: 11,
    marginTop: 2
  },
  docType: {
    marginTop: 8,
    fontSize: 12,
    fontWeight: 600
  },
  period: {
    marginTop: 2,
    color: "#475569"
  },
  section: {
    borderWidth: 1,
    borderColor: "#E2E8F0",
    borderRadius: 6,
    padding: 10,
    marginBottom: 10
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: 600,
    marginBottom: 6
  },
  metaGrid: {
    display: "flex",
    flexDirection: "row",
    flexWrap: "wrap",
    rowGap: 4,
    columnGap: 8
  },
  metaItem: {
    width: "48%"
  },
  metaLabel: {
    color: "#475569"
  },
  amountRow: {
    display: "flex",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 4
  },
  amountLabel: {
    color: "#0F172A"
  },
  amountValue: {
    fontWeight: 600
  },
  muted: {
    color: "#475569"
  },
  totalRow: {
    borderTopWidth: 1,
    borderTopColor: "#E2E8F0",
    marginTop: 6,
    paddingTop: 6,
    display: "flex",
    flexDirection: "row",
    justifyContent: "space-between"
  },
  paymentBox: {
    borderWidth: 1,
    borderColor: "#22C55E",
    backgroundColor: "#F0FDF4",
    borderRadius: 6,
    padding: 10,
    marginBottom: 10
  },
  paymentLabel: {
    color: "#15803D"
  },
  paymentAmount: {
    marginTop: 4,
    fontSize: 20,
    fontWeight: 600,
    color: "#15803D"
  },
  note: {
    color: "#475569"
  },
  footer: {
    borderTopWidth: 1,
    borderTopColor: "#E2E8F0",
    paddingTop: 8,
    color: "#64748B"
  }
});

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

function PaymentStatementDocument(props: PaymentStatementPdfInput) {
  const title = props.withholdingApplied ? "PAYSLIP" : "PAYMENT STATEMENT";

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.headerRow}>
          <Text style={styles.brand}>Crew Hub</Text>
          <Text style={styles.company}>{props.companyName}</Text>
          <Text style={styles.docType}>{title}</Text>
          <Text style={styles.period}>{props.periodLabel}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Contractor</Text>
          <View style={styles.metaGrid}>
            <View style={styles.metaItem}>
              <Text style={styles.metaLabel}>Name</Text>
              <Text>{props.contractorName}</Text>
            </View>
            <View style={styles.metaItem}>
              <Text style={styles.metaLabel}>Department</Text>
              <Text>{props.department ?? "--"}</Text>
            </View>
            <View style={styles.metaItem}>
              <Text style={styles.metaLabel}>Title</Text>
              <Text>{props.title ?? "--"}</Text>
            </View>
            <View style={styles.metaItem}>
              <Text style={styles.metaLabel}>Country</Text>
              <Text>{props.country ?? "--"}</Text>
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Earnings</Text>
          <View style={styles.amountRow}>
            <Text style={styles.amountLabel}>Base salary</Text>
            <Text style={styles.amountValue}>
              {formatAmount(props.baseSalaryAmount, props.currency)}
            </Text>
          </View>
          {props.allowances.map((allowance, index) => (
            <View key={`allowance-${index}`} style={styles.amountRow}>
              <Text style={styles.amountLabel}>{allowance.label}</Text>
              <Text style={styles.amountValue}>
                {formatAmount(allowance.amount, props.currency)}
              </Text>
            </View>
          ))}
          {props.adjustments.map((adjustment, index) => (
            <View key={`adjustment-${index}`} style={styles.amountRow}>
              <Text style={styles.amountLabel}>{adjustment.label}</Text>
              <Text style={styles.amountValue}>
                {formatAmount(adjustment.amount, props.currency)}
              </Text>
            </View>
          ))}
          <View style={styles.totalRow}>
            <Text style={styles.amountLabel}>Gross total</Text>
            <Text style={styles.amountValue}>
              {formatAmount(props.grossAmount, props.currency)}
            </Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Deductions</Text>
          {props.withholdingApplied ? (
            <>
              {props.deductions.map((deduction, index) => (
                <View key={`deduction-${index}`} style={styles.amountRow}>
                  <Text style={styles.amountLabel}>{deduction.label}</Text>
                  <Text style={styles.amountValue}>
                    {formatAmount(deduction.amount, props.currency)}
                  </Text>
                </View>
              ))}
              <View style={styles.totalRow}>
                <Text style={styles.amountLabel}>Total deductions</Text>
                <Text style={styles.amountValue}>
                  {formatAmount(props.deductionsTotal, props.currency)}
                </Text>
              </View>
            </>
          ) : (
            <>
              <Text style={styles.muted}>None (contractor -- taxes not withheld)</Text>
              <View style={styles.totalRow}>
                <Text style={styles.amountLabel}>Total deductions</Text>
                <Text style={styles.amountValue}>{formatAmount(0, props.currency)}</Text>
              </View>
            </>
          )}
        </View>

        <View style={styles.paymentBox}>
          <Text style={styles.paymentLabel}>PAYMENT AMOUNT</Text>
          <Text style={styles.paymentAmount}>
            {formatAmount(props.paymentAmount, props.currency)}
          </Text>
        </View>

        {!props.withholdingApplied ? (
          <View style={styles.section}>
            <Text style={styles.note}>
              This is a payment statement for contractor services. The recipient is responsible for their own tax obligations.
            </Text>
          </View>
        ) : null}

        <View style={styles.footer}>
          <Text>Payment reference: {props.paymentReference ?? "--"}</Text>
          <Text>Computer-generated document</Text>
        </View>
      </Page>
    </Document>
  );
}

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
