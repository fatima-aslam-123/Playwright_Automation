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
const fundingAcc = (page) => page.getByRole('button', { name: 'Funding' });
const lookalikeAcc = (page) => page.getByRole('button', { name: 'Lookalike' });
const advancedFiltersAcc = (page) => page.getByRole('button', { name: 'Advanced filters' });
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

// Type `query` into an autocomplete combobox and pick the first matching suggestion.
// Suggestions render in a separate "Option List" overlay; scope to it so we don't
// accidentally match the field's own wrapper option (the Lookalike input is itself
// wrapped in an <option> whose text mirrors the typed value).
async function chooseAutocomplete(page, comboName, query, optionRe) {
  const combo = page.getByRole('combobox', { name: comboName });
  await combo.click();
  // firefox can drop leading keystrokes when typing char by char, so set the bulk of
  // the text atomically with fill(), then type one real keystroke to trigger the
  // autocomplete search. Verify the full query landed before reading suggestions.
  await combo.fill(query.slice(0, -1));
  await combo.pressSequentially(query.slice(-1), { delay: 150 });
  await expect(combo).toHaveValue(new RegExp(query, 'i'));
  const option = page
    .getByRole('listbox', { name: 'Option List' })
    .getByRole('option')
    .filter({ hasText: optionRe })
    .first();
  await option.waitFor({ state: 'visible', timeout: 15000 });
  await option.click();
}

// ---------- single-filter setters (reused to build combination scenarios) ----------
async function setHeadCount(page, min, max) {
  await expandSection(page, companyAttributesAcc);
  // exact:true so "Min"/"Max" don't also match Funding's "Min $"/"Max $" spinbuttons
  // when the Funding accordion happens to be expanded from a prior scenario.
  const minInput = page.getByRole('spinbutton', { name: 'Min', exact: true });
  const maxInput = page.getByRole('spinbutton', { name: 'Max', exact: true });
  await minInput.click();
  await minInput.fill(String(min));
  await minInput.press('Tab');
  await maxInput.click();
  await maxInput.fill(String(max));
  await maxInput.press('Tab');
}

async function selectRevenue(page, label) {
  await expandSection(page, companyAttributesAcc);
  await page.getByText('Select revenue').click();
  await page.getByRole('option', { name: label }).click();
  await page.keyboard.press('Escape');
}

async function selectFoundingYear(page, label) {
  await expandSection(page, companyAttributesAcc);
  await page.getByText('Select founding year').click();
  await page.getByRole('option', { name: label }).click();
  await page.keyboard.press('Escape');
}

async function addTechnology(page, name) {
  await expandSection(page, companyAttributesAcc);
  const input = page.getByRole('combobox', { name: 'Search Technology' });
  await input.click();
  await input.pressSequentially(name, { delay: 80 });
  const option = page.getByRole('option').filter({ hasText: new RegExp(name, 'i') }).first();
  if (await option.isVisible().catch(() => false)) {
    await option.click();
  } else {
    await input.press('Enter');
  }
}

async function addKeyword(page, comboName, keyword) {
  await expandSection(page, companyAttributesAcc);
  const input = page.getByRole('combobox', { name: comboName });
  await input.click();
  await input.pressSequentially(keyword, { delay: 60 });
  await input.press('Enter');
}

async function selectTreeNode(page, accordionBtnFn, name) {
  await expandSection(page, accordionBtnFn);
  const node = page.getByRole('treeitem', { name }).first();
  await node.scrollIntoViewIfNeeded();
  await node.locator('.p-tree-node-content').first().click();
}

async function setFundingRound(page, roundLabel, min) {
  await expandSection(page, fundingAcc);
  await page.getByRole('button', { name: new RegExp(`^${roundLabel}$`, 'i') }).click();
  const minAmount = page.getByPlaceholder('Min $');
  await minAmount.click();
  await minAmount.fill(String(min));
  await minAmount.press('Tab');
}

async function setFundingAmount(page, min, max) {
  await expandSection(page, fundingAcc);
  const minAmount = page.getByPlaceholder('Min $');
  const maxAmount = page.getByPlaceholder('Max $');
  await minAmount.click();
  await minAmount.fill(String(min));
  await minAmount.press('Tab');
  await maxAmount.click();
  await maxAmount.fill(String(max));
  await maxAmount.press('Tab');
}

async function selectFundingType(page, label) {
  await expandSection(page, fundingAcc);
  const radio = page.getByRole('radio', { name: label });
  if (await radio.isVisible().catch(() => false)) {
    await radio.check();
  } else {
    await page.getByRole('checkbox', { name: label }).check();
  }
}

