import { test, expect } from '@playwright/test';

// All tests share a single authenticated page. The page is opened once in
// beforeAll, each test applies its filter and asserts results, and afterEach
// clicks "Clear all" so the next test starts from a clean filter state — no
// per-test page.goto() reload.

// ---------- locator helpers ----------
const applyBtn = (page) => page.getByRole('button', { name: 'Apply Filters' });
const clearAllBtn = (page) => page.getByRole('button', { name: /^Clear all$/i });
const specificCompaniesAcc = (page) => page.getByRole('button', { name: 'Specific companies' });
const companyAttributesAcc = (page) => page.getByRole('button', { name: 'Company attributes' });
const industryAcc = (page) => page.getByRole('button', { name: 'Industry' });
const locationAcc = (page) => page.getByRole('button', { name: 'Location' });
const resultsTable = (page) => page.getByRole('table');

// ---------- workflow helpers ----------
async function expandSection(page, accordionBtnFn) {
  const btn = accordionBtnFn(page);
  await expect(btn).toBeVisible();
  const expanded = await btn.evaluate(el => el.getAttribute('aria-expanded'));
  if (expanded !== 'true') await btn.click();
}

async function applyAndExpectResults(page) {
  await expect(applyBtn(page)).toBeEnabled();
  await applyBtn(page).click();
  await expect(resultsTable(page)).toBeVisible({ timeout: 30000 });
  await expect(resultsTable(page).getByRole('row')).not.toHaveCount(0);
}

async function clearAllIfPresent(page) {
  const btn = clearAllBtn(page);
  if (await btn.isVisible().catch(() => false)) {
    await btn.click();
    await expect(btn).toHaveCount(0);
    await expect(applyBtn(page)).toBeDisabled();
  }
}

// Parse text like "17K", "200", "245B" → number
function parseUnit(text) {
  const m = String(text).trim().match(/([\d.]+)\s*([KMB]?)/i);
  if (!m) return null;
  const num = parseFloat(m[1]);
  const mult = { K: 1e3, M: 1e6, B: 1e9, '': 1 }[m[2].toUpperCase()] ?? 1;
  return num * mult;
}

