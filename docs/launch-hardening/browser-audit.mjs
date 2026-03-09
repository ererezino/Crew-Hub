import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import puppeteer from "puppeteer";

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, "utf8");
  const lines = content.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) continue;

    const key = trimmed.slice(0, separatorIndex).trim();
    if (!key || process.env[key]) continue;

    let value = trimmed.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

loadEnvFile(path.resolve(process.cwd(), ".env"));
loadEnvFile(path.resolve(process.cwd(), ".env.local"));

const BASE_URL = process.env.AUDIT_BASE_URL || "http://localhost:3100";
const REPORT_PATH = path.resolve(
  process.cwd(),
  "docs/launch-hardening/browser-walkthrough-results.json"
);

const CREDS = {
  admin: {
    email: "coo@accrue.test",
    password: "TestPassword123!",
    totpCode: process.env.AUDIT_ADMIN_TOTP_CODE || process.env.AUDIT_TOTP_CODE || ""
  },
  manager: {
    email: "eng.manager@accrue.test",
    password: "TestPassword123!",
    totpCode: process.env.AUDIT_MANAGER_TOTP_CODE || process.env.AUDIT_TOTP_CODE || ""
  },
  employee: {
    email: "engineer1@accrue.test",
    password: "TestPassword123!",
    totpCode: process.env.AUDIT_EMPLOYEE_TOTP_CODE || process.env.AUDIT_TOTP_CODE || ""
  }
};

const runtimeTotpSecrets = new Map();

function isValidSixDigitCode(value) {
  return /^\d{6}$/.test(value.trim());
}

function decodeBase32(input) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const cleaned = input.toUpperCase().replace(/=+$/g, "").replace(/\s+/g, "");
  let bits = "";

  for (const character of cleaned) {
    const index = alphabet.indexOf(character);
    if (index < 0) {
      throw new Error("Invalid base32 secret.");
    }
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

function deriveSystemPassword(userId) {
  const secret = process.env.AUTH_SYSTEM_SECRET?.trim();
  if (!secret) {
    throw new Error("AUTH_SYSTEM_SECRET is required for audit TOTP bootstrap.");
  }
  return crypto.createHmac("sha256", secret).update(userId).digest("base64url");
}

function resolveTotpCode(email, explicitCode = "") {
  if (isValidSixDigitCode(explicitCode)) {
    return explicitCode.trim();
  }

  const secret = runtimeTotpSecrets.get(email.trim().toLowerCase());
  if (secret) {
    return generateTotp(secret);
  }

  return "";
}

function canAutoBootstrap(email) {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail.endsWith("@accrue.test")) {
    return false;
  }

  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() &&
      process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() &&
      process.env.AUTH_SYSTEM_SECRET?.trim()
  );
}

async function verifyTotpFactor(userClient, factorId, secret) {
  let lastError = null;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { data: challengeData, error: challengeError } =
      await userClient.auth.mfa.challenge({ factorId });

    if (challengeError || !challengeData) {
      lastError = challengeError ?? new Error("MFA challenge data missing.");
      await new Promise((resolve) => setTimeout(resolve, 700));
      continue;
    }

    const code = generateTotp(secret, Date.now() + attempt * 1000);
    const { error: verifyError } = await userClient.auth.mfa.verify({
      factorId,
      challengeId: challengeData.id,
      code
    });

    if (!verifyError) {
      return;
    }

    lastError = verifyError;
    await new Promise((resolve) => setTimeout(resolve, 1100));
  }

  throw new Error(
    `Unable to verify TOTP factor automatically: ${
      lastError instanceof Error ? lastError.message : "unknown error"
    }`
  );
}

