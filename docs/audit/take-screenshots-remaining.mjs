import puppeteer from 'puppeteer';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOT_DIR = path.join(__dirname, 'screenshots-post');
const BASE_URL = 'http://localhost:3000';

const PAGES = [
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
  await new Promise(r => setTimeout(r, 1000));
}

async function run() {
  const browser = await puppeteer.launch({
    headless: true,
    defaultViewport: { width: 1440, height: 900 },
    args: ['--no-sandbox'],
  });

  for (const { url, name } of PAGES) {
    console.log(`\n--- ${name} ---`);

    // Use a fresh page for each to avoid detached frame issues
    const page = await browser.newPage();

    try {
      await page.goto(`${BASE_URL}${url}`, { waitUntil: 'networkidle2', timeout: 15000 });
    } catch {
      try {
        await page.goto(`${BASE_URL}${url}`, { waitUntil: 'domcontentloaded', timeout: 10000 });
      } catch (e) {
        console.log(`  ✗ Failed to load ${url}: ${e.message}`);
        await page.close();
        continue;
      }
    }
    await waitForPage(page);

    // Light mode
    try {
      await page.evaluate(() => {
        document.documentElement.classList.remove('dark');
        localStorage.setItem('theme', 'light');
      });
      await new Promise(r => setTimeout(r, 500));
      await page.screenshot({ path: path.join(SCREENSHOT_DIR, `${name}-light.png`), fullPage: true });
      console.log(`  ✓ ${name}-light.png`);
    } catch (e) {
      console.log(`  ✗ Light screenshot failed: ${e.message}`);
    }

    // Dark mode - reload page fresh to avoid detached frame
    try {
      await page.goto(`${BASE_URL}${url}`, { waitUntil: 'networkidle2', timeout: 15000 });
    } catch { /* ok */ }
    await waitForPage(page);

    try {
      await page.evaluate(() => {
        document.documentElement.classList.add('dark');
        localStorage.setItem('theme', 'dark');
      });
      await new Promise(r => setTimeout(r, 500));
      await page.screenshot({ path: path.join(SCREENSHOT_DIR, `${name}-dark.png`), fullPage: true });
      console.log(`  ✓ ${name}-dark.png`);
    } catch (e) {
      console.log(`  ✗ Dark screenshot failed: ${e.message}`);
    }

    await page.close();
  }

  await browser.close();
  console.log('\n✅ Remaining screenshots done.');
}

run().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
