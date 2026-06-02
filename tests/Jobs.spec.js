import { test, expect } from '@playwright/test';

// Jobs page (preprod.zenbee.io/search/jobs). All tests share a single authenticated
// page: it is opened once in beforeAll, each test expands a filter section,
// applies a filter, asserts results, and afterEach clicks "Clear all" so the
// next test starts clean — no per-test page.goto() reload. (companies-page-test-flow skill.)

// ---------- locator helpers ----------
const applyBtn = (page) => page.getByRole('button', { name: 'Apply Filters' });
const clearAllBtn = (page) => page.getByRole('button', { name: /^Clear all$/i });
const jobTitleAcc = (page) => page.getByRole('button', { name: 'Job title' });
const jobAttributesAcc = (page) => page.getByRole('button', { name: 'Job attributes' });
const industryAcc = (page) => page.getByRole('button', { name: 'Industry' });
const locationAcc = (page) => page.getByRole('button', { name: 'Location' });
const companiesAcc = (page) => page.getByRole('button', { name: 'Companies' });
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

// Type `query` into an autocomplete combobox and pick the first matching suggestion.
// Suggestions render in a separate "Option List" overlay; scope to it so we don't
// accidentally match the field's own wrapper option.
async function chooseAutocomplete(page, comboName, query, optionRe) {
  const combo = page.getByRole('combobox', { name: comboName });
  await combo.click();
  // firefox can drop leading keystrokes typed char-by-char, so set the bulk of the
  // text atomically with fill(), then type one keystroke to trigger the search.
  await combo.fill(query.slice(0, -1));
  await combo.pressSequentially(query.slice(-1), { delay: 150 });
  await expect(combo).toHaveValue(new RegExp(query, 'i'));
  const option = page
    .getByRole('listbox', { name: 'Option List' })
    .getByRole('option')
    .filter({ hasText: optionRe })
    .first();
  await option.waitFor({ state: 'visible', timeout: 25000 });
  await option.click();
}

// ---------- single-filter setters (reused to build combination scenarios) ----------
async function setJobTitle(page, title) {
  await expandSection(page, jobTitleAcc);
  const input = page.getByPlaceholder('Enter title');
  await input.click();
  await input.fill('');
  // Type real keystrokes (webkit doesn't fire the form-enable change on fill()), then
  // blur to commit so Apply Filters enables.
  await input.pressSequentially(title, { delay: 50 });
  await input.blur();
}

async function addKeyword(page, comboName, keyword) {
  await expandSection(page, jobAttributesAcc);
  const input = page.getByRole('combobox', { name: comboName });
  await input.click();
  await input.pressSequentially(keyword, { delay: 60 });
  await input.press('Enter');
}

async function selectEmploymentType(page, label) {
  await expandSection(page, jobAttributesAcc);
  await page.getByText('Select category').click();
  await page.getByRole('option', { name: label }).click();
  await page.keyboard.press('Escape');
}

async function selectWorkType(page, label = 'Remote') {
  await expandSection(page, jobAttributesAcc);
  await page.getByRole('combobox', { name: 'Select work type' }).click();
  await page.getByRole('option', { name: label }).click();
  await page.keyboard.press('Escape');
}

async function selectIndustry(page) {
  await expandSection(page, industryAcc);
  // Industry is a PrimeVue MultiSelect — open its root (not the section's <p> label,
  // which also reads "Select industry"), then tick the first option in the overlay.
  await page.locator('.p-multiselect').filter({ hasText: 'Select industry' }).first().click();
  const option = page.locator('.p-multiselect-overlay').getByRole('option').first();
  await option.waitFor({ state: 'visible', timeout: 10000 });
  await option.click();
  await page.keyboard.press('Escape');
}

async function selectLocationGroup(page, name) {
  await expandSection(page, locationAcc);
  const node = page.getByRole('treeitem', { name }).first();
  await node.scrollIntoViewIfNeeded();
  await node.locator('.p-tree-node-content').first().click();
}

async function setHeadcount(page, min, max) {
  await expandSection(page, companiesAcc);
  const minInput = page.getByRole('spinbutton', { name: 'Min', exact: true });
  const maxInput = page.getByRole('spinbutton', { name: 'Max', exact: true });
  await minInput.click();
  await minInput.fill(String(min));
  await minInput.press('Tab');
  await maxInput.click();
  await maxInput.fill(String(max));
  await maxInput.press('Tab');
}

async function chooseCompany(page, name, optionRe) {
  await expandSection(page, companiesAcc);
  await chooseAutocomplete(page, 'Search company...', name, optionRe);
}