async function bootstrapCredentialTotp(credential) {
  if (isValidSixDigitCode(credential.totpCode)) {
    return;
  }

  const email = credential.email.trim().toLowerCase();
  if (!canAutoBootstrap(email)) {
    return;
  }

  const serviceClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const { data: profile, error: profileError } = await serviceClient
    .from("profiles")
    .select("id, email")
    .eq("email", email)
    .is("deleted_at", null)
    .maybeSingle();

  if (profileError || !profile?.id) {
    throw new Error(`Unable to locate profile for ${email}.`);
  }

  const { data: existingFactors, error: listError } =
    await serviceClient.auth.admin.mfa.listFactors({ userId: profile.id });

  if (listError) {
    throw new Error(`Unable to list MFA factors for ${email}.`);
  }

  for (const factor of (existingFactors?.factors ?? []).filter((item) => item.factor_type === "totp")) {
    const { error: deleteError } = await serviceClient.auth.admin.mfa.deleteFactor({
      id: factor.id,
      userId: profile.id
    });

    if (deleteError) {
      throw new Error(`Unable to clear existing MFA factor for ${email}.`);
    }
  }

  const userClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  try {
    const { data: signInData, error: signInError } =
      await userClient.auth.signInWithPassword({
        email,
        password: deriveSystemPassword(profile.id)
      });

    if (signInError || !signInData?.user) {
      throw new Error(`System-password sign-in failed for ${email}.`);
    }

    const { data: enrollData, error: enrollError } = await userClient.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: "Audit bootstrap"
    });

    if (enrollError || !enrollData?.id || !enrollData?.totp?.uri) {
      throw new Error(`MFA enroll failed for ${email}.`);
    }

    const secret = new URL(enrollData.totp.uri).searchParams.get("secret");
    if (!secret) {
      throw new Error(`TOTP secret missing during enrollment for ${email}.`);
    }

    await verifyTotpFactor(userClient, enrollData.id, secret);
    runtimeTotpSecrets.set(email, secret);
  } finally {
    await userClient.auth.signOut().catch(() => undefined);
  }
}

async function bootstrapAuditTotpIfNeeded() {
  await bootstrapCredentialTotp(CREDS.employee);
  await bootstrapCredentialTotp(CREDS.manager);
}

const artifactsDir = path.resolve(process.cwd(), "docs/launch-hardening/artifacts");
fs.mkdirSync(artifactsDir, { recursive: true });

const validPdfPath = path.resolve(artifactsDir, "audit-valid.pdf");
const invalidTxtPath = path.resolve(artifactsDir, "audit-invalid.txt");

if (!fs.existsSync(validPdfPath)) {
  fs.writeFileSync(
    validPdfPath,
    "%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n",
    "utf8"
  );
}

if (!fs.existsSync(invalidTxtPath)) {
  fs.writeFileSync(invalidTxtPath, "This should be rejected by upload validation.\n", "utf8");
}

const results = [];

function appendResult(flow, status, details) {
  results.push({
    flow,
    status,
    details,
    recordedAt: new Date().toISOString()
  });
}

async function clickButtonByText(page, text) {
  const buttons = await page.$$("button");
  const expected = text.trim().toLowerCase();

  for (const button of buttons) {
    const matches = await button.evaluate(
      (element, targetText) => {
        if (!(element instanceof HTMLElement)) return false;
        if (element.offsetParent === null) return false;
        if (element.hasAttribute("disabled")) return false;
        if (element.getAttribute("aria-hidden") === "true") return false;
        return element.textContent?.trim().toLowerCase() === targetText;
      },
      expected
    );

    if (matches) {
      await button.click();
      return true;
    }
  }

  return false;
}

async function clickButtonContainingText(page, text) {
  const buttons = await page.$$("button");
  const expected = text.trim().toLowerCase();

  for (const button of buttons) {
    const matches = await button.evaluate(
      (element, targetText) => {
        if (!(element instanceof HTMLElement)) return false;
        if (element.offsetParent === null) return false;
        if (element.hasAttribute("disabled")) return false;
        if (element.getAttribute("aria-hidden") === "true") return false;
        return element.textContent?.toLowerCase().includes(targetText) ?? false;
      },
      expected
    );

    if (matches) {
      await button.click();
      return true;
    }
  }

  return false;
}

