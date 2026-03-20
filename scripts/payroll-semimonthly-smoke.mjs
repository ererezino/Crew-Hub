import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import puppeteer from "puppeteer";

const BASE_URL = process.env.PAYROLL_SMOKE_BASE_URL || "http://localhost:3100";
const ARTIFACT_DIR = path.resolve(process.cwd(), "tmp/payroll-smoke");

const CREDS = {
  finance: {
    email: "financeadmin@accrue.test",
    totpSecret: "UT75Y5VAXCBMM7HRZQFZRCZVX7SWGAQV"
  },
  approver: {
    email: "financeapprover@accrue.test",
    totpSecret: "53K5EZEQATPRVLID6QW3TLSOHILTPXXU"
  }
};

fs.mkdirSync(ARTIFACT_DIR, { recursive: true });

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function decodeBase32(input) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const cleaned = input.toUpperCase().replace(/=+$/g, "").replace(/\s+/g, "");
  let bits = "";

  for (const character of cleaned) {
    const index = alphabet.indexOf(character);
    if (index < 0) throw new Error("Invalid base32 secret.");
    bits += index.toString(2).padStart(5, "0");
  }

  const bytes = [];
  for (let offset = 0; offset + 8 <= bits.length; offset += 8) {
    bytes.push(Number.parseInt(bits.slice(offset, offset + 8), 2));
  }

  return Buffer.from(bytes);
}

function generateTotp(secret, timestampMs = Date.now()) {
  const key = decodeBase32(secret);
  const counter = Math.floor(timestampMs / 1000 / 30);
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));

  const hmac = crypto.createHmac("sha1", key).update(counterBuffer).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binaryCode =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  return String(binaryCode % 1_000_000).padStart(6, "0");
}

async function waitForHydration(page, timeout = 30000) {
  await page.waitForFunction(() => document.body.innerText.trim().length > 0, { timeout });
}

async function waitForCreateForm(page, timeout = 45000) {
  await page.waitForFunction(
    () =>
      Boolean(document.querySelector("#quick-month")) ||
      document.body.innerText.includes("Payroll runs are unavailable") ||
      document.body.innerText.includes("Unable to load payroll runs"),
    { timeout }
  );

  const hasQuickMonth = await page.$("#quick-month");
  if (!hasQuickMonth) {
    const body = await page.evaluate(() => document.body.innerText.slice(0, 1500));
    throw new Error(`Payroll create form did not load. Page body: ${body}`);
  }
}

async function setInputValue(page, selector, value) {
  await page.$eval(
    selector,
    (inputElement, inputValue) => {
      const element = inputElement;
      if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
        const prototype = element instanceof HTMLTextAreaElement
          ? window.HTMLTextAreaElement.prototype
          : window.HTMLInputElement.prototype;
        const nativeSetter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
        nativeSetter?.call(element, inputValue);
        element.dispatchEvent(new Event("input", { bubbles: true }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
        element.dispatchEvent(new Event("blur", { bubbles: true }));
      }
    },
    value
  );
}

async function fillOtpCode(page, code) {
  const inputs = await page.$$(".otp-input, .otp-input-group input");
  if (inputs.length < 6) throw new Error("OTP input fields did not render.");

  for (const input of inputs) {
    await input.click({ clickCount: 3 });
    await input.press("Backspace").catch(() => undefined);
  }

  await inputs[0].click();
  await page.keyboard.type(code, { delay: 40 });
}

async function clickButtonByText(page, text) {
  const expected = text.trim().toLowerCase();
  return await page.evaluate((target) => {
    const buttons = Array.from(document.querySelectorAll("button"));
    const match = buttons.find((element) => {
      if (!(element instanceof HTMLElement)) return false;
      if (element.offsetParent === null) return false;
      if (element.hasAttribute("disabled")) return false;
      return element.textContent?.trim().toLowerCase() === target;
    });

    if (match instanceof HTMLElement) {
      match.click();
      return true;
    }

    return false;
  }, expected);
}

async function clickButtonContainingText(page, text) {
  const expected = text.trim().toLowerCase();
  return await page.evaluate((target) => {
    const buttons = Array.from(document.querySelectorAll("button"));
    const match = buttons.find((element) => {
      if (!(element instanceof HTMLElement)) return false;
      if (element.offsetParent === null) return false;
      if (element.hasAttribute("disabled")) return false;
      return element.textContent?.toLowerCase().includes(target) ?? false;
    });

    if (match instanceof HTMLElement) {
      match.click();
      return true;
    }

    return false;
  }, expected);
}

async function clickWorksheetTab(page, text) {
  const expected = text.trim().toLowerCase();
  const tabIndex =
    expected === "full worksheet" || expected === "worksheet"
      ? 0
      : expected === "cycle 1"
        ? 1
        : expected === "cycle 2"
          ? 2
          : -1;

  if (tabIndex < 0) {
    throw new Error(`Unsupported worksheet tab "${text}".`);
  }

  await page.waitForSelector(".payroll-worksheet-tabs button", { timeout: 20000 });
  const clicked = await page.evaluate((index) => {
    const buttons = Array.from(document.querySelectorAll(".payroll-worksheet-tabs button"));
    const button = buttons[index];
    if (!(button instanceof HTMLElement)) return false;
    if (button.offsetParent === null) return false;
    if (button.hasAttribute("disabled")) return false;
    button.click();
    return true;
  }, tabIndex);

  if (!clicked) {
    throw new Error(`Worksheet tab "${text}" was not clickable.`);
  }

  await page.waitForFunction(
    (index, target) => {
      const buttons = Array.from(document.querySelectorAll(".payroll-worksheet-tabs button"));
      const button = buttons[index];
      if (!(button instanceof HTMLElement) || !button.classList.contains("active")) {
        return false;
      }

      if (target === "worksheet" || target === "full worksheet") {
        return !document.querySelector(".payroll-worksheet-cycle-info");
      }

      return Boolean(document.querySelector(".payroll-worksheet-cycle-info"));
    },
    { timeout: 10000 },
    tabIndex,
    expected
  );

  return true;
}

async function waitForPathname(page, matcher, timeout = 45000) {
  await page.waitForFunction(
    (expected) => {
      if (typeof expected === "string") {
        return window.location.pathname === expected;
      }
      return window.location.pathname.includes(expected.contains);
    },
    { timeout },
    typeof matcher === "string" ? matcher : matcher
  );
}

async function waitForRunDetailPage(page, timeout = 45000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeout) {
    const pathname = new URL(page.url()).pathname;
    const match = pathname.match(/^\/payroll\/runs\/([^/]+)$/);

    if (match && match[1] !== "new") {
      return match[1];
    }

    await sleep(300);
  }

  throw new Error(`Timed out waiting for payroll run detail page. Current URL: ${page.url()}`);
}