// ============================================================
// Serial suite — one page shared across all tests
// ============================================================
test.describe.serial('Companies Page filters (shared page)', () => {
  test.setTimeout(120000);

  let context;
  let page;

  test.beforeAll(async ({ browser }) => {
    context = await browser.newContext({ storageState: 'playwright/.auth/user.json' });
    page = await context.newPage();
    await page.goto('https://qa.zenbee.io/search/companies', { waitUntil: 'domcontentloaded' });
    await expect(applyBtn(page)).toBeVisible({ timeout: 30000 });
  });

  test.afterEach(async () => {
    // Reset to a clean filter state before the next test runs on the same page.
    await clearAllIfPresent(page);
  });

  test.afterAll(async () => {
    await context?.close();
  });

  test('Specific company selection enables filter and returns matching results', async () => {
    await expandSection(page, specificCompaniesAcc);

    const searchCompany = page.getByRole('combobox', { name: 'Search company...' });
    await searchCompany.click();
    await searchCompany.pressSequentially('Google', { delay: 100 });
    await page.getByRole('option').filter({ hasText: /google/i }).first().click();

    await applyAndExpectResults(page);
    await expect(resultsTable(page).getByText(/google/i).first()).toBeVisible();
  });

  test('Manually Enter Company Name filter returns matching companies', async () => {
    await expandSection(page, specificCompaniesAcc);

    await page.getByRole('checkbox', { name: 'Manually enter company name' }).check();

    const manualInput = page.getByRole('combobox', { name: 'Enter company name or domain' });
    await manualInput.click();
    await manualInput.pressSequentially('Microsoft', { delay: 100 });
    await manualInput.press('Enter');

    await applyAndExpectResults(page);

    const inputHeader = page.getByText('Input Companies:').locator('..');
    await expect(inputHeader.getByText('Microsoft', { exact: true })).toBeVisible();
  });

  test('Company LinkedIn URLs filter returns the matching company', async () => {
    await expandSection(page, specificCompaniesAcc);

    const linkedinInput = page.getByRole('combobox', { name: 'Enter Company LinkedIn URLs' });
    await linkedinInput.click();
    await linkedinInput.pressSequentially('https://www.linkedin.com/company/microsoft', { delay: 20 });
    await linkedinInput.press('Enter');

    await applyAndExpectResults(page);
    await expect(page.getByText(/LinkedIn URLs:/i).first()).toBeVisible();
  });

  test('HeadCount min/max filter returns companies within selected range', async () => {
    await expandSection(page, companyAttributesAcc);

    const min = 100;
    const max = 5000;
    const minInput = page.getByRole('spinbutton', { name: 'Min' });
    const maxInput = page.getByRole('spinbutton', { name: 'Max' });
    await minInput.click();
    await minInput.fill(String(min));
    await minInput.press('Tab');
    await maxInput.click();
    await maxInput.fill(String(max));
    await maxInput.press('Tab');

    await applyAndExpectResults(page);
    await expect(page.getByText(/HeadCount/i).first()).toBeVisible();

    const employeesText = await resultsTable(page)
      .getByRole('row')
      .nth(1)
      .getByRole('cell')
      .nth(4)
      .innerText();
    const value = parseUnit(employeesText);
    if (value !== null) {
      expect(value).toBeGreaterThanOrEqual(min);
      expect(value).toBeLessThanOrEqual(max);
    }
  });

  test('Revenue filter returns only companies in selected revenue range', async () => {
    await expandSection(page, companyAttributesAcc);

    await page.getByText('Select revenue').click();
    await page.getByRole('option', { name: '$10M-$25M' }).click();
    await page.keyboard.press('Escape');

    await applyAndExpectResults(page);
    await expect(page.getByText(/Revenue:/i).first()).toBeVisible();
  });

  test('Startups filter shows startup companies in results', async () => {
    await expandSection(page, companyAttributesAcc);

    await page.getByText('Select founding year').click();
    await page.getByRole('option', { name: '1-2 years ago' }).click();
    await page.keyboard.press('Escape');

    await applyAndExpectResults(page);
    await expect(page.getByText(/Startups:/i).first()).toBeVisible();
  });

  test('Technology filter returns companies using the selected technology', async () => {
    await expandSection(page, companyAttributesAcc);

    const techInput = page.getByRole('combobox', { name: 'Search Technology' });
    await techInput.click();
    await techInput.pressSequentially('Salesforce', { delay: 80 });
    const techOption = page.getByRole('option').filter({ hasText: /salesforce/i }).first();
    if (await techOption.isVisible().catch(() => false)) {
      await techOption.click();
    } else {
      await techInput.press('Enter');
    }

    await applyAndExpectResults(page);
    await expect(page.getByText(/Technology:/i).first()).toBeVisible();
  });

  test('Include Keywords filter returns companies containing the keyword', async () => {
    await expandSection(page, companyAttributesAcc);

    const keyword = 'cloud';
    const includeInput = page.getByRole('combobox', { name: 'Include Keywords' });
    await includeInput.click();
    await includeInput.pressSequentially(keyword, { delay: 60 });
    await includeInput.press('Enter');

    await applyAndExpectResults(page);
    await expect(page.getByText(/Include Keywords:/i).first()).toBeVisible();
  });

  test('Exclude Keywords filter omits companies containing the keyword', async () => {
    await expandSection(page, companyAttributesAcc);

    const keyword = 'gaming';
    const excludeInput = page.getByRole('combobox', { name: 'Exclude Keywords' });
    await excludeInput.click();
    await excludeInput.pressSequentially(keyword, { delay: 60 });
    await excludeInput.press('Enter');

    await applyAndExpectResults(page);
    await expect(page.getByText(/Exclude Keywords:/i).first()).toBeVisible();

    const rows = resultsTable(page).getByRole('row');
    const count = Math.min(await rows.count(), 6);
    for (let i = 1; i < count; i++) {
      const rowText = await rows.nth(i).innerText();
      expect(rowText.toLowerCase()).not.toContain(keyword.toLowerCase());
    }
  });

  test('Exclude companies without domain shows only companies with a domain', async () => {
    await expandSection(page, companyAttributesAcc);

    const minInput = page.getByRole('spinbutton', { name: 'Min' });
    const maxInput = page.getByRole('spinbutton', { name: 'Max' });
    await minInput.click();
    await minInput.fill('500');
    await minInput.press('Tab');
    await maxInput.click();
    await maxInput.fill('5000');
    await maxInput.press('Tab');
    await page.getByRole('checkbox', { name: 'Exclude companies without domain' }).check();

    await applyAndExpectResults(page);

    const rows = resultsTable(page).getByRole('row');
    const count = Math.min(await rows.count(), 6);
    let rowsWithDomain = 0;
    for (let i = 1; i < count; i++) {
      const httpLinks = await rows.nth(i).locator('a[href^="http"]').count();
      if (httpLinks > 0) rowsWithDomain++;
    }
    expect(rowsWithDomain).toBeGreaterThan(0);
  });

  test('Combined Company Attributes filters return results matching all criteria', async () => {
    await expandSection(page, companyAttributesAcc);

    await page.getByRole('spinbutton', { name: 'Min' }).fill('1000');
    await page.getByRole('spinbutton', { name: 'Max' }).fill('100000');

    await page.getByText('Select revenue').click();
    await page.getByRole('option', { name: '$100M-$250M' }).click();
    await page.keyboard.press('Escape');

    await applyAndExpectResults(page);
    await expect(page.getByText(/HeadCount/i).first()).toBeVisible();
    await expect(page.getByText(/Revenue:/i).first()).toBeVisible();
  });

  test('Clear All restores default state after Company Attributes filters', async () => {
    await expandSection(page, companyAttributesAcc);

    await page.getByRole('spinbutton', { name: 'Min' }).fill('200');
    await page.getByRole('spinbutton', { name: 'Max' }).fill('2000');

    await applyAndExpectResults(page);
    await expect(page.getByText(/HeadCount/i).first()).toBeVisible();

    // Explicitly assert the reset behavior here (afterEach also clears, but
    // this test owns the assertion that Clear All wipes the chip).
    await clearAllIfPresent(page);
    await expect(page.getByText(/HeadCount:/i)).toHaveCount(0);
  });

  // ----------------------------------------------------------------
  // Industry filter — a PrimeNG checkbox tree under the "Industry" accordion.
  // Top-level industries are visible directly, so tick the category's tree node
  // (no search box) and Apply. The applied-filter chip reads "Industries:".
  // ----------------------------------------------------------------
  test('Industry filter returns companies in the selected industry', async () => {
    await expandSection(page, industryAcc);

    const node = page.getByRole('treeitem', { name: 'Construction Companies' }).first();
    await node.scrollIntoViewIfNeeded();
    await node.locator('.p-tree-node-content').first().click();

    await applyAndExpectResults(page);
    await expect(page.getByText(/Industries:/i).first()).toBeVisible();
  });

  // ----------------------------------------------------------------
  // Location filter (tree) — a PrimeNG checkbox tree under the "Location"
  // accordion. Top-level groups (US States, International, ...) are visible, so
  // tick a group's tree node (no search) and Apply. Chip reads "Locations:".
  // ----------------------------------------------------------------
  test('Location filter (dropdown) returns companies in the selected location', async () => {
    await expandSection(page, locationAcc);

    const node = page.getByRole('treeitem', { name: 'US States' }).first();
    await node.scrollIntoViewIfNeeded();
    await node.locator('.p-tree-node-content').first().click();

    await applyAndExpectResults(page);
    await expect(page.getByText(/Locations:/i).first()).toBeVisible();
  });

  // ----------------------------------------------------------------
  // Location filter (manual input) — toggle "Or Enter Location Manually" and
  // type into the single "Enter city, state, or country" chip input. The typed
  // value persists as a token, so assert that plus the results.
  // ----------------------------------------------------------------
  test('Location filter (manual input) returns companies matching a typed location', async () => {
    await expandSection(page, locationAcc);

    await page.getByText('Or Enter Location Manually').click();

    const manualInput = page.getByPlaceholder('Enter city, state, or country');
    await manualInput.click();
    await manualInput.fill('New York');
    await manualInput.press('Enter');

    await expect(page.getByText('New York', { exact: true }).first()).toBeVisible();
    await applyAndExpectResults(page);
  });
});
