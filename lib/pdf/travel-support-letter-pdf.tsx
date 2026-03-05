import React from "react";
import path from "node:path";
import { Readable } from "node:stream";
import {
  Document,
  Font,
  Page,
  Text,
  View,
  StyleSheet,
  pdf
} from "@react-pdf/renderer";
import { AccrueLetterhead, AccrueFooter, ACCRUE_EMAIL } from "./accrue-letterhead";

/* ── Font Registration ── */

Font.register({
  family: "GreatVibes",
  src: path.join(process.cwd(), "public/fonts/GreatVibes-Regular.ttf")
});

/* ── Types ── */

export type TravelSupportLetterPdfInput = {
  employeeName: string;
  jobTitle: string | null;
  department: string | null;
  startDate: string | null;
  destinationCountry: string;
  embassyName: string;
  embassyAddress: string | null;
  travelStartDate: string;
  travelEndDate: string;
  purpose: string;
  approverName: string;
  approverTitle: string | null;
  issueDate: string;
  entityAddress: string | null;
};

/* ── Styles ── */

const styles = StyleSheet.create({
  page: {
    padding: 40,
    fontSize: 11,
    color: "#0F172A",
    lineHeight: 1.6
  },
  date: {
    marginBottom: 20,
    fontSize: 10,
    color: "#475569"
  },
  recipientBlock: {
    marginBottom: 20
  },
  recipientLine: {
    fontSize: 10
  },
  subject: {
    marginBottom: 16,
    fontSize: 11,
    fontWeight: 700,
    textDecoration: "underline"
  },
  bodyParagraph: {
    marginBottom: 12,
    fontSize: 10,
    textAlign: "justify"
  },
  closingBlock: {
    marginTop: 20
  },
  closingText: {
    fontSize: 10,
    marginBottom: 4
  },
  signatureName: {
    fontFamily: "GreatVibes",
    fontSize: 24,
    color: "#1E3A5F",
    marginBottom: 12
  },
  signatureTitle: {
    fontSize: 9,
    color: "#475569"
  },
  contactNote: {
    marginTop: 24,
    fontSize: 9,
    color: "#64748B",
    fontStyle: "italic"
  }
});

/* ── Helpers ── */

function formatLetterDate(dateString: string): string {
  try {
    const date = new Date(`${dateString}T00:00:00.000Z`);
    return date.toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
      timeZone: "UTC"
    });
  } catch {
    return dateString;
  }
}

function formatStartDate(dateString: string | null): string {
  if (!dateString) return "a date prior to this letter";
  return formatLetterDate(dateString);
}

/* ── Document Component ── */

function TravelSupportLetterDocument(props: TravelSupportLetterPdfInput) {
  const titleText = props.jobTitle ? ` as a ${props.jobTitle}` : "";
  const deptText = props.department ? ` in the ${props.department} department` : "";
  const sinceText = formatStartDate(props.startDate);

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <AccrueLetterhead address={props.entityAddress ?? undefined} />

        <Text style={styles.date}>{props.issueDate}</Text>

        <View style={styles.recipientBlock}>
          <Text style={styles.recipientLine}>{props.embassyName}</Text>
          {props.embassyAddress ? (
            <Text style={styles.recipientLine}>{props.embassyAddress}</Text>
          ) : null}
        </View>

        <Text style={styles.subject}>
          RE: TRAVEL SUPPORT LETTER FOR {props.employeeName.toUpperCase()}
        </Text>

        <Text style={styles.bodyParagraph}>Dear Sir/Madam,</Text>

        <Text style={styles.bodyParagraph}>
          This letter is to confirm that {props.employeeName} is currently employed at
          Accrue{titleText}{deptText} since {sinceText}.
        </Text>

        <Text style={styles.bodyParagraph}>
          {props.employeeName} will be traveling to {props.destinationCountry} from{" "}
          {formatLetterDate(props.travelStartDate)} to{" "}
          {formatLetterDate(props.travelEndDate)} for the following purpose:{" "}
          {props.purpose}.
        </Text>

        <Text style={styles.bodyParagraph}>
          We kindly request that you grant {props.employeeName} the necessary travel
          documentation and/or visa to facilitate this trip. Accrue fully supports this
          travel and confirms that {props.employeeName} will continue to be employed upon
          their return.
        </Text>

        <Text style={styles.bodyParagraph}>
          Should you require any further information or verification, please do not
          hesitate to contact us at {ACCRUE_EMAIL}.
        </Text>

        <View style={styles.closingBlock}>
          <Text style={styles.closingText}>Yours faithfully,</Text>
          <Text style={styles.signatureName}>{props.approverName}</Text>
          <Text style={styles.signatureTitle}>
            {props.approverTitle ?? "Co-founder"}, Accrue
          </Text>
        </View>

        <AccrueFooter address={props.entityAddress ?? undefined} />
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

/* ── Export ── */

export async function renderTravelSupportLetterPdf(
  input: TravelSupportLetterPdfInput
): Promise<Uint8Array> {
  const instance = pdf(<TravelSupportLetterDocument {...input} />);
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

  throw new Error("Travel support letter PDF output could not be converted to bytes.");
}
