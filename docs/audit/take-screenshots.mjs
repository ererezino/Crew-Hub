import puppeteer from 'puppeteer';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOT_DIR = path.join(__dirname, 'screenshots-post');
const BASE_URL = 'http://localhost:3000';

const PAGES = [
  { url: '/', name: 'dashboard' },
  { url: '/announcements', name: 'announcements' },
  { url: '/time-off', name: 'time-off' },
  { url: '/time-off?tab=calendar', name: 'time-off-calendar' },
  { url: '/approvals', name: 'approvals' },
  { url: '/approvals?tab=time-off', name: 'approvals-time-off' },
  { url: '/approvals?tab=expenses', name: 'approvals-expenses' },
  { url: '/approvals?tab=timesheets', name: 'approvals-timesheets' },
  { url: '/people', name: 'people' },
  { url: '/scheduling', name: 'scheduling' },
  { url: '/scheduling?tab=open-shifts', name: 'scheduling-open-shifts' },
  { url: '/scheduling?tab=swap-requests', name: 'scheduling-swap-requests' },
  { url: '/scheduling?tab=manage', name: 'scheduling-manage' },
  { url: '/scheduling?tab=templates', name: 'scheduling-templates' },
  { url: '/onboarding', name: 'onboarding' },
  { url: '/onboarding?tab=completed', name: 'onboarding-completed' },
  { url: '/onboarding?tab=at-risk', name: 'onboarding-at-risk' },
  { url: '/onboarding?tab=templates', name: 'onboarding-templates' },
  { url: '/expenses', name: 'expenses' },
  { url: '/expenses/reports', name: 'expense-reports' },
  { url: '/documents', name: 'documents' },
  { url: '/learning', name: 'learning' },
  { url: '/learning?tab=certificates', name: 'learning-certificates' },
  { url: '/learning?tab=surveys', name: 'learning-surveys' },
  { url: '/performance', name: 'performance' },
  { url: '/performance/admin', name: 'performance-admin' },
  { url: '/signatures', name: 'signatures' },
  { url: '/notifications', name: 'notifications' },
  { url: '/payroll', name: 'payroll' },
  { url: '/payroll/runs/new', name: 'payroll-new-run' },
  { url: '/payroll/settings', name: 'payroll-settings' },
  { url: '/analytics', name: 'analytics' },
  { url: '/compliance', name: 'compliance' },
  { url: '/settings', name: 'settings' },
  { url: '/settings?tab=preferences', name: 'settings-preferences' },
  { url: '/settings?tab=security', name: 'settings-security' },
  { url: '/settings?tab=organization', name: 'settings-organization' },
  { url: '/settings?tab=time-policies', name: 'settings-time-policies' },
  { url: '/settings?tab=audit-log', name: 'settings-audit-log' },
  { url: '/me/pay', name: 'pay-payslips' },
  { url: '/me/pay?tab=payment-details', name: 'pay-payment-details' },
  { url: '/me/pay?tab=compensation', name: 'pay-compensation' },
  { url: '/me/onboarding', name: 'my-onboarding' },
  { url: '/me/documents', name: 'my-documents' },
  { url: '/admin/compensation', name: 'admin-compensation' },
  { url: '/admin/compensation-bands', name: 'admin-compensation-bands' },
  { url: '/admin/surveys', name: 'admin-surveys' },
  { url: '/admin/surveys/new', name: 'admin-surveys-new' },
  { url: '/admin/learning', name: 'admin-learning' },
  { url: '/admin/learning/reports', name: 'admin-learning-reports' },
  { url: '/admin/access-control', name: 'admin-access-control' },
  { url: '/admin/users', name: 'admin-users' },
];

async function waitForPage(page) {
  try {
    await page.waitForNetworkIdle({ idleTime: 500, timeout: 8000 });
  } catch { /* ok */ }
  await new Promise(r => setTimeout(r, 1500));
}

async function setTheme(page, theme) {
  await page.evaluate((t) => {
    document.documentElement.classList.toggle('dark', t === 'dark');
    localStorage.setItem('theme', t);
  }, theme);
  await new Promise(r => setTimeout(r, 500));
}