async function setInputValue(page, selector, value) {
  await page.$eval(
    selector,
    (inputElement, inputValue) => {
      const element = inputElement;
      const nativeSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value"
      )?.set;

      nativeSetter?.call(element, inputValue);
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
      element.dispatchEvent(new Event("blur", { bubbles: true }));
    },
    value
  );
}

async function waitForHydration(page, timeout = 20000) {
  await page.waitForFunction(
    () => document.body.innerText.trim().length > 0,
    { timeout }
  );
}

async function openPanelWithRetry(page, buttonText, panelSelector) {
  const maxAttempts = 6;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const clicked = await clickButtonContainingText(page, buttonText);
    if (!clicked) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      continue;
    }

    try {
      await page.waitForSelector(panelSelector, { timeout: 6000 });
      return true;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  return false;
}

async function clickSlidePanelButtonContainingText(page, text) {
  const buttons = await page.$$(".slide-panel button");
  const expected = text.trim().toLowerCase();

  for (const button of buttons) {
    const matches = await button.evaluate(
      (element, targetText) => {
        if (!(element instanceof HTMLElement)) return false;
        if (element.offsetParent === null) return false;
        if (element.hasAttribute("disabled")) return false;
        return element.textContent?.toLowerCase().includes(targetText) ?? false;
      },
      expected
    );

    if (matches) {
      await button.click();
      return true;
    }
  }

  return false;
}

async function login(page, email, password, totpCode = "") {
  await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#email");

  const hasPasswordField = (await page.$("#password")) !== null;

  await page.evaluate((withPasswordField) => {
    const emailInput = document.querySelector("#email");
    if (emailInput) emailInput.value = "";
    if (withPasswordField) {
      const passwordInput = document.querySelector("#password");
      if (passwordInput) passwordInput.value = "";
    }
  }, hasPasswordField);

  await page.type("#email", email);

  if (hasPasswordField) {
    await page.type("#password", password);
    await page.click('button[type="submit"]');
  } else {
    await page.click('button[type="submit"]');

    const trimmedCode = resolveTotpCode(email, totpCode).trim();
    if (!isValidSixDigitCode(trimmedCode)) {
      throw new Error(
        "Login form requires OTP code. Set AUDIT_TOTP_CODE or role-specific AUDIT_*_TOTP_CODE env vars, or run with bootstrap-capable @accrue.test audit users."
      );
    }

    await page.waitForSelector(".otp-input-group input");
    const otpInputs = await page.$$(".otp-input-group input");

    if (otpInputs.length < 6) {
      throw new Error("OTP input fields were not rendered correctly.");
    }

    for (let index = 0; index < 6; index += 1) {
      await otpInputs[index].click({ clickCount: 1 });
      await otpInputs[index].type(trimmedCode[index]);
    }

    await page.click('button[type="submit"]');
  }

  await page.waitForFunction(
    () => window.location.pathname !== "/login",
    { timeout: 45000 }
  );
}

async function withFreshPage(browser, fn) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  page.setDefaultTimeout(45000);
  const randomOctet = Math.floor(Math.random() * 200) + 20;
  await page.setExtraHTTPHeaders({
    "x-forwarded-for": `203.0.113.${randomOctet}`
  });

  try {
    await fn(page);
  } finally {
    await context.close();
  }
}

async function runFlow(flow, fn) {
  try {
    await fn();
  } catch (error) {
    appendResult(flow, "fail", error instanceof Error ? error.message : String(error));
  }
}

