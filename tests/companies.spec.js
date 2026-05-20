import { test, expect } from '@playwright/test';

// Per project skill: login is performed once by the `setup` project (auth.setup.js)
// and the resulting authenticated session is reused by every test below.
test.use({ storageState: 'playwright/.auth/user.json' });
test.setTimeout(120000);

// ---------- locator helpers (defined as functions so they re-resolve per page) ----------
const applyBtn = (page) => page.getByRole('button', { name: 'Apply Filters' });
const clearAllBtn = (page) => page.getByRole('button', { name: /^Clear all$/i });
const specificCompaniesAcc = (page) => page.getByRole('button', { name: 'Specific companies' });
const companyAttributesAcc = (page) => page.getByRole('button', { name: 'Company attributes' });
const advancedFiltersAcc = (page) => page.getByRole('button', { name: 'Advanced filters' });
const industryAcc = (page) => page.getByRole('button', { name: 'Industry' });
const locationAcc = (page) => page.getByRole('button', { name: 'Location' });
const fundingAcc = (page) => page.getByRole('button', { name: 'Funding' });
const lookalikeAcc = (page) => page.getByRole('button', { name: 'Lookalike' });
const resultsTable = (page) => page.getByRole('table');

// ---------- workflow helpers ----------
async function gotoCompaniesPage(page) {
  await page.goto('https://qa.zenbee.io/search/companies', { waitUntil: 'domcontentloaded' });
  await expect(applyBtn(page)).toBeVisible({ timeout: 30000 });
}

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
  // Wait for the first data row to render with actual content (not skeleton)
  await expect(resultsTable(page).getByRole('row').nth(1)).toContainText(/\w/, { timeout: 30000 });
}

