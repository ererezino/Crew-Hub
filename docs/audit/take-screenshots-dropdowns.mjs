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
  console.log('Logging in...');
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

  try {
    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 });
  } catch { /* may already have navigated */ }
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

async function screenshot(page, name) {
  const filepath = path.join(SCREENSHOT_DIR, `${name}.png`);
  await page.screenshot({ path: filepath, fullPage: false }); // viewport only for dropdowns
  console.log(`  ✓ ${name}.png`);
}

async function run() {
  const browser = await puppeteer.launch({
    headless: true,
    defaultViewport: { width: 1440, height: 900 },
    args: ['--no-sandbox'],
  });

  const page = await browser.newPage();
  await login(page);

  // Go to dashboard
  await page.goto(`${BASE_URL}/dashboard`, { waitUntil: 'networkidle2', timeout: 15000 });
  await waitMs(2000);

  // --- NOTIFICATIONS DROPDOWN ---
  console.log('\n--- Notifications dropdown ---');
  for (const theme of ['light', 'dark']) {
    await setTheme(page, theme);
    // Find and click the notification bell button
    try {
      // Look for the bell icon button in the header
      const bellButton = await page.evaluateHandle(() => {
        // Try various selectors for the notification bell
        const candidates = [
          ...document.querySelectorAll('button[aria-label*="otif"]'),
          ...document.querySelectorAll('button[aria-label*="bell"]'),
          ...document.querySelectorAll('[data-testid*="notif"]'),
          ...document.querySelectorAll('header button'),
          ...document.querySelectorAll('nav button'),
        ];
        // Look for the one with a bell icon or notification badge
        for (const el of candidates) {
          const svg = el.querySelector('svg');
          if (svg && (el.getAttribute('aria-label')?.includes('otif') ||
                      el.innerHTML.includes('bell') ||
                      el.querySelector('.absolute') || // badge indicator
                      el.querySelector('[class*="badge"]'))) {
            return el;
          }
        }
        // Fallback: find buttons in header area with SVG icons
        const headerButtons = document.querySelectorAll('header button, [class*="header"] button, [class*="topbar"] button, [class*="navbar"] button');
        for (const btn of headerButtons) {
          if (btn.querySelector('svg') && !btn.textContent.includes('Search')) {
            return btn;
          }
        }
        return null;
      });

      if (bellButton) {
        await bellButton.click();
        await waitMs(1500);
        await screenshot(page, `dropdown-notifications-${theme}`);
        // Close by clicking elsewhere
        await page.mouse.click(100, 100);
        await waitMs(500);
      } else {
        console.log(`  ✗ Could not find notification bell (${theme})`);
      }
    } catch (e) {
      console.log(`  ✗ Notifications error (${theme}): ${e.message}`);
    }
  }

  // --- PROFILE / USER DROPDOWN ---
  console.log('\n--- Profile dropdown ---');
  for (const theme of ['light', 'dark']) {
    await setTheme(page, theme);
    try {
      // Look for the avatar/profile button (usually last button in header)
      const profileButton = await page.evaluateHandle(() => {
        const candidates = [
          ...document.querySelectorAll('button[aria-label*="rofile"]'),
          ...document.querySelectorAll('button[aria-label*="ser"]'),
          ...document.querySelectorAll('button[aria-label*="ccount"]'),
          ...document.querySelectorAll('[data-testid*="avatar"]'),
          ...document.querySelectorAll('[data-testid*="profile"]'),
        ];
        if (candidates.length > 0) return candidates[0];

        // Fallback: find avatar-like element (usually has initials or image)
        const headerButtons = document.querySelectorAll('header button, [class*="header"] button, [class*="topbar"] button');
        const buttons = Array.from(headerButtons);
        // Profile is usually the rightmost button
        for (const btn of buttons.reverse()) {
          if (btn.querySelector('img') ||
              btn.querySelector('[class*="avatar"]') ||
              btn.textContent.match(/^[A-Z]{1,2}$/)) {
            return btn;
          }
        }
        // Last resort: last button in header
        return buttons[0] || null;
      });

      if (profileButton) {
        await profileButton.click();
        await waitMs(1500);
        await screenshot(page, `dropdown-profile-${theme}`);
        await page.mouse.click(100, 100);
        await waitMs(500);
      } else {
        console.log(`  ✗ Could not find profile button (${theme})`);
      }
    } catch (e) {
      console.log(`  ✗ Profile error (${theme}): ${e.message}`);
    }
  }

  // --- SEARCH/COMMAND PALETTE ---
  console.log('\n--- Search / Command palette ---');
  for (const theme of ['light', 'dark']) {
    await setTheme(page, theme);
    try {
      // Try Cmd+K to open command palette
      await page.keyboard.down('Meta');
      await page.keyboard.press('KeyK');
      await page.keyboard.up('Meta');
      await waitMs(1500);

      // Check if something opened
      const opened = await page.evaluate(() => {
        return !!document.querySelector('[role="dialog"], [class*="command"], [class*="modal"], [class*="search"], [class*="palette"]');
      });
      if (opened) {
        await screenshot(page, `dropdown-search-${theme}`);
        await page.keyboard.press('Escape');
        await waitMs(500);
      } else {
        console.log(`  ✗ Command palette didn't open (${theme})`);
      }
    } catch (e) {
      console.log(`  ✗ Search error (${theme}): ${e.message}`);
    }
  }

  // --- SIDEBAR COLLAPSED vs EXPANDED ---
  console.log('\n--- Sidebar states ---');
  for (const theme of ['light', 'dark']) {
    await setTheme(page, theme);
    try {
      // Look for hamburger / sidebar toggle
      const toggleButton = await page.evaluateHandle(() => {
        const candidates = [
          ...document.querySelectorAll('button[aria-label*="enu"]'),
          ...document.querySelectorAll('button[aria-label*="idebar"]'),
          ...document.querySelectorAll('button[aria-label*="toggle"]'),
          ...document.querySelectorAll('[data-testid*="sidebar-toggle"]'),
          ...document.querySelectorAll('[data-testid*="menu-toggle"]'),
        ];
        if (candidates.length > 0) return candidates[0];
        // Fallback: first button that has a menu/hamburger icon
        const buttons = document.querySelectorAll('button');
        for (const btn of buttons) {
          if (btn.querySelector('svg') &&
              (btn.getAttribute('aria-label')?.match(/menu|sidebar|toggle/i) ||
               btn.className.match(/menu|sidebar|toggle|hamburger/i))) {
            return btn;
          }
        }
        return null;
      });

      if (toggleButton) {
        await toggleButton.click();
        await waitMs(1000);
        await screenshot(page, `sidebar-expanded-${theme}`);
        // Toggle back
        await toggleButton.click();
        await waitMs(500);
      } else {
        console.log(`  ✗ Could not find sidebar toggle (${theme})`);
      }
    } catch (e) {
      console.log(`  ✗ Sidebar error (${theme}): ${e.message}`);
    }
  }

  // --- DARK MODE TOGGLE (the theme switcher itself) ---
  console.log('\n--- Theme toggle button ---');
  // Already captured in context of other screenshots

  await browser.close();
  console.log('\n✅ Dropdown screenshots saved.');
}

run().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