async function checkPublicCompanies(page) {
  await expandSection(page, fundingAcc);
  await page.getByRole('checkbox', { name: 'Public Companies' }).check();
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
    // Hook timeouts are NOT covered by test.setTimeout above — extend this hook's
    // own budget so a slow cold SPA boot doesn't blow the default 30s.
    test.setTimeout(120000);
    context = await browser.newContext({ storageState: 'playwright/.auth/user.json' });
    page = await context.newPage();
    await page.goto('https://qa.zenbee.io/search/companies', { waitUntil: 'domcontentloaded' });
    // domcontentloaded fires before the SPA hydrates. The boot splash
    // ("Loading your sales intelligence platform...") stays in the DOM behind the app,
    // so don't wait for it to hide — just wait (generously) for the real UI to render.
    await expect(applyBtn(page)).toBeVisible({ timeout: 90000 });
    // The content panel loader ("...prepare your search interface") clears only once the
    // app fully hydrates. On webkit the sidebar remounts at that point, so wait for the
    // loader to disappear before any test interacts with the accordions.
    await expect(page.getByText(/prepare your search interface/i))
      .toBeHidden({ timeout: 60000 });
    // Wipe any filter state that may have been persisted server-side from prior runs.
    await clearAllIfPresent(page);
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

    // The filter guarantees every returned company has a domain, rendered as a
    // "Visit Website" globe link (i.pi-globe). The old code counted rows via getByRole('row')
    // immediately after Apply, but the header row alone satisfies applyAndExpectResults'
    // "rows != 0" check while data rows are still loading — so the probe raced and saw 0.
    // Use a web-first assertion that waits for an actual website link to appear.
    const websiteLinks = resultsTable(page).locator('a:has(i.pi-globe)');
    await expect(websiteLinks.first()).toBeVisible({ timeout: 15000 });
    expect(await websiteLinks.count()).toBeGreaterThan(0);
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

  // ================================================================
  // Funding filter — accordion on the left panel with these sub-filters:
  //   1) Last Round / Any Round toggle pills
  //   2) "Funding In The Last" period dropdown
  //   3) Amount Min $ / Max $ range
  //   4) Select Round Type checkboxes (Series A–J, Angel, Seed, …)
  //   5) Select Funding Type radio (Organization / Person)
  //   6) Public Companies checkbox
  // Each test is independent — afterEach() clicks "Clear all" to reset state.
  // ================================================================

  test('Funding — Last Round toggle returns companies by last funding round', async () => {
    await expandSection(page, fundingAcc);

    await page.getByRole('button', { name: /^Last Round$/i }).click();
    const minAmount = page.getByPlaceholder('Min $');
    await minAmount.click();
    await minAmount.fill('1000000');
    await minAmount.press('Tab');

    await applyAndExpectResults(page);
    await expect(page.getByText(/Funding/i).first()).toBeVisible();
  });

  test('Funding — Any Round toggle returns companies by any funding round', async () => {
    await expandSection(page, fundingAcc);

    await page.getByRole('button', { name: /^Any Round$/i }).click();
    const minAmount = page.getByPlaceholder('Min $');
    await minAmount.click();
    await minAmount.fill('500000');
    await minAmount.press('Tab');

    await applyAndExpectResults(page);
    await expect(page.getByText(/Funding/i).first()).toBeVisible();
  });

  test('Funding — "Funding In The Last" period filter returns matching companies', async () => {
    await expandSection(page, fundingAcc);

    const periodCombo = page.getByRole('combobox', { name: 'Select Last Funding Period' });
    await periodCombo.click();              // open the PrimeVue select overlay
    await page.keyboard.press('ArrowDown'); // highlight the first real period option
    await page.keyboard.press('Enter');     // select it (also closes the overlay)

    await applyAndExpectResults(page);
    await expect(page.getByText(/Funding/i).first()).toBeVisible();
  });

  test('Funding — Amount Min/Max range returns companies within funding range', async () => {
    await expandSection(page, fundingAcc);

    const minAmount = page.getByPlaceholder('Min $');
    const maxAmount = page.getByPlaceholder('Max $');
    await minAmount.click();
    await minAmount.fill('1000000');
    await minAmount.press('Tab');
    await maxAmount.click();
    await maxAmount.fill('100000000');
    await maxAmount.press('Tab');

    await applyAndExpectResults(page);
    await expect(page.getByText(/Funding/i).first()).toBeVisible();
  });

  test('Funding — Round Type "Series A" returns companies with Series A round', async () => {
    await expandSection(page, fundingAcc);

    const node = page.getByRole('treeitem', { name: 'Series A' }).first();
    await node.scrollIntoViewIfNeeded();
    await node.locator('.p-tree-node-content').first().click();

    await applyAndExpectResults(page);
    await expect(page.getByText(/Funding|Round|Series A/i).first()).toBeVisible();
  });

  test('Funding — Round Type "Seed" returns companies with Seed round', async () => {
    await expandSection(page, fundingAcc);

    const node = page.getByRole('treeitem', { name: 'Seed' }).first();
    await node.scrollIntoViewIfNeeded();
    await node.locator('.p-tree-node-content').first().click();

    await applyAndExpectResults(page);
    await expect(page.getByText(/Funding|Round|Seed/i).first()).toBeVisible();
  });

  test('Funding — Funding Type "Organization" returns organization-level results', async () => {
    await expandSection(page, fundingAcc);

    const orgRadio = page.getByRole('radio', { name: 'Organization' });
    if (await orgRadio.isVisible().catch(() => false)) {
      await orgRadio.check();
    } else {
      await page.getByRole('checkbox', { name: 'Organization' }).check();
    }
    const minAmount = page.getByPlaceholder('Min $');
    await minAmount.click();
    await minAmount.fill('1000000');
    await minAmount.press('Tab');

    await applyAndExpectResults(page);
    await expect(page.getByText(/Funding/i).first()).toBeVisible();
  });

  test('Funding — Funding Type "Person" returns person-level results', async () => {
    await expandSection(page, fundingAcc);

    const personRadio = page.getByRole('radio', { name: 'Person' });
    if (await personRadio.isVisible().catch(() => false)) {
      await personRadio.check();
    } else {
      await page.getByRole('checkbox', { name: 'Person' }).check();
    }
    const minAmount = page.getByPlaceholder('Min $');
    await minAmount.click();
    await minAmount.fill('1000000');
    await minAmount.press('Tab');

    await applyAndExpectResults(page);
    await expect(page.getByText(/Funding/i).first()).toBeVisible();
  });

  test('Funding — Public Companies checkbox returns only publicly traded companies', async () => {
    await expandSection(page, fundingAcc);

    await page.getByRole('checkbox', { name: 'Public Companies' }).check();

    await applyAndExpectResults(page);
    await expect(page.getByText(/Public Companies|Funding/i).first()).toBeVisible();
  });

  // ================================================================
  // Lookalike + Advanced filters
  //   - Lookalike: choosing a company in "Lookalike of" enables the Prompt
  //     textarea (disabled until then); fill the prompt, then apply.
  //   - Advanced filters: "Suppliers of" and "Customers of" autocompletes.
  // All three fields are autocompletes — type, then pick from the dropdown.
  // ================================================================

  test('Lookalike — company selection enables Prompt and returns lookalike companies', async () => {
    await expandSection(page, lookalikeAcc);

    // The Prompt textarea stays disabled until a lookalike company is chosen.
    const prompt = page.getByPlaceholder('I am seeking food delivery companies excluding restaurants');
    await expect(prompt).toBeDisabled();

    await chooseAutocomplete(page, 'Search company', 'Google', /google/i);

    // Selecting a company unlocks the Prompt field.
    await expect(prompt).toBeEnabled();
    await prompt.click();
    await prompt.fill('I am seeking software companies excluding Marketing companies');

    await applyAndExpectResults(page);
    await expect(page.getByText(/Google|Lookalike/i).first()).toBeVisible();
  });

  test('Advanced filters — "Suppliers of" returns companies for the selected supplier', async () => {
    await expandSection(page, advancedFiltersAcc);

    await chooseAutocomplete(page, 'Search supplier', 'Google', /google/i);

    await applyAndExpectResults(page);
    await expect(page.getByText(/Google|Suppliers/i).first()).toBeVisible();
  });

  test('Advanced filters — "Customers of" returns companies for the selected customer', async () => {
    await expandSection(page, advancedFiltersAcc);

    await chooseAutocomplete(page, 'Search customers', 'Microsoft', /microsoft/i);

    await applyAndExpectResults(page);
    await expect(page.getByText(/Microsoft|Customers/i).first()).toBeVisible();
  });

  // ================================================================
  // Combination scenarios — apply 2-3 filters together to narrow down to a
  // particular set of companies, Apply, assert results, then afterEach clears
  // all filters before the next scenario. Each test reuses the single-filter
  // setters defined above so the intent of each scenario stays readable.
  // ================================================================

  test('Scenario: mid-size companies in the $10M-$25M revenue band', async () => {
    await setHeadCount(page, 100, 5000);
    await selectRevenue(page, '$10M-$25M');

    await applyAndExpectResults(page);
    await expect(page.getByText(/HeadCount/i).first()).toBeVisible();
    await expect(page.getByText(/Revenue:/i).first()).toBeVisible();
  });

  test('Scenario: large technology companies (headcount + industry)', async () => {
    await setHeadCount(page, 1000, 100000);
    await selectTreeNode(page, industryAcc, 'Technology Companies');

    await applyAndExpectResults(page);
    await expect(page.getByText(/Industries:/i).first()).toBeVisible();
  });

  test('Scenario: construction companies located in the US', async () => {
    await selectTreeNode(page, industryAcc, 'Construction Companies');
    await selectTreeNode(page, locationAcc, 'US States');

    await applyAndExpectResults(page);
    await expect(page.getByText(/Industries:/i).first()).toBeVisible();
    await expect(page.getByText(/Locations:/i).first()).toBeVisible();
  });

  test('Scenario: large public companies ($100M-$250M revenue + public)', async () => {
    await selectRevenue(page, '$100M-$250M');
    await checkPublicCompanies(page);

    await applyAndExpectResults(page);
    await expect(page.getByText(/Revenue:/i).first()).toBeVisible();
  });

  test('Scenario: recent technology startups (founding year + industry)', async () => {
    await selectFoundingYear(page, '1-2 years ago');
    await selectTreeNode(page, industryAcc, 'Technology Companies');

    await applyAndExpectResults(page);
    await expect(page.getByText(/Startups:|Industries:/i).first()).toBeVisible();
  });

  test('Scenario: technology companies using Salesforce', async () => {
    await addTechnology(page, 'Salesforce');
    await selectTreeNode(page, industryAcc, 'Technology Companies');

    await applyAndExpectResults(page);
    await expect(page.getByText(/Technology:|Industries:/i).first()).toBeVisible();
  });

  test('Scenario: mid-size companies mentioning "cloud"', async () => {
    await addKeyword(page, 'Include Keywords', 'cloud');
    await setHeadCount(page, 100, 5000);

    await applyAndExpectResults(page);
    await expect(page.getByText(/Include Keywords:|HeadCount/i).first()).toBeVisible();
  });

  test('Scenario: financial services companies excluding "gaming"', async () => {
    await selectTreeNode(page, industryAcc, 'Financial Services Companies');
    await addKeyword(page, 'Exclude Keywords', 'gaming');

    await applyAndExpectResults(page);
    await expect(page.getByText(/Industries:|Exclude Keywords:/i).first()).toBeVisible();
  });

  test('Scenario: Series A organizations (round type + funding type)', async () => {
    await selectTreeNode(page, fundingAcc, 'Series A');
    await selectFundingType(page, 'Organization');

    await applyAndExpectResults(page);
    await expect(page.getByText(/Funding|Round|Series A/i).first()).toBeVisible();
  });

  test('Scenario: US companies in the $10M-$25M revenue band', async () => {
    await selectTreeNode(page, locationAcc, 'US States');
    await selectRevenue(page, '$10M-$25M');

    await applyAndExpectResults(page);
    await expect(page.getByText(/Locations:/i).first()).toBeVisible();
    await expect(page.getByText(/Revenue:/i).first()).toBeVisible();
  });

  test('Scenario: mid-size tech companies using Salesforce (3 filters)', async () => {
    await setHeadCount(page, 100, 5000);
    await selectTreeNode(page, industryAcc, 'Technology Companies');
    await addTechnology(page, 'Salesforce');

    await applyAndExpectResults(page);
    await expect(page.getByText(/HeadCount/i).first()).toBeVisible();
    await expect(page.getByText(/Industries:/i).first()).toBeVisible();
  });

  test('Scenario: sizeable public companies with recent funding (3 filters)', async () => {
    await setHeadCount(page, 500, 50000);
    await setFundingRound(page, 'Any Round', 1000000);
    await checkPublicCompanies(page);

    await applyAndExpectResults(page);
    await expect(page.getByText(/HeadCount|Funding/i).first()).toBeVisible();
  });

  test('Scenario: financial companies in the US within a headcount range (3 filters)', async () => {
    await selectTreeNode(page, industryAcc, 'Financial Services Companies');
    await selectTreeNode(page, locationAcc, 'US States');
    await setHeadCount(page, 200, 20000);

    await applyAndExpectResults(page);
    await expect(page.getByText(/Industries:/i).first()).toBeVisible();
    await expect(page.getByText(/Locations:/i).first()).toBeVisible();
  });

  test('Scenario: tech companies in a revenue band mentioning "software" (3 filters)', async () => {
    await selectRevenue(page, '$10M-$25M');
    await addKeyword(page, 'Include Keywords', 'software');
    await selectTreeNode(page, industryAcc, 'Technology Companies');

    await applyAndExpectResults(page);
    await expect(page.getByText(/Revenue:/i).first()).toBeVisible();
    await expect(page.getByText(/Industries:/i).first()).toBeVisible();
  });

  test('Scenario: funded US technology companies within an amount range (3 filters)', async () => {
    await setFundingAmount(page, 1000000, 100000000);
    await selectTreeNode(page, industryAcc, 'Technology Companies');
    await selectTreeNode(page, locationAcc, 'US States');

    await applyAndExpectResults(page);
    await expect(page.getByText(/Industries:/i).first()).toBeVisible();
    await expect(page.getByText(/Locations:/i).first()).toBeVisible();
  });
});
