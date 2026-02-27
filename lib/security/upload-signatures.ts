const PDF_SIGNATURE = [0x25, 0x50, 0x44, 0x46];
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];
const ZIP_SIGNATURES = [
  [0x50, 0x4b, 0x03, 0x04],
  [0x50, 0x4b, 0x05, 0x06],
  [0x50, 0x4b, 0x07, 0x08]
] as const;
const OLE_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

type SignatureFamily = "pdf" | "png" | "jpeg" | "zip" | "ole" | "unknown";

export type MagicBytesValidationResult = {
  valid: boolean;
  extension: string;
  detectedFamily: SignatureFamily;
  message: string | null;
};

function extensionFromFileName(fileName: string): string {
  const segments = fileName.trim().toLowerCase().split(".");
  return segments.length > 1 ? segments[segments.length - 1] ?? "" : "";
}

function matchesSignature(bytes: Uint8Array, signature: readonly number[]): boolean {
  if (bytes.length < signature.length) {
    return false;
  }

  return signature.every((value, index) => bytes[index] === value);
}

function detectFamily(bytes: Uint8Array): SignatureFamily {
  if (matchesSignature(bytes, PDF_SIGNATURE)) {
    return "pdf";
  }

  if (matchesSignature(bytes, PNG_SIGNATURE)) {
    return "png";
  }

  if (matchesSignature(bytes, JPEG_SIGNATURE)) {
    return "jpeg";
  }

  if (ZIP_SIGNATURES.some((signature) => matchesSignature(bytes, signature))) {
    return "zip";
  }

  if (matchesSignature(bytes, OLE_SIGNATURE)) {
    return "ole";
  }

  return "unknown";
}

function expectedFamilyForExtension(extension: string): SignatureFamily {
  switch (extension) {
    case "pdf":
      return "pdf";
    case "png":
      return "png";
    case "jpg":
    case "jpeg":
      return "jpeg";
    case "docx":
    case "xlsx":
      return "zip";
    case "doc":
    case "xls":
      return "ole";
    default:
      return "unknown";
  }
}

export async function validateUploadMagicBytes({
  file,
  fileName,
  allowedExtensions
}: {
  file: File;
  fileName: string;
  allowedExtensions: readonly string[];
}): Promise<MagicBytesValidationResult> {
  const extension = extensionFromFileName(fileName);

  if (!allowedExtensions.includes(extension)) {
    return {
      valid: false,
      extension,
      detectedFamily: "unknown",
      message: "File extension is not allowed."
    };
  }

  const expectedFamily = expectedFamilyForExtension(extension);

  if (expectedFamily === "unknown") {
    return {
      valid: false,
      extension,
      detectedFamily: "unknown",
      message: "Unable to validate this file extension."
    };
  }

  const signatureSlice = file.slice(0, 16);
  const bytes = new Uint8Array(await signatureSlice.arrayBuffer());
  const detectedFamily = detectFamily(bytes);

  if (detectedFamily !== expectedFamily) {
    return {
      valid: false,
      extension,
      detectedFamily,
      message: "Uploaded file signature does not match its extension."
    };
  }

  return {
    valid: true,
    extension,
    detectedFamily,
    message: null
  };
}
