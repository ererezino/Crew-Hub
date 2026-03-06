import puppeteer from 'puppeteer';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOT_DIR = path.join(__dirname, 'screenshots-post');
const BASE_URL = 'http://localhost:3000';

async function waitMs(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function login(page) {
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle2', timeout: 30000 });
  await waitMs(1000);
  const emailInput = await page.waitForSelector('input[type="email"], input[name="email"]', { timeout: 5000 });
  await emailInput.click({ clickCount: 3 });
  await emailInput.type('zino@useaccrue.com');
  const passwordInput = await page.waitForSelector('input[type="password"], input[name="password"]', { timeout: 5000 });
  await passwordInput.click({ clickCount: 3 });
  await passwordInput.type('Aa27262443@');
  const submitButton = await page.waitForSelector('button[type="submit"]', { timeout: 5000 });
  await submitButton.click();
  try { await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }); } catch {}
  await waitMs(3000);
  console.log('Logged in. URL:', page.url());
}

async function setTheme(page, theme) {
  await page.evaluate((t) => {
    document.documentElement.classList.toggle('dark', t === 'dark');
    localStorage.setItem('theme', t);
  }, theme);
  await waitMs(500);
}

async function run() {
  const browser = await puppeteer.launch({
    headless: true,
    defaultViewport: { width: 1440, height: 900 },
    args: ['--no-sandbox'],
  });

  const page = await browser.newPage();
  await login(page);
  await page.goto(`${BASE_URL}/dashboard`, { waitUntil: 'networkidle2', timeout: 15000 });
  await waitMs(2000);

  for (const theme of ['light', 'dark']) {
    await setTheme(page, theme);

    // The hamburger menu is the top-left button (first button on the page, or in the top-left area)
    // Click at approximately where the hamburger icon is visible (top-left corner area)
    console.log(`\nClicking hamburger for ${theme} mode...`);

    // Click the hamburger - it's the button in the very top-left of the page
    await page.mouse.click(35, 22); // approximate position of hamburger based on screenshots
    await waitMs(1500);

    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, `sidebar-expanded-${theme}.png`),
      fullPage: false
    });
    console.log(`  ✓ sidebar-expanded-${theme}.png`);

    // Close sidebar by clicking elsewhere
    await page.mouse.click(700, 400);
    await waitMs(500);
  }

  await browser.close();
  console.log('\nDone.');
}

run().catch(err => { console.error('Fatal:', err); process.exit(1); });