async function takeScreenshot(page, name, theme) {
  const filename = `${name}-${theme}.png`;
  const filepath = path.join(SCREENSHOT_DIR, filename);
  await page.screenshot({ path: filepath, fullPage: true });
  console.log(`  ✓ ${filename}`);
}

async function login(page) {
  console.log('Logging in...');
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 1000));

  // Type email
  const emailInput = await page.waitForSelector('input[type="email"], input[name="email"]', { timeout: 5000 });
  await emailInput.click({ clickCount: 3 });
  await emailInput.type('zino@useaccrue.com');

  // Type password
  const passwordInput = await page.waitForSelector('input[type="password"], input[name="password"]', { timeout: 5000 });
  await passwordInput.click({ clickCount: 3 });
  await passwordInput.type('Aa27262443@');

  // Click sign in button
  const submitButton = await page.waitForSelector('button[type="submit"]', { timeout: 5000 });
  await submitButton.click();

  // Wait for navigation away from login
  console.log('Waiting for login to complete...');
  try {
    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 });
  } catch { /* may already have navigated */ }
  await new Promise(r => setTimeout(r, 3000));

  const currentUrl = page.url();
  if (currentUrl.includes('/login')) {
    console.log('WARNING: Still on login page after login attempt. URL:', currentUrl);
  } else {
    console.log('Logged in successfully. Current URL:', currentUrl);
  }
}

async function run() {
  const browser = await puppeteer.launch({
    headless: true,
    defaultViewport: { width: 1440, height: 900 },
    args: ['--no-sandbox'],
  });

  const page = await browser.newPage();

  // Login first
  await login(page);

  // Screenshot login page (open new tab without session, or just screenshot current login page)
  // We'll do login separately at the end after logging out

  // Screenshot all authenticated pages
  for (const { url, name } of PAGES) {
    console.log(`\n--- ${name} ---`);

    // Use fresh page to avoid detached frame issues, but share browser context (cookies)
    const freshPage = await browser.newPage();
    try {
      try {
        await freshPage.goto(`${BASE_URL}${url}`, { waitUntil: 'networkidle2', timeout: 15000 });
      } catch {
        try {
          await freshPage.goto(`${BASE_URL}${url}`, { waitUntil: 'domcontentloaded', timeout: 10000 });
        } catch (e) {
          console.log(`  ✗ Failed to load ${url}: ${e.message}`);
          await freshPage.close();
          continue;
        }
      }
      await waitForPage(freshPage);

      // Check if redirected to login (session lost)
      if (freshPage.url().includes('/login')) {
        console.log(`  ✗ Redirected to login for ${url}, re-logging in...`);
        await login(freshPage);
        await freshPage.goto(`${BASE_URL}${url}`, { waitUntil: 'networkidle2', timeout: 15000 });
        await waitForPage(freshPage);
      }

      // Light mode
      await setTheme(freshPage, 'light');
      await takeScreenshot(freshPage, name, 'light');

      // Dark mode
      await setTheme(freshPage, 'dark');
      await takeScreenshot(freshPage, name, 'dark');

    } catch (e) {
      console.log(`  ✗ Error on ${name}: ${e.message}`);
    }

    await freshPage.close();
  }

  // Login page screenshot - use incognito context
  console.log('\n--- login ---');
  const incognito = await browser.createBrowserContext();
  const loginPage = await incognito.newPage();
  await loginPage.setViewport({ width: 1440, height: 900 });
  await loginPage.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle2', timeout: 15000 });
  await waitForPage(loginPage);
  await setTheme(loginPage, 'light');
  await takeScreenshot(loginPage, 'login', 'light');
  await setTheme(loginPage, 'dark');
  await takeScreenshot(loginPage, 'login', 'dark');
  await loginPage.close();
  await incognito.close();

  await browser.close();
  console.log('\n✅ All screenshots saved to docs/audit/screenshots-post/');
}

run().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
