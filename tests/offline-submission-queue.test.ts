import { describe, expect, it } from "vitest";

import { isNetworkFailure, splitFormData } from "../lib/offline/submission-queue";

describe("offline submission queue helpers", () => {
  it("classifies fetch network failures (TypeError) as queueable", () => {
    expect(isNetworkFailure(new TypeError("Failed to fetch"))).toBe(true);
  });

  it("does not classify server rejections or generic errors as network failures", () => {
    expect(isNetworkFailure(new Error("Validation failed"))).toBe(false);
    expect(isNetworkFailure("string error")).toBe(false);
    expect(isNetworkFailure(null)).toBe(false);
  });

  it("splits FormData into storable fields and files", () => {
    const formData = new FormData();
    formData.set("category", "travel");
    formData.set("amount", "12500");
    formData.append("receipts", new File(["fake-bytes"], "receipt-1.png", { type: "image/png" }));
    formData.append("receipts", new File(["more-bytes"], "receipt-2.pdf", { type: "application/pdf" }));

    const { fields, files } = splitFormData(formData);

    expect(fields).toEqual({ category: "travel", amount: "12500" });
    expect(files).toHaveLength(2);
    expect(files[0]).toMatchObject({ field: "receipts", name: "receipt-1.png", type: "image/png" });
    expect(files[1]).toMatchObject({ field: "receipts", name: "receipt-2.pdf", type: "application/pdf" });
  });
});