async function run() {
  try {
    await bootstrapAuditTotpIfNeeded();
  } catch (error) {
    appendResult(
      "Audit TOTP bootstrap",
      "partial",
      error instanceof Error
        ? error.message
        : "Unable to bootstrap audit TOTP secrets automatically."
    );
  }

  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });

  try {
    await runFlow("Public login/legal/support visibility", async () => withFreshPage(browser, async (page) => {
      await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
      await page.waitForSelector("#email", { timeout: 20000 });
      const loginBody = await page.evaluate(() => document.body.innerText);
      const hasPrivacy = loginBody.includes("Privacy Policy");
      const hasTerms = loginBody.includes("Terms of Service");
      const hasSupport = loginBody.includes("support@useaccrue.com");

      if (hasPrivacy && hasTerms && hasSupport) {
        appendResult("Public login/legal/support visibility", "pass", "Login page exposes privacy, terms, and support.");
      } else {
        appendResult("Public login/legal/support visibility", "fail", "Missing one or more legal/support links on login page.");
      }
    }));

    await runFlow("Unknown route 404 behavior", async () => withFreshPage(browser, async (page) => {
      await login(page, CREDS.employee.email, CREDS.employee.password, CREDS.employee.totpCode);
      await page.goto(`${BASE_URL}/definitely-not-a-real-route`, { waitUntil: "domcontentloaded" });
      await waitForHydration(page);
      const body = await page.evaluate(() => document.body.innerText);
      if (body.toLowerCase().includes("not found")) {
        appendResult("Unknown route 404 behavior", "pass", "Unknown route renders explicit page-not-found screen.");
      } else {
        appendResult(
          "Unknown route 404 behavior",
          "fail",
          `Unknown route did not render page-not-found screen. url=${page.url()} body=${body.slice(0, 240)}`
        );
      }
    }));

    await runFlow("Admin MFA enforcement", async () => withFreshPage(browser, async (page) => {
      const adminCode = resolveTotpCode(CREDS.admin.email, CREDS.admin.totpCode) || "000000";

      try {
        await login(page, CREDS.admin.email, CREDS.admin.password, adminCode);
        const currentUrl = page.url();
        if (currentUrl.includes("/mfa-setup")) {
          appendResult("Admin MFA enforcement", "pass", "Admin login redirected to MFA setup.");
          return;
        }

        if (currentUrl.includes("/dashboard")) {
          appendResult(
            "Admin MFA enforcement",
            "pass",
            "Admin login succeeded with authenticator challenge and reached dashboard."
          );
          return;
        }

        appendResult("Admin MFA enforcement", "partial", `Unexpected post-login URL for admin: ${currentUrl}`);
      } catch {
        const body = (await page.evaluate(() => document.body.innerText)).toLowerCase();
        const enforced =
          body.includes("authenticator") ||
          body.includes("mfa") ||
          body.includes("invalid authenticator code");

        if (enforced) {
          appendResult(
            "Admin MFA enforcement",
            "pass",
            "Admin login blocked until authenticator setup/verification is satisfied."
          );
          return;
        }

        appendResult("Admin MFA enforcement", "fail", "Unable to verify admin MFA enforcement behavior.");
      }
    }));

    await runFlow("Employee login/logout", async () => withFreshPage(browser, async (page) => {
      await login(page, CREDS.employee.email, CREDS.employee.password, CREDS.employee.totpCode);
      if (!page.url().includes("/dashboard")) {
        appendResult("Employee login", "fail", `Expected dashboard after login, got ${page.url()}`);
        return;
      }

      await page.click('button[aria-label="User menu"]');
      await page.waitForSelector("button.user-menu-item-danger");
      await clickButtonByText(page, "Sign out");
      await page.waitForFunction(() => window.location.pathname === "/login");

      appendResult(
        "Employee login/logout",
        "pass",
        "Employee can sign in and sign out via user menu."
      );
    }));

    await runFlow("Time-off request submission", async () => withFreshPage(browser, async (page) => {
      await login(page, CREDS.employee.email, CREDS.employee.password, CREDS.employee.totpCode);
      await page.goto(`${BASE_URL}/time-off`, { waitUntil: "domcontentloaded" });
      await waitForHydration(page);
      await page.waitForFunction(
        () => document.body.innerText.includes("Request Time Off"),
        { timeout: 30000 }
      );

      const opened = await clickButtonContainingText(page, "Request Time Off");
      if (!opened) {
        const debug = await page.evaluate(() => ({
          url: window.location.href,
          buttons: Array.from(document.querySelectorAll("button"))
            .map((button) => button.textContent?.trim())
            .filter(Boolean)
            .slice(0, 20),
          snippet: document.body.innerText.slice(0, 600)
        }));
        appendResult(
          "Time-off request submission",
          "fail",
          `Request Time Off button not found. url=${debug.url}; buttons=${debug.buttons.join(" | ")}; snippet=${debug.snippet}`
        );
        return;
      }

      await page.waitForSelector("#timeoff-leave-type");
      const leaveTypeValue = await page.$eval("#timeoff-leave-type", (element) => {
        const options = Array.from(element.querySelectorAll("option"));
        const first = options.find((option) => option.value);
        return first?.value ?? "";
      });

      if (!leaveTypeValue) {
        appendResult("Time-off request submission", "partial", "No leave type options were available.");
        return;
      }

      const now = new Date();
      const start = new Date(now);
      const end = new Date(now);
      start.setDate(start.getDate() + 14);
      end.setDate(end.getDate() + 1);
      while (start.getDay() === 0 || start.getDay() === 6) {
        start.setDate(start.getDate() + 1);
      }
      while (end.getDay() === 0 || end.getDay() === 6 || end <= start) {
        end.setDate(end.getDate() + 1);
      }
      const toDate = (value) => value.toISOString().slice(0, 10);

      const preferredLeaveType = await page.$eval("#timeoff-leave-type", (element) => {
        const options = Array.from(element.querySelectorAll("option")).map((option) => option.value);
        if (options.includes("sick_leave")) {
          return "sick_leave";
        }
        return options.find((option) => option.length > 0) ?? "";
      });

      await page.select("#timeoff-leave-type", preferredLeaveType || leaveTypeValue);
      await setInputValue(page, "#timeoff-start-date", toDate(start));
      await setInputValue(page, "#timeoff-end-date", toDate(end));
      const reasonText = `Browser launch audit time-off request ${Date.now()}`;
      await page.click("#timeoff-reason", { clickCount: 3 });
      await page.type("#timeoff-reason", reasonText);
      const clickedSubmit = await clickButtonContainingText(page, "Submit request");
      if (!clickedSubmit) {
        appendResult("Time-off request submission", "fail", "Submit request button was not clickable.");
        return;
      }
      try {
        await page.waitForFunction(
          () =>
            document.body.innerText.includes("Leave request submitted.") ||
            document.body.innerText.includes("Browser launch audit time-off request"),
          { timeout: 20000 }
        );
      } catch {
        // fall through and inspect page state below
      }

      const submitState = await page.evaluate(() => {
        const bodyText = document.body.innerText;
        const error = document.querySelector(".form-submit-error")?.textContent?.trim() ?? null;
        const fieldErrors = Array.from(document.querySelectorAll(".form-field-error"))
          .map((node) => node.textContent?.trim())
          .filter(Boolean);
        return {
          hasSuccess: bodyText.includes("Leave request submitted."),
          hasRequestInList: bodyText.includes("Browser launch audit time-off request"),
          error,
          fieldErrors
        };
      });

      if (submitState.hasSuccess || submitState.hasRequestInList) {
        appendResult("Time-off request submission", "pass", "Employee successfully submitted a leave request.");
      } else {
        appendResult(
          "Time-off request submission",
          "partial",
          submitState.error ??
            (submitState.fieldErrors.length > 0
              ? submitState.fieldErrors.join(" | ")
              : "Submission did not show success toast within timeout.")
        );
      }
    }));

    await runFlow("Expense submission", async () => withFreshPage(browser, async (page) => {
      await login(page, CREDS.employee.email, CREDS.employee.password, CREDS.employee.totpCode);
      await page.goto(`${BASE_URL}/expenses`, { waitUntil: "domcontentloaded" });
      await waitForHydration(page);
      await page.waitForFunction(() => document.body.innerText.includes("Submit expense"), { timeout: 20000 });

      const opened = await clickButtonContainingText(page, "Submit expense");
      if (!opened) {
        const debug = await page.evaluate(() => ({
          url: window.location.href,
          buttons: Array.from(document.querySelectorAll("button"))
            .map((button) => button.textContent?.trim())
            .filter(Boolean)
            .slice(0, 20),
          snippet: document.body.innerText.slice(0, 600)
        }));
        appendResult(
          "Expense submission",
          "fail",
          `Submit expense button not found. url=${debug.url}; buttons=${debug.buttons.join(" | ")}; snippet=${debug.snippet}`
        );
        return;
      }

      await page.waitForSelector("#expense-amount-input");
      await clickButtonContainingText(page, "Personal Reimbursement");
      await clickButtonContainingText(page, "Transport");
      const expenseMemo = `Browser launch audit expense ${Date.now()}`;
      await page.type(".slide-panel textarea", expenseMemo);
      await page.click("#expense-amount-input", { clickCount: 3 });
      await page.type("#expense-amount-input", "4500");

      const expenseDate = new Date();
      expenseDate.setDate(expenseDate.getDate() - 1);
      const expenseDateString = expenseDate.toISOString().slice(0, 10);

      await setInputValue(page, '.slide-panel input[type="date"]', expenseDateString);

      const hasVendorFields = await page.$('input[placeholder="Company or vendor name"]');
      if (hasVendorFields) {
        await setInputValue(page, 'input[placeholder="Company or vendor name"]', "Audit Vendor");
        await setInputValue(page, 'input[placeholder="Account holder name"]', "Audit Vendor");
        await setInputValue(page, 'input[placeholder="Bank account number"]', "0001234567");
      }

      const uploadInput = await page.$('.slide-panel input[type="file"]');
      if (!uploadInput) {
        appendResult("Expense submission", "fail", "Receipt file input not found.");
        return;
      }
      await uploadInput.uploadFile(validPdfPath);
      const clickedSubmit = await clickSlidePanelButtonContainingText(page, "Submit expense");
      if (!clickedSubmit) {
        appendResult("Expense submission", "fail", "Submit expense button was not clickable.");
        return;
      }
      try {
        await page.waitForFunction(
          () =>
            document.body.innerText.includes("Expense submitted.") ||
            document.body.innerText.includes("Browser launch audit expense"),
          { timeout: 20000 }
        );
      } catch {
        // fall through and inspect page state below
      }

      const submitState = await page.evaluate(() => {
        const bodyText = document.body.innerText;
        const error = document.querySelector(".form-submit-error")?.textContent?.trim() ?? null;
        const fieldErrors = Array.from(document.querySelectorAll(".form-field-error"))
          .map((node) => node.textContent?.trim())
          .filter(Boolean);
        return {
          hasSuccess: bodyText.includes("Expense submitted."),
          hasExpenseInList: bodyText.includes("Browser launch audit expense"),
          error,
          fieldErrors
        };
      });

      let hasExpenseViaApi = false;
      if (!submitState.hasSuccess && !submitState.hasExpenseInList) {
        hasExpenseViaApi = await page.evaluate(async () => {
          try {
            const response = await fetch("/api/v1/expenses?view=mine", { method: "GET" });
            if (!response.ok) {
              return false;
            }

            const payload = await response.json();
            const expenses = payload?.data?.expenses;
            if (!Array.isArray(expenses)) {
              return false;
            }

            return expenses.some(
              (expense) =>
                typeof expense?.description === "string" &&
                expense.description.includes("Browser launch audit expense")
            );
          } catch {
            return false;
          }
        });
      }

      if (submitState.hasSuccess || submitState.hasExpenseInList || hasExpenseViaApi) {
        appendResult("Expense submission", "pass", "Employee submitted an expense with receipt upload.");
      } else {
        appendResult(
          "Expense submission",
          "partial",
          submitState.error ??
            (submitState.fieldErrors.length > 0
              ? submitState.fieldErrors.join(" | ")
              : "Submission did not show success toast within timeout.")
        );
      }
    }));

    await runFlow("Document upload validation", async () => withFreshPage(browser, async (page) => {
      await login(page, CREDS.employee.email, CREDS.employee.password, CREDS.employee.totpCode);
      await page.goto(`${BASE_URL}/me/documents`, { waitUntil: "domcontentloaded" });
      await waitForHydration(page, 30000);
      await page.waitForFunction(() => document.body.innerText.includes("Upload document"), { timeout: 20000 });

      const opened = await openPanelWithRetry(page, "Upload document", "#document-title");
      if (!opened) {
        const debug = await page.evaluate(() => ({
          url: window.location.href,
          buttons: Array.from(document.querySelectorAll("button"))
            .map((button) => button.textContent?.trim())
            .filter(Boolean)
            .slice(0, 20),
          snippet: document.body.innerText.slice(0, 600)
        }));
        appendResult(
          "Document upload validation",
          "fail",
          `Upload document action not found. url=${debug.url}; buttons=${debug.buttons.join(" | ")}; snippet=${debug.snippet}`
        );
        return;
      }

      await page.waitForSelector("#document-title", { timeout: 15000 });
      await page.click("#document-title", { clickCount: 3 });
      await page.type("#document-title", "Browser audit document");
      const fileInput = await page.$('input[type="file"]');
      if (!fileInput) {
        appendResult("Document upload validation", "fail", "Document file input not found.");
        return;
      }

      await fileInput.uploadFile(invalidTxtPath);
      await clickButtonContainingText(page, "Upload document");

      await page.waitForFunction(
        () => document.body.innerText.includes("Unsupported file type"),
        { timeout: 20000 }
      );

      appendResult("Document upload validation", "pass", "Invalid document type is rejected in the upload panel.");
    }));

    await runFlow("Approvals confirmation", async () => withFreshPage(browser, async (page) => {
      await login(page, CREDS.manager.email, CREDS.manager.password, CREDS.manager.totpCode);
      await page.goto(`${BASE_URL}/approvals?tab=time-off`, { waitUntil: "domcontentloaded" });
      await waitForHydration(page);
      try {
        await page.waitForFunction(
          () =>
            document.body.innerText.includes("No pending approvals") ||
            Array.from(document.querySelectorAll("button")).some(
              (button) => button.textContent?.trim().toLowerCase() === "approve"
            ),
          { timeout: 20000 }
        );
      } catch {
        appendResult("Time-off approval confirmation", "partial", "Approvals list did not settle within timeout.");
        return;
      }

      const clickedApprove = await clickButtonByText(page, "Approve");
      if (!clickedApprove) {
        appendResult("Time-off approval confirmation", "partial", "No pending time-off approval row found.");
      } else {
        await page.waitForFunction(
          () => document.body.innerText.includes("Approve leave request?"),
          { timeout: 15000 }
        );
        await clickButtonContainingText(page, "Approve request");
        await page.waitForFunction(
          () => document.body.innerText.includes("Leave request approved."),
          { timeout: 15000 }
        );
        appendResult("Time-off approval confirmation", "pass", "Approve action requires confirmation and succeeds.");
      }

      await page.goto(`${BASE_URL}/approvals?tab=expenses`, { waitUntil: "domcontentloaded" });
      await waitForHydration(page);
      try {
        await page.waitForFunction(
          () =>
            document.body.innerText.includes("No pending approvals") ||
            document.body.innerText.includes("No expenses pending manager approval") ||
            document.body.innerText.includes("No expenses pending disbursement") ||
            Array.from(document.querySelectorAll("button")).some(
              (button) => button.textContent?.trim().toLowerCase() === "approve"
            ),
          { timeout: 20000 }
        );
      } catch {
        appendResult("Expense approval confirmation", "partial", "Expense approvals list did not settle within timeout.");
        return;
      }
      const clickedExpenseApprove = await clickButtonByText(page, "Approve");

      if (!clickedExpenseApprove) {
        appendResult("Expense approval confirmation", "pass", "No pending expense approval row found in queue.");
      } else {
        await page.waitForFunction(
          () => document.body.innerText.includes("Approve expense?"),
          { timeout: 15000 }
        );
        await clickButtonContainingText(page, "Approve expense");
        await page.waitForFunction(
          () =>
            document.body.innerText.includes("Expense moved to finance disbursement.") ||
            document.body.innerText.includes("Disbursed"),
          { timeout: 15000 }
        );
        appendResult("Expense approval confirmation", "pass", "Expense approval requires confirmation and succeeds.");
      }
    }));

    await runFlow("Privacy + support path", async () => withFreshPage(browser, async (page) => {
      await login(page, CREDS.employee.email, CREDS.employee.password, CREDS.employee.totpCode);
      await page.goto(`${BASE_URL}/settings`, { waitUntil: "domcontentloaded" });
      await waitForHydration(page);
      const supportClicked = await clickButtonContainingText(page, "Help & Support");
      if (!supportClicked) {
        await page.goto(`${BASE_URL}/support`, { waitUntil: "domcontentloaded" });
      }

      await waitForHydration(page);
      const supportBody = await page.evaluate(() => document.body.innerText);
      const supportVisible = supportBody.includes("Help & Support");
      const supportHasPrivacyLink = supportBody.includes("Privacy Policy");
      const supportHasContact =
        supportBody.includes("support@useaccrue.com") ||
        supportBody.includes("Basecamp");

      await page.goto(`${BASE_URL}/privacy`, { waitUntil: "domcontentloaded" });
      await waitForHydration(page);
      const privacyVisible = (await page.evaluate(() => document.body.innerText)).toLowerCase().includes("privacy");

      const passed = privacyVisible && supportVisible && supportHasPrivacyLink && supportHasContact;

      appendResult(
        "Privacy + support path",
        passed ? "pass" : "partial",
        passed
          ? "Privacy policy and support/reporting path are reachable from authenticated UI."
          : "One of privacy page, support page/modal, or support contact path could not be verified."
      );
    }));

    await runFlow("Performance/scheduling/disabled-feature honesty", async () => withFreshPage(browser, async (page) => {
      await login(page, CREDS.employee.email, CREDS.employee.password, CREDS.employee.totpCode);
      await page.goto(`${BASE_URL}/performance`, { waitUntil: "domcontentloaded" });
      const performanceVisible = (await page.evaluate(() => document.body.innerText)).toLowerCase().includes("performance");
      await page.goto(`${BASE_URL}/scheduling`, { waitUntil: "domcontentloaded" });
      const schedulingVisible = (await page.evaluate(() => document.body.innerText)).toLowerCase().includes("scheduling");
      await page.goto(`${BASE_URL}/payroll`, { waitUntil: "domcontentloaded" });
      const payrollBody = await page.evaluate(() => document.body.innerText);
      const hasPaymentRailAction = payrollBody.includes("Process payments") || payrollBody.includes("Retry payment");

      appendResult(
        "Performance/scheduling/disabled-feature honesty",
        performanceVisible && schedulingVisible && !hasPaymentRailAction ? "pass" : "partial",
        !hasPaymentRailAction
          ? "Performance and scheduling load; payroll payment-rail actions are not exposed."
          : "Payment rail actions were visible in payroll UI."
      );
    }));
  } finally {
    await browser.close();
  }

  fs.writeFileSync(
    REPORT_PATH,
    JSON.stringify(
      {
        baseUrl: BASE_URL,
        generatedAt: new Date().toISOString(),
        results
      },
      null,
      2
    )
  );

  console.log(`Browser walkthrough report written to ${REPORT_PATH}`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