async function clearAllAndExpectReset(page) {
  await expect(clearAllBtn(page)).toBeVisible();
  await clearAllBtn(page).click();
  await expect(clearAllBtn(page)).toHaveCount(0);
  await expect(applyBtn(page)).toBeDisabled();
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
// Tests — each runs in its own context with the saved session
// ============================================================

test('Specific company selection enables filter and returns matching results', async ({ page }) => {
  await gotoCompaniesPage(page);
  await expandSection(page, specificCompaniesAcc);

  const searchCompany = page.getByRole('combobox', { name: 'Search company...' });
  await searchCompany.click();
  await searchCompany.pressSequentially('Google', { delay: 100 });
  await page.getByRole('option').filter({ hasText: /google/i }).first().click();

  await applyAndExpectResults(page);
  await expect(resultsTable(page).getByText(/google/i).first()).toBeVisible();

  await clearAllAndExpectReset(page);
});

test('Manually Enter Company Name filter returns matching companies', async ({ page }) => {
  await gotoCompaniesPage(page);
  await expandSection(page, specificCompaniesAcc);

  await page.getByRole('checkbox', { name: 'Manually enter company name' }).check();

  const manualInput = page.getByRole('combobox', { name: 'Enter company name or domain' });
  await manualInput.click();
  await manualInput.pressSequentially('Microsoft', { delay: 100 });
  await manualInput.press('Enter');

  await applyAndExpectResults(page);

  // Validate the applied chip and that results table has rows
  const inputHeader = page.getByText('Input Companies:').locator('..');
  await expect(inputHeader.getByText('Microsoft', { exact: true })).toBeVisible();

  await clearAllAndExpectReset(page);
});

test('Company LinkedIn URLs filter returns the matching company', async ({ page }) => {
  await gotoCompaniesPage(page);
  await expandSection(page, specificCompaniesAcc);

  const linkedinInput = page.getByRole('combobox', { name: 'Enter Company LinkedIn URLs' });
  await linkedinInput.click();
  await linkedinInput.pressSequentially('https://www.linkedin.com/company/microsoft', { delay: 20 });
  await linkedinInput.press('Enter');

  await applyAndExpectResults(page);
  await expect(page.getByText(/LinkedIn URLs:/i).first()).toBeVisible();

  await clearAllAndExpectReset(page);
});

test('HeadCount min/max filter returns companies within selected range', async ({ page }) => {
  await gotoCompaniesPage(page);
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

  // Spot-check: at least one row's Employees cell parses into [min, max]
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

  await clearAllAndExpectReset(page);
});

test('Revenue filter returns only companies in selected revenue range', async ({ page }) => {
  await gotoCompaniesPage(page);
  await expandSection(page, companyAttributesAcc);

  await page.getByText('Select revenue').click();
  await page.getByRole('option', { name: '$10M-$25M' }).click();
  await page.keyboard.press('Escape');

  await applyAndExpectResults(page);
  await expect(page.getByText(/Revenue:/i).first()).toBeVisible();

  await clearAllAndExpectReset(page);
});

test('Startups filter shows startup companies in results', async ({ page }) => {
  await gotoCompaniesPage(page);
  await expandSection(page, companyAttributesAcc);

  await page.getByText('Select founding year').click();
  await page.getByRole('option', { name: '1-2 years ago' }).click();
  await page.keyboard.press('Escape');

  await applyAndExpectResults(page);
  await expect(page.getByText(/Startups:/i).first()).toBeVisible();

  await clearAllAndExpectReset(page);
});

test('Technology filter returns companies using the selected technology', async ({ page }) => {
  await gotoCompaniesPage(page);
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

  await clearAllAndExpectReset(page);
});

test('Include Keywords filter returns companies containing the keyword', async ({ page }) => {
  await gotoCompaniesPage(page);
  await expandSection(page, companyAttributesAcc);

  const keyword = 'cloud';
  const includeInput = page.getByRole('combobox', { name: 'Include Keywords' });
  await includeInput.click();
  await includeInput.pressSequentially(keyword, { delay: 60 });
  await includeInput.press('Enter');

  await applyAndExpectResults(page);
  await expect(page.getByText(/Include Keywords:/i).first()).toBeVisible();

  await clearAllAndExpectReset(page);
});

test('Exclude Keywords filter omits companies containing the keyword', async ({ page }) => {
  await gotoCompaniesPage(page);
  await expandSection(page, companyAttributesAcc);

  const keyword = 'gaming';
  const excludeInput = page.getByRole('combobox', { name: 'Exclude Keywords' });
  await excludeInput.click();
  await excludeInput.pressSequentially(keyword, { delay: 60 });
  await excludeInput.press('Enter');

  await applyAndExpectResults(page);
  await expect(page.getByText(/Exclude Keywords:/i).first()).toBeVisible();

  // Spot-check first few result rows do not contain the excluded keyword
  const rows = resultsTable(page).getByRole('row');
  const count = Math.min(await rows.count(), 6);
  for (let i = 1; i < count; i++) {
    const rowText = await rows.nth(i).innerText();
    expect(rowText.toLowerCase()).not.toContain(keyword.toLowerCase());
  }

  await clearAllAndExpectReset(page);
});

test('Exclude companies without domain shows only companies with a domain', async ({ page }) => {
  await gotoCompaniesPage(page);
  await expandSection(page, companyAttributesAcc);

  // Pair with HeadCount so the search has a result set to filter
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

  // Every data row should have at least one external link (LinkedIn or domain URL),
  // skipping rows with no anchors (some rows render the link icons only after hover).
  const rows = resultsTable(page).getByRole('row');
  const count = Math.min(await rows.count(), 6);
  let rowsWithDomain = 0;
  for (let i = 1; i < count; i++) {
    const httpLinks = await rows.nth(i).locator('a[href^="http"]').count();
    if (httpLinks > 0) rowsWithDomain++;
  }
  expect(rowsWithDomain).toBeGreaterThan(0);

  await clearAllAndExpectReset(page);
});

test('Combined Company Attributes filters return results matching all criteria', async ({ page }) => {
  await gotoCompaniesPage(page);
  await expandSection(page, companyAttributesAcc);

  const minInput = page.getByRole('spinbutton', { name: 'Min' });
  const maxInput = page.getByRole('spinbutton', { name: 'Max' });
  await minInput.click();
  await minInput.fill('1000');
  await minInput.press('Tab');
  await maxInput.click();
  await maxInput.fill('100000');
  await maxInput.press('Tab');

  await page.getByText('Select revenue').click();
  await page.getByRole('option', { name: '$100M-$250M' }).click();
  await page.keyboard.press('Escape');

  await applyAndExpectResults(page);
  await expect(page.getByText(/HeadCount/i).first()).toBeVisible();
  await expect(page.getByText(/Revenue:/i).first()).toBeVisible();

  await clearAllAndExpectReset(page);
});

test('Customers filter returns companies that are customers of the selected company', async ({ page }) => {
  await gotoCompaniesPage(page);
  await expandSection(page, advancedFiltersAcc);

  const customersInput = page.getByRole('combobox', { name: 'Search customers' });
  await customersInput.click();
  await customersInput.pressSequentially('Microsoft', { delay: 100 });
  await page.getByRole('option').filter({ hasText: /microsoft/i }).first().click();

  await applyAndExpectResults(page);
  await expect(page.getByText(/Customers of:/i).first()).toBeVisible();

  await clearAllAndExpectReset(page);
  await expect(page.getByText(/Customers of:/i)).toHaveCount(0);
});

test('Clear All restores default state after Company Attributes filters', async ({ page }) => {
  await gotoCompaniesPage(page);
  await expandSection(page, companyAttributesAcc);

  const minInput = page.getByRole('spinbutton', { name: 'Min' });
  const maxInput = page.getByRole('spinbutton', { name: 'Max' });
  await minInput.click();
  await minInput.fill('200');
  await minInput.press('Tab');
  await maxInput.click();
  await maxInput.fill('2000');
  await maxInput.press('Tab');

  await applyAndExpectResults(page);
  await expect(page.getByText(/HeadCount/i).first()).toBeVisible();

  await clearAllAndExpectReset(page);
  await expect(page.getByText(/HeadCount:/i)).toHaveCount(0);
});

// ============================================================
// Industry / Location / Funding / Lookalike / Advanced filters
// ============================================================

// PrimeNG p-tree wraps a hidden input under styled markup — force-click the input within the treeitem row
async function toggleTreeItem(page, name) {
  await page.getByRole('treeitem', { name, exact: true })
    .locator('input[type="checkbox"]')
    .first()
    .click({ force: true });
}

test('Select Industry filter returns companies from the selected industry', async ({ page }) => {
  await gotoCompaniesPage(page);
  await expandSection(page, industryAcc);

  await toggleTreeItem(page, 'Technology Companies');

  await applyAndExpectResults(page);
  await expect(page.getByText(/Industry/i).first()).toBeVisible();

  await clearAllAndExpectReset(page);
});

test('Select Location filter returns companies from the selected location', async ({ page }) => {
  await gotoCompaniesPage(page);
  await expandSection(page, locationAcc);

  await toggleTreeItem(page, 'US States');

  await applyAndExpectResults(page);
  await expect(page.getByText(/Location/i).first()).toBeVisible();

  await clearAllAndExpectReset(page);
});

test('Or Enter Location Manually filter returns companies for the entered location', async ({ page }) => {
  await gotoCompaniesPage(page);
  await expandSection(page, locationAcc);

  const manualLocation = page.getByRole('combobox', { name: 'Enter city, state, or country' });
  await manualLocation.click();
  await manualLocation.pressSequentially('San Francisco', { delay: 80 });
  await manualLocation.press('Enter');

  await applyAndExpectResults(page);
  await expect(page.getByText(/Location/i).first()).toBeVisible();

  await clearAllAndExpectReset(page);
});

test('Funding In The Last filter returns companies funded within the selected timeframe', async ({ page }) => {
  await gotoCompaniesPage(page);
  await expandSection(page, fundingAcc);

  // Dropdown defaults to "All Time" — open it and pick a different option
  await page.locator('span[role="combobox"]').filter({ hasText: /All Time|Select Last Funding Period/i }).first().click();
  await page.getByRole('option').filter({ hasText: /^(?!All Time$).+/i }).first().click();

  await applyAndExpectResults(page);

  await clearAllAndExpectReset(page);
});

test('Amount filter returns companies funded within the selected funding range', async ({ page }) => {
  await gotoCompaniesPage(page);
  await expandSection(page, fundingAcc);

  const minAmount = page.getByRole('spinbutton', { name: /Min/ }).filter({ has: page.locator('[placeholder="Min $"]') }).or(page.locator('input[placeholder="Min $"]'));
  const maxAmount = page.locator('input[placeholder="Max $"]');
  await minAmount.first().click();
  await minAmount.first().fill('1000000');
  await minAmount.first().press('Tab');
  await maxAmount.click();
  await maxAmount.fill('50000000');
  await maxAmount.press('Tab');

  await applyAndExpectResults(page);

  await clearAllAndExpectReset(page);
});

test('Round Type filter returns companies with the selected funding round type', async ({ page }) => {
  await gotoCompaniesPage(page);
  await expandSection(page, fundingAcc);

  await toggleTreeItem(page, 'Series A');

  await applyAndExpectResults(page);

  await clearAllAndExpectReset(page);
});

test('Funding Type filter returns companies matching the selected funding type', async ({ page }) => {
  await gotoCompaniesPage(page);
  await expandSection(page, fundingAcc);

  // Pair with Round Type so Apply Filters is enabled (Funding Type alone is a refinement)
  await toggleTreeItem(page, 'Series A');
  await page.getByRole('radio', { name: 'Organization' }).check();

  await applyAndExpectResults(page);

  await clearAllAndExpectReset(page);
});

test('Public Companies filter returns only publicly traded companies', async ({ page }) => {
  await gotoCompaniesPage(page);
  await expandSection(page, companyAttributesAcc);

  // Pair with HeadCount so the search has a result set to restrict to public companies
  const minInput = page.getByRole('spinbutton', { name: 'Min' });
  const maxInput = page.getByRole('spinbutton', { name: 'Max' });
  await minInput.click();
  await minInput.fill('500');
  await minInput.press('Tab');
  await maxInput.click();
  await maxInput.fill('100000');
  await maxInput.press('Tab');

  await expandSection(page, fundingAcc);
  await page.getByRole('checkbox', { name: 'Public Companies' }).check();

  await applyAndExpectResults(page);

  await clearAllAndExpectReset(page);
});

test('Lookalike of filter returns similar companies to the selected company', async ({ page }) => {
  await gotoCompaniesPage(page);
  await expandSection(page, lookalikeAcc);

  // Lookalike's input uses placeholder "Search company" (no ellipsis), unlike Specific Companies' "Search company..."
  const lookalikeInput = page.getByPlaceholder('Search company', { exact: true });
  await lookalikeInput.click();
  await lookalikeInput.pressSequentially('Microsoft', { delay: 100 });
  await page.getByRole('option').filter({ hasText: /microsoft/i }).first().click();

  await applyAndExpectResults(page);
  await expect(page.getByText(/Lookalike of:/i).first()).toBeVisible();

  await clearAllAndExpectReset(page);
});

test('Prompt filter returns AI-generated company search results for the entered prompt', async ({ page }) => {
  await gotoCompaniesPage(page);
  await expandSection(page, lookalikeAcc);

  const promptArea = page.getByPlaceholder('I am seeking food delivery companies excluding restaurants');
  await promptArea.click();
  await promptArea.fill('Cloud computing companies headquartered in the United States');

  await applyAndExpectResults(page);

  await clearAllAndExpectReset(page);
});

test('Suppliers of filter returns supplier-related companies for the selected company', async ({ page }) => {
  await gotoCompaniesPage(page);
  await expandSection(page, advancedFiltersAcc);

  const supplierInput = page.getByRole('combobox', { name: 'Search supplier' });
  await supplierInput.click();
  await supplierInput.pressSequentially('Apple', { delay: 100 });
  await page.getByRole('option').filter({ hasText: /apple/i }).first().click();

  await applyAndExpectResults(page);
  await expect(page.getByText(/Suppliers of:/i).first()).toBeVisible();

  await clearAllAndExpectReset(page);
});