async function login(page, email, totpSecret) {
  await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#email");
  await page.click("#email", { clickCount: 3 });
  await page.type("#email", email);
  const clickedEmailSubmit = await clickButtonByText(page, "Sign in");
  if (!clickedEmailSubmit) {
    await page.click('button[type="submit"]');
  }
  await page.waitForFunction(
    () =>
      document.querySelectorAll(".otp-input, .otp-input-group input").length >= 6 ||
      document.body.innerText.includes("Enter your 6-digit authenticator code"),
    { timeout: 30000 }
  );

  const startedAt = Date.now();
  while (Date.now() - startedAt < 45000) {
    const code = generateTotp(totpSecret);
    await fillOtpCode(page, code);

    const clickedOtpSubmit = await clickButtonByText(page, "Sign in");
    if (!clickedOtpSubmit) {
      await page.click('button[type="submit"]');
    }

    const attemptStarted = Date.now();
    while (Date.now() - attemptStarted < 8000) {
      try {
        const pathname = new URL(page.url()).pathname;
        if (pathname !== "/login") {
          return;
        }
      } catch {
        // Ignore transient navigation state.
      }
      await sleep(300);
    }

    try {
      const bodyText = await page.evaluate(() => document.body.innerText);
      if (bodyText.includes("You're making requests too quickly")) {
        await sleep(5000);
        continue;
      }
      if (bodyText.includes("Invalid") || bodyText.includes("incorrect")) {
        await sleep(1000);
        continue;
      }
    } catch {
      await sleep(500);
    }
  }

  throw new Error(`Login did not complete for ${email}. Current URL: ${page.url()}`);
}

async function fetchJson(page, relativePath, init = {}) {
  return await page.evaluate(async ({ pathName, options }) => {
    const response = await fetch(pathName, options);
    const payload = await response.json().catch(() => null);
    return { status: response.status, payload };
  }, {
    pathName: relativePath,
    options: init
  });
}

function formatMonth(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

async function nextUnusedMonth(page) {
  const result = await fetchJson(page, "/api/v1/payroll/runs");
  if (result.status !== 200) {
    throw new Error(`Unable to load payroll runs for month selection: ${result.status}`);
  }

  const runs = result.payload?.data?.runs ?? [];
  const used = new Set(
    runs
      .map((run) => run.runMonth ?? run.payPeriodStart?.slice(0, 7))
      .filter(Boolean)
  );

  const cursor = new Date();
  cursor.setUTCDate(1);
  cursor.setUTCMonth(cursor.getUTCMonth() + 1);

  for (let index = 0; index < 24; index += 1) {
    const candidate = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + index, 1));
    const month = formatMonth(candidate);
    if (!used.has(month)) {
      return month;
    }
  }

  throw new Error("Could not find an unused future payroll month.");
}

