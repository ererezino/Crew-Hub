import {
  EXPENSE_CATEGORIES,
  EXPENSE_TYPES,
  VENDOR_PAYMENT_METHODS,
  type ExpenseCategory,
  type ExpenseType,
  type VendorPaymentMethod
} from "../../types/expenses";

export const EXPENSE_CSV_IMPORT_HEADERS = [
  "expense_type",
  "category",
  "custom_category",
  "description",
  "amount",
  "currency",
  "expense_date",
  "vendor_name",
  "vendor_payment_method",
  "vendor_bank_account_name",
  "vendor_bank_account_number",
  "vendor_mobile_money_provider",
  "vendor_mobile_money_number",
  "vendor_crew_tag",
  "vendor_wire_bank_name",
  "vendor_wire_account_number",
  "vendor_wire_swift_bic",
  "vendor_wire_iban",
  "vendor_wire_bank_country",
  "vendor_wire_currency"
] as const;

export type ExpenseCsvImportRow = {
  rowNumber: number;
  expenseType: string;
  category: string;
  customCategory: string;
  description: string;
  amount: string;
  currency: string;
  expenseDate: string;
  vendorName: string;
  vendorPaymentMethod: string;
  vendorBankAccountName: string;
  vendorBankAccountNumber: string;
  vendorMobileMoneyProvider: string;
  vendorMobileMoneyNumber: string;
  vendorCrewTag: string;
  vendorWireBankName: string;
  vendorWireAccountNumber: string;
  vendorWireSwiftBic: string;
  vendorWireIban: string;
  vendorWireBankCountry: string;
  vendorWireCurrency: string;
};

export type ExpenseCsvImportResult = {
  rows: ExpenseCsvImportRow[];
  errors: string[];
};

