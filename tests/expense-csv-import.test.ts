import { describe, expect, it } from "vitest";

import {
  buildExpenseImportTemplateCsv,
  parseExpenseImportCsv
} from "../lib/expenses/csv-import";

describe("expense CSV import helpers", () => {
  it("parses expense rows from a valid CSV template", () => {
    const csv = [
      "expense_type,category,custom_category,description,amount,currency,expense_date,vendor_name,vendor_payment_method,vendor_bank_account_name,vendor_bank_account_number,vendor_mobile_money_provider,vendor_mobile_money_number,vendor_crew_tag,vendor_wire_bank_name,vendor_wire_account_number,vendor_wire_swift_bic,vendor_wire_iban,vendor_wire_bank_country,vendor_wire_currency",
      "work_expense,marketing,,Influencer payout,250.00,USD,2026-03-20,Jane Doe,bank_transfer,Jane Doe,0123456789,,,,,,,,,"
    ].join("\n");

    const result = parseExpenseImportCsv(csv);

    expect(result.errors).toEqual([]);
    expect(result.rows).toEqual([
      {
        rowNumber: 2,
        expenseType: "work_expense",
        category: "marketing",
        customCategory: "",
        description: "Influencer payout",
        amount: "250.00",
        currency: "USD",
        expenseDate: "2026-03-20",
        vendorName: "Jane Doe",
        vendorPaymentMethod: "bank_transfer",
        vendorBankAccountName: "Jane Doe",
        vendorBankAccountNumber: "0123456789",
        vendorMobileMoneyProvider: "",
        vendorMobileMoneyNumber: "",
        vendorCrewTag: "",
        vendorWireBankName: "",
        vendorWireAccountNumber: "",
        vendorWireSwiftBic: "",
        vendorWireIban: "",
        vendorWireBankCountry: "",
        vendorWireCurrency: ""
      }
    ]);
  });

  it("reports missing required columns", () => {
    const csv = [
      "category,description,amount,currency",
      "marketing,Influencer payout,250.00,USD"
    ].join("\n");

    const result = parseExpenseImportCsv(csv);

    expect(result.rows).toEqual([]);
    expect(result.errors[0]).toContain("expense_date");
  });

  it("builds a reusable CSV template with the expected headers", () => {
    const template = buildExpenseImportTemplateCsv().split("\n");

    expect(template[0]).toContain("expense_type");
    expect(template[0]).toContain("vendor_payment_method");
    expect(template[1]).toContain("marketing");
  });
});