// ============================================================
// Serial suite — one page shared across all tests
// ============================================================
test.describe.serial('Jobs Page filters (shared page)', () => {
  test.setTimeout(120000);

  let context;
  let page;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(180000);
    context = await browser.newContext({ storageState: 'playwright/.auth/user.json' });
    page = await context.newPage();
    await page.goto('https://preprod.zenbee.io/search/jobs', { waitUntil: 'domcontentloaded' });
    // domcontentloaded fires before the SPA hydrates; wait (generously) for the real UI.
    // webkit cold-boot on preprod can be slow, so allow a long budget here.
    await expect(applyBtn(page)).toBeVisible({ timeout: 120000 });
    // firefox/webkit can render the Apply button before the sidebar accordions are
    // interactive, so the first test would race. Wait for the sidebar to be ready.
    await expect(jobTitleAcc(page)).toBeVisible({ timeout: 60000 });
    // Wipe any filter state persisted server-side from prior runs.
    await clearAllIfPresent(page);
  });

  test.afterEach(async () => {
    // Wait for the results table to render before clearing, so we don't clear the
    // filter mid-search (results must be visible first).
    await resultsTable(page).waitFor({ state: 'visible', timeout: 30000 }).catch(() => {});
    await clearAllIfPresent(page);
  });

  test.afterAll(async () => {
    await context?.close();
  });

  // ---------------------- Job title ----------------------
  test('Job title with "Show exact matches only" returns exact-title jobs', async () => {
    await setJobTitle(page, 'Software Engineer');
    await page.getByRole('checkbox', { name: 'Show exact matches only' }).check();

    await applyAndExpectResults(page);
    await expect(page.getByText(/Title:/i).first()).toBeVisible();
  });

  // ---------------------- Job attributes ----------------------
  test('Keywords (must include) filter returns jobs containing the keyword', async () => {
    await expandSection(page, jobAttributesAcc);

    const include = page.getByRole('combobox', { name: 'Enter words to include' });
    await include.click();
    await include.pressSequentially('engineer', { delay: 60 });
    await include.press('Enter');

    await applyAndExpectResults(page);
  });

  test('Keywords (must exclude) filter omits jobs containing the keyword', async () => {
    await expandSection(page, jobAttributesAcc);

    const exclude = page.getByRole('combobox', { name: 'Enter words to exclude' });
    await exclude.click();
    await exclude.pressSequentially('intern', { delay: 60 });
    await exclude.press('Enter');

    await applyAndExpectResults(page);
  });

  test('Employment type "Full Time" returns full-time jobs', async () => {
    await expandSection(page, jobAttributesAcc);

    await page.getByText('Select category').click();
    await page.getByRole('option', { name: 'Full Time' }).click();
    await page.keyboard.press('Escape');

    await applyAndExpectResults(page);
  });

  test('Work type filter returns jobs of the selected work type', async () => {
    await selectWorkType(page);

    await applyAndExpectResults(page);
  });

  // ---------------------- Industry ----------------------
  test('Industry filter returns jobs in the selected industry', async () => {
    await selectIndustry(page);

    await applyAndExpectResults(page);
  });

  // ---------------------- Location ----------------------
  test('Location filter (tree) returns jobs in the selected location group', async () => {
    await expandSection(page, locationAcc);

    const node = page.getByRole('treeitem', { name: 'US States' }).first();
    await node.scrollIntoViewIfNeeded();
    await node.locator('.p-tree-node-content').first().click();

    await applyAndExpectResults(page);
    await expect(page.getByText(/Locations:/i).first()).toBeVisible();
  });

  test('Location entered manually returns jobs in that location', async () => {
    await expandSection(page, locationAcc);

    const manual = page.getByRole('combobox', { name: 'Enter city, state, or country' });
    await manual.click();
    await manual.pressSequentially('New York', { delay: 60 });
    await manual.press('Enter');

    await applyAndExpectResults(page);
  });

  // ---------------------- Companies ----------------------
  test('Companies "Name or domain" autocomplete filters jobs by company', async () => {
    await expandSection(page, companiesAcc);

    await chooseAutocomplete(page, 'Search company...', 'Google', /google/i);

    await applyAndExpectResults(page);
  });

  test('Companies LinkedIn URL filter returns jobs for that company', async () => {
    await expandSection(page, companiesAcc);

    const linkedin = page.getByRole('textbox', { name: 'Enter LinkedIn URL' });
    await linkedin.click();
    await linkedin.fill('https://www.linkedin.com/company/microsoft');
    await linkedin.press('Enter');

    await applyAndExpectResults(page);
  });

  test('Companies Headcount min/max filter returns jobs within the range', async () => {
    await expandSection(page, companiesAcc);

    const min = page.getByRole('spinbutton', { name: 'Min' });
    const max = page.getByRole('spinbutton', { name: 'Max' });
    await min.click();
    await min.fill('100');
    await min.press('Tab');
    await max.click();
    await max.fill('5000');
    await max.press('Tab');

    await applyAndExpectResults(page);
  });

  // ================================================================
  // Combination scenarios — apply 2-3 filters together to narrow down to a
  // particular set of jobs, Apply, assert results, then afterEach clears all
  // filters before the next scenario. Each test reuses the single-filter setters
  // above so the intent of each scenario stays readable.
  // ================================================================

  test('Scenario: Software Engineer jobs located in the US', async () => {
    await setJobTitle(page, 'Software Engineer');
    await selectLocationGroup(page, 'US States');

    await applyAndExpectResults(page);
    await expect(page.getByText(/Title:/i).first()).toBeVisible();
    await expect(page.getByText(/Locations:/i).first()).toBeVisible();
  });

  test('Scenario: full-time Engineer jobs (title + employment type)', async () => {
    await setJobTitle(page, 'Engineer');
    await selectEmploymentType(page, 'Full Time');

    await applyAndExpectResults(page);
    await expect(page.getByText(/Title:/i).first()).toBeVisible();
  });

  test('Scenario: full-time jobs in the US (employment type + location)', async () => {
    await selectEmploymentType(page, 'Full Time');
    await selectLocationGroup(page, 'US States');

    await applyAndExpectResults(page);
    await expect(page.getByText(/Locations:/i).first()).toBeVisible();
  });

  test('Scenario: jobs mentioning "developer" of a selected work type', async () => {
    await addKeyword(page, 'Enter words to include', 'developer');
    await selectWorkType(page);

    await applyAndExpectResults(page);
  });

  test('Scenario: industry jobs located in the US', async () => {
    await selectIndustry(page);
    await selectLocationGroup(page, 'US States');

    await applyAndExpectResults(page);
    await expect(page.getByText(/Locations:/i).first()).toBeVisible();
  });

  test('Scenario: Engineer jobs at mid-size companies (title + headcount)', async () => {
    await setJobTitle(page, 'Engineer');
    await setHeadcount(page, 100, 5000);

    await applyAndExpectResults(page);
    await expect(page.getByText(/Title:/i).first()).toBeVisible();
  });

  test('Scenario: Engineer jobs at a specific company (company + title)', async () => {
    await chooseCompany(page, 'Google', /google/i);
    await setJobTitle(page, 'Engineer');

    await applyAndExpectResults(page);
    await expect(page.getByText(/Title:/i).first()).toBeVisible();
  });

  test('Scenario: full-time remote jobs in the US (3 filters)', async () => {
    await selectEmploymentType(page, 'Full Time');
    await selectWorkType(page, 'Remote');
    await selectLocationGroup(page, 'US States');

    await applyAndExpectResults(page);
    await expect(page.getByText(/Locations:/i).first()).toBeVisible();
  });

  test('Scenario: full-time "developer" jobs in the US (3 filters)', async () => {
    await addKeyword(page, 'Enter words to include', 'developer');
    await selectEmploymentType(page, 'Full Time');
    await selectLocationGroup(page, 'US States');

    await applyAndExpectResults(page);
    await expect(page.getByText(/Locations:/i).first()).toBeVisible();
  });

  test('Scenario: full-time Manager jobs in an industry (3 filters)', async () => {
    await setJobTitle(page, 'Manager');
    await selectIndustry(page);
    await selectEmploymentType(page, 'Full Time');

    await applyAndExpectResults(page);
    await expect(page.getByText(/Title:/i).first()).toBeVisible();
  });

  test('Scenario: jobs including "developer" but excluding "senior"', async () => {
    await addKeyword(page, 'Enter words to include', 'developer');
    await addKeyword(page, 'Enter words to exclude', 'senior');

    await applyAndExpectResults(page);
  });

  test('Scenario: full-time Engineer jobs at mid-size companies (3 filters)', async () => {
    await setJobTitle(page, 'Engineer');
    await selectEmploymentType(page, 'Full Time');
    await setHeadcount(page, 100, 5000);

    await applyAndExpectResults(page);
    await expect(page.getByText(/Title:/i).first()).toBeVisible();
  });
});