async function waitForApiDetail(page, runId, predicate, message, timeout = 30000) {
  const startedAt = Date.now();
  let lastData = null;
  let lastStatus = null;

  while (Date.now() - startedAt < timeout) {
    const result = await fetchJson(page, `/api/v1/payroll/runs/${runId}`);
    lastStatus = result.status;
    if (result.status === 200) {
      lastData = result.payload?.data ?? null;
      if (predicate(lastData)) {
        return lastData;
      }
    }

    await sleep(500);
  }

  throw new Error(
    `${message} Last fetch status=${lastStatus}; last run status=${lastData?.run?.status ?? "unknown"}.`
  );
}

async function main() {
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });

  const result = {
    createdMonth: null,
    runId: null,
    steps: []
  };
  let lastPage = null;

  try {
    const financeContext = await browser.createBrowserContext();
    const financePage = await financeContext.newPage();
    lastPage = financePage;
    financePage.setDefaultTimeout(45000);

    await login(financePage, CREDS.finance.email, CREDS.finance.totpSecret);
    result.steps.push("finance login");

    const month = await nextUnusedMonth(financePage);
    result.createdMonth = month;

    await financePage.goto(`${BASE_URL}/payroll/runs/new`, { waitUntil: "domcontentloaded" });
    await waitForHydration(financePage);
    await waitForCreateForm(financePage);
    await setInputValue(financePage, "#quick-month", month);
    const createResponsePromise = financePage.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().includes("/api/v1/payroll/runs"),
      { timeout: 45000 }
    );
    const clickedCreate = await clickButtonByText(financePage, "Create payroll run");
    if (!clickedCreate) {
      throw new Error("Create payroll run button was not clickable.");
    }

    const createResponse = await createResponsePromise.catch(() => null);
    if (createResponse && !createResponse.ok()) {
      const payload = await createResponse.json().catch(() => null);
      throw new Error(
        `Create payroll run failed: status=${createResponse.status()} message=${
          payload?.error?.message ?? "unknown"
        }`
      );
    }

    const runId = await waitForRunDetailPage(financePage);
    result.runId = runId;
    result.steps.push("run created");

    await waitForHydration(financePage);
    await financePage.waitForSelector(".payroll-worksheet-table tbody tr", { timeout: 45000 });

    const worksheetRowCount = await financePage.$$eval(
      ".payroll-worksheet-table tbody tr",
      (rows) => rows.length
    );
    if (worksheetRowCount <= 0) {
      throw new Error("Worksheet did not load employee rows after run creation.");
    }
    result.steps.push(`worksheet rows loaded (${worksheetRowCount})`);

    await clickWorksheetTab(financePage, "Cycle 1");
    await financePage.waitForFunction(
      () => document.body.innerText.includes("Submit cycle for approval"),
      { timeout: 20000 }
    );
    await clickButtonByText(financePage, "Submit cycle for approval");

    await waitForApiDetail(
      financePage,
      runId,
      (data) =>
        data?.run?.status === "submitted" &&
        data?.cycles?.some((cycle) => cycle.cycleNumber === 1 && cycle.status === "submitted"),
      "Cycle 1 submission did not move the month into submitted state."
    );
    result.steps.push("cycle 1 submitted");

    await financeContext.close();

    const approverContext = await browser.createBrowserContext();
    const approverPage = await approverContext.newPage();
    lastPage = approverPage;
    approverPage.setDefaultTimeout(45000);

    await login(approverPage, CREDS.approver.email, CREDS.approver.totpSecret);
    result.steps.push("approver login");

    await approverPage.goto(`${BASE_URL}/payroll/runs/${runId}`, { waitUntil: "domcontentloaded" });
    await waitForHydration(approverPage);
    result.steps.push("approver run opened");
    await clickWorksheetTab(approverPage, "Cycle 1");
    result.steps.push("approver cycle 1 tab active");
    await approverPage.waitForFunction(
      () => document.body.innerText.includes("Approve cycle"),
      { timeout: 20000 }
    );
    await clickButtonByText(approverPage, "Approve cycle");
    result.steps.push("approver approve clicked");

    await waitForApiDetail(
      approverPage,
      runId,
      (data) =>
        data?.run?.status === "approved" &&
        data?.cycles?.some((cycle) => cycle.cycleNumber === 1 && cycle.status === "approved"),
      "Cycle 1 approval did not produce the expected approved state."
    );
    result.steps.push("cycle 1 approved");

    await approverContext.close();

    const financePayContext = await browser.createBrowserContext();
    const financePayPage = await financePayContext.newPage();
    lastPage = financePayPage;
    financePayPage.setDefaultTimeout(45000);

    await login(financePayPage, CREDS.finance.email, CREDS.finance.totpSecret);
    result.steps.push("finance relogin");

    await financePayPage.goto(`${BASE_URL}/payroll/runs/${runId}`, { waitUntil: "domcontentloaded" });
    await waitForHydration(financePayPage);
    await clickWorksheetTab(financePayPage, "Cycle 1");
    await financePayPage.waitForFunction(
      () => document.body.innerText.includes("Record payment"),
      { timeout: 30000 }
    );

    await clickButtonByText(financePayPage, "Record payment");
    await financePayPage.waitForSelector('input[placeholder="Payment reference or batch ID"]');
    await setInputValue(financePayPage, 'input[placeholder="Payment reference or batch ID"]', `SMOKE-${Date.now()}`);
    await setInputValue(financePayPage, 'textarea[placeholder="Payment note (optional)"]', "Smoke test external payroll confirmation");
    await clickButtonByText(financePayPage, "Confirm payment");

    const postPaymentData = await waitForApiDetail(
      financePayPage,
      runId,
      (data) =>
        data?.run?.status === "processing" &&
        data?.cycles?.some((cycle) => cycle.cycleNumber === 1 && cycle.status === "paid") &&
        data?.cycles?.some((cycle) => cycle.cycleNumber === 2 && cycle.status === "draft"),
      "Cycle 1 payment did not leave the month in the expected processing state."
    );
    result.steps.push("cycle 1 paid");

    const cycle1 = postPaymentData.cycles.find((cycle) => cycle.cycleNumber === 1);
    if (!cycle1?.id) {
      throw new Error("Unable to locate Cycle 1 ID for export checks.");
    }

    const csvExport = await financePayPage.evaluate(async ({ runId: currentRunId, cycleId }) => {
      const response = await fetch(`/api/v1/payroll/runs/${currentRunId}/cycles/${cycleId}/export?format=csv`);
      return {
        status: response.status,
        contentType: response.headers.get("content-type")
      };
    }, { runId, cycleId: cycle1.id });

    const pdfExport = await financePayPage.evaluate(async ({ runId: currentRunId, cycleId }) => {
      const response = await fetch(`/api/v1/payroll/runs/${currentRunId}/cycles/${cycleId}/export?format=pdf`);
      return {
        status: response.status,
        contentType: response.headers.get("content-type")
      };
    }, { runId, cycleId: cycle1.id });

    if (csvExport.status !== 200 || !csvExport.contentType?.includes("text/csv")) {
      throw new Error(`CSV export failed after payment. status=${csvExport.status} contentType=${csvExport.contentType}`);
    }

    if (pdfExport.status !== 200 || !pdfExport.contentType?.includes("application/pdf")) {
      throw new Error(`PDF export failed after payment. status=${pdfExport.status} contentType=${pdfExport.contentType}`);
    }
    result.steps.push("csv/pdf export verified");

    await clickWorksheetTab(financePayPage, "Cycle 2");
    result.steps.push("finance cycle 2 tab active");
    await financePayPage.waitForFunction(
      () => document.querySelectorAll(".worksheet-cell-editable").length > 0,
      { timeout: 20000 }
    );
    const editableCount = await financePayPage.$$eval(".worksheet-cell-editable", (nodes) => nodes.length);
    if (editableCount <= 0) {
      throw new Error("Cycle 2 did not remain editable after Cycle 1 payment.");
    }
    result.steps.push(`cycle 2 remains editable (${editableCount} editable cells)`);

    const screenshotPath = path.join(ARTIFACT_DIR, `payroll-semimonthly-${Date.now()}.png`);
    await financePayPage.screenshot({ path: screenshotPath, fullPage: true });
    result.screenshot = screenshotPath;

    await financePayContext.close();

    console.log(JSON.stringify({ ok: true, result }, null, 2));
  } catch (error) {
    if (lastPage) {
      try {
        await waitForHydration(lastPage, 5000).catch(() => undefined);
        result.currentUrl = lastPage.url();
        result.bodySnippet = await lastPage.evaluate(() => document.body.innerText.slice(0, 2000));
        const failureShot = path.join(ARTIFACT_DIR, `payroll-semimonthly-failure-${Date.now()}.png`);
        await lastPage.screenshot({ path: failureShot, fullPage: true });
        result.failureScreenshot = failureShot;
      } catch {
        // Ignore secondary capture failures.
      }
    }
    console.error(JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      result
    }, null, 2));
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

await main();