function normalizeToken(value: string): string {
  return value.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function parseCsvDocument(text: string): string[][] {
  const rows: string[][] = [];
  const normalized = text.replace(/^\uFEFF/, "");
  let currentField = "";
  let currentRow: string[] = [];
  let inQuotes = false;

  for (let index = 0; index < normalized.length; index += 1) {
    const character = normalized[index] ?? "";

    if (character === "\"") {
      if (inQuotes && normalized[index + 1] === "\"") {
        currentField += "\"";
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (character === "," && !inQuotes) {
      currentRow.push(currentField);
      currentField = "";
      continue;
    }

    if ((character === "\n" || character === "\r") && !inQuotes) {
      if (character === "\r" && normalized[index + 1] === "\n") {
        index += 1;
      }

      currentRow.push(currentField);
      rows.push(currentRow);
      currentRow = [];
      currentField = "";
      continue;
    }

    currentField += character;
  }

  if (currentField.length > 0 || currentRow.length > 0) {
    currentRow.push(currentField);
    rows.push(currentRow);
  }

  return rows;
}

function getField(
  row: readonly string[],
  headerIndexByKey: ReadonlyMap<string, number>,
  key: (typeof EXPENSE_CSV_IMPORT_HEADERS)[number]
): string {
  const index = headerIndexByKey.get(key);
  return index === undefined ? "" : (row[index] ?? "").trim();
}

function isEmptyDataRow(row: readonly string[]): boolean {
  return row.every((value) => value.trim().length === 0);
}

function normalizeExpenseType(value: string): string {
  const token = normalizeToken(value);
  return token.length === 0 ? "work_expense" : token;
}

function normalizeExpenseCategory(value: string): string {
  return normalizeToken(value);
}

function normalizeVendorPaymentMethod(value: string): string {
  const token = normalizeToken(value);
  return token.length === 0 ? "bank_transfer" : token;
}

function isValidExpenseType(value: string): value is ExpenseType {
  return EXPENSE_TYPES.includes(value as ExpenseType);
}

function isValidExpenseCategory(value: string): value is ExpenseCategory {
  return EXPENSE_CATEGORIES.includes(value as ExpenseCategory);
}

function isValidVendorPaymentMethod(value: string): value is VendorPaymentMethod {
  return VENDOR_PAYMENT_METHODS.includes(value as VendorPaymentMethod);
}

export function parseExpenseImportCsv(text: string): ExpenseCsvImportResult {
  const rawRows = parseCsvDocument(text)
    .map((row) => row.map((cell) => cell.trim()))
    .filter((row, index) => index === 0 || !isEmptyDataRow(row));

  if (rawRows.length === 0) {
    return {
      rows: [],
      errors: ["The CSV file is empty."]
    };
  }

  if (rawRows.length === 1) {
    return {
      rows: [],
      errors: ["The CSV file does not contain any expense rows."]
    };
  }

  const headerIndexByKey = new Map<string, number>();
  rawRows[0]?.forEach((header, index) => {
    const normalizedHeader = normalizeToken(header);
    if (normalizedHeader.length > 0) {
      headerIndexByKey.set(normalizedHeader, index);
    }
  });

  const requiredHeaders = ["category", "description", "amount", "currency", "expense_date"];
  const missingHeaders = requiredHeaders.filter((header) => !headerIndexByKey.has(header));

  if (missingHeaders.length > 0) {
    return {
      rows: [],
      errors: [
        `Missing required CSV columns: ${missingHeaders.join(", ")}.`
      ]
    };
  }

  const rows: ExpenseCsvImportRow[] = [];
  const errors: string[] = [];

  rawRows.slice(1).forEach((row, index) => {
    const rowNumber = index + 2;
    const expenseType = normalizeExpenseType(getField(row, headerIndexByKey, "expense_type"));
    const category = normalizeExpenseCategory(getField(row, headerIndexByKey, "category"));
    const vendorPaymentMethod = normalizeVendorPaymentMethod(
      getField(row, headerIndexByKey, "vendor_payment_method")
    );

    if (!isValidExpenseType(expenseType)) {
      errors.push(`Row ${rowNumber}: unknown expense_type "${getField(row, headerIndexByKey, "expense_type")}".`);
      return;
    }

    if (!isValidExpenseCategory(category)) {
      errors.push(`Row ${rowNumber}: unknown category "${getField(row, headerIndexByKey, "category")}".`);
      return;
    }

    if (!isValidVendorPaymentMethod(vendorPaymentMethod)) {
      errors.push(
        `Row ${rowNumber}: unknown vendor_payment_method "${getField(row, headerIndexByKey, "vendor_payment_method")}".`
      );
      return;
    }

    rows.push({
      rowNumber,
      expenseType,
      category,
      customCategory: getField(row, headerIndexByKey, "custom_category"),
      description: getField(row, headerIndexByKey, "description"),
      amount: getField(row, headerIndexByKey, "amount"),
      currency: getField(row, headerIndexByKey, "currency").toUpperCase(),
      expenseDate: getField(row, headerIndexByKey, "expense_date"),
      vendorName: getField(row, headerIndexByKey, "vendor_name"),
      vendorPaymentMethod,
      vendorBankAccountName: getField(row, headerIndexByKey, "vendor_bank_account_name"),
      vendorBankAccountNumber: getField(row, headerIndexByKey, "vendor_bank_account_number"),
      vendorMobileMoneyProvider: getField(row, headerIndexByKey, "vendor_mobile_money_provider"),
      vendorMobileMoneyNumber: getField(row, headerIndexByKey, "vendor_mobile_money_number"),
      vendorCrewTag: getField(row, headerIndexByKey, "vendor_crew_tag"),
      vendorWireBankName: getField(row, headerIndexByKey, "vendor_wire_bank_name"),
      vendorWireAccountNumber: getField(row, headerIndexByKey, "vendor_wire_account_number"),
      vendorWireSwiftBic: getField(row, headerIndexByKey, "vendor_wire_swift_bic"),
      vendorWireIban: getField(row, headerIndexByKey, "vendor_wire_iban"),
      vendorWireBankCountry: getField(row, headerIndexByKey, "vendor_wire_bank_country"),
      vendorWireCurrency: getField(row, headerIndexByKey, "vendor_wire_currency").toUpperCase()
    });
  });

  return {
    rows,
    errors
  };
}

function escapeCsvCell(value: string): string {
  if (value.includes(",") || value.includes("\"") || value.includes("\n")) {
    return `"${value.replace(/"/g, "\"\"")}"`;
  }

  return value;
}

export function buildExpenseImportTemplateCsv(): string {
  const sampleRow = [
    "work_expense",
    "marketing",
    "",
    "Influencer payout for March campaign",
    "250.00",
    "USD",
    "2026-03-20",
    "Jane Doe",
    "bank_transfer",
    "Jane Doe",
    "0123456789",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    ""
  ];

  return [
    EXPENSE_CSV_IMPORT_HEADERS.join(","),
    sampleRow.map(escapeCsvCell).join(",")
  ].join("\n");
}
