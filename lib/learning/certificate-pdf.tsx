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

type LearningCertificatePdfInput = {
  orgName: string;
  employeeName: string;
  courseTitle: string;
  completionDateLabel: string;
  certificateId: string;
};

const styles = StyleSheet.create({
  page: {
    padding: 36,
    fontSize: 12,
    color: "#0F172A",
    borderWidth: 2,
    borderColor: "#E2E8F0"
  },
  brand: {
    fontSize: 18,
    fontWeight: 600,
    marginBottom: 16
  },
  title: {
    fontSize: 22,
    fontWeight: 600,
    marginBottom: 8
  },
  subtitle: {
    fontSize: 13,
    color: "#475569",
    marginBottom: 22
  },
  recipientName: {
    fontSize: 26,
    fontWeight: 600,
    marginBottom: 14
  },
  content: {
    fontSize: 13,
    lineHeight: 1.5,
    marginBottom: 20
  },
  courseTitle: {
    fontSize: 16,
    fontWeight: 600,
    marginBottom: 14
  },
  footer: {
    marginTop: "auto",
    borderTopWidth: 1,
    borderTopColor: "#E2E8F0",
    paddingTop: 8,
    fontSize: 10,
    color: "#64748B"
  }
});

function LearningCertificateDocument({
  orgName,
  employeeName,
  courseTitle,
  completionDateLabel,
  certificateId
}: LearningCertificatePdfInput) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.brand}>Crew Hub</Text>
        <Text style={styles.title}>Certificate of Completion</Text>
        <Text style={styles.subtitle}>{orgName}</Text>

        <View>
          <Text style={styles.content}>This certifies that</Text>
          <Text style={styles.recipientName}>{employeeName}</Text>
          <Text style={styles.content}>has successfully completed the following training course:</Text>
          <Text style={styles.courseTitle}>{courseTitle}</Text>
          <Text style={styles.content}>Completion date: {completionDateLabel}</Text>
        </View>

        <View style={styles.footer}>
          <Text>Certificate ID: {certificateId}</Text>
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

export async function renderLearningCertificatePdf(
  input: LearningCertificatePdfInput
): Promise<Uint8Array> {
  const instance = pdf(<LearningCertificateDocument {...input} />);
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

  throw new Error("Certificate PDF output could not be converted to bytes.");
}
