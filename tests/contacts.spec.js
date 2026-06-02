import { test, expect } from '@playwright/test';

// Contacts Page filter tests. Mirrors the architecture of companies.spec.js:
// all tests share a single authenticated page opened once in beforeAll, each test
// expands a filter accordion, applies its filter and asserts results, and afterEach
// clicks "Clear all" so the next test starts from a clean filter state — no
// per-test page.goto() reload.
//
// NOTE: this suite is a plain describe (not describe.serial) on purpose. The
// contacts filters were reverse-engineered against the live QA page; a plain
// describe isolates an unexpected per-filter failure instead of fast-failing the
// whole run (workers:1 still keeps the shared page and declaration order intact).

// ---------- test data ----------
const PHONE = '(617) 901-7749';
const EMAIL = 'amekkaoui@croyten.com';
const LINKEDIN_URL = 'https://www.linkedin.com/in/aminemekkaoui';

// ---------- locator helpers ----------
const applyBtn = (page) => page.getByRole('button', { name: 'Apply Filters' });
const clearAllBtn = (page) => page.getByRole('button', { name: /^Clear all$/i });
const specificContactsAcc = (page) => page.getByRole('button', { name: 'Specific contacts' });
const roleSeniorityAcc = (page) => page.getByRole('button', { name: 'Role and seniority' });
const skillsAcc = (page) => page.getByRole('button', { name: 'Skills' });
const experienceAcc = (page) => page.getByRole('button', { name: 'Experience' });
const educationAcc = (page) => page.getByRole('button', { name: 'Education' });
const industryAcc = (page) => page.getByRole('button', { name: 'Industry' });
// "Location" is a substring of "Headquarter location", so anchor on the capital-L
// word-end to target the standalone Location accordion only.
const locationAcc = (page) => page.getByRole('button', { name: /Location$/ });
const currentCompanyAcc = (page) => page.getByRole('button', { name: 'Current Company' });
const resultsTable = (page) => page.getByRole('table');

// ---------- workflow helpers ----------
async function expandSection(page, accordionBtnFn) {
  const btn = accordionBtnFn(page).first();
  // preprod can be slow to render the sidebar — give the accordion a generous window.
  await expect(btn).toBeVisible({ timeout: 20000 });
  const expanded = await btn.evaluate(el => el.getAttribute('aria-expanded'));
  if (expanded !== 'true') await btn.click();
}

async function applyAndExpectResults(page) {
  // Dismiss any open autocomplete overlay so it can't intercept the Apply click
  // (dense multi-filter scenarios can leave a dropdown mid-close over the button).
  await page.keyboard.press('Escape').catch(() => {});
  // Some filters debounce before enabling Apply — give it a generous window.
  await expect(applyBtn(page)).toBeEnabled({ timeout: 15000 });
  await applyBtn(page).click();
  await expect(resultsTable(page)).toBeVisible({ timeout: 30000 });
  await expect(resultsTable(page).getByRole('row')).not.toHaveCount(0);
}

// Type `query` into an autocomplete combobox and click the first suggestion matching it.
// preprod's autocomplete endpoints are slow and lag behind keystrokes (a field's results
// can arrive several seconds late, after the next field is already focused), so we WAIT
// (up to 20s) for the matching option to actually render and click it. We do NOT fall
// back to Enter — for these fields Enter does not register a value, leaving "Apply
// Filters" disabled. `.first()` guards against duplicate-placeholder fields (e.g. the
// manual-location box also exists under Headquarter location). `pickRe` lets a caller
// match an exact option (e.g. /^Java$/) instead of the default substring-of-query.
async function chooseAutocomplete(page, comboName, query, pickRe) {
  const combo = page.getByRole('combobox', { name: comboName }).first();
  await combo.click();
  await combo.fill('');
  await combo.pressSequentially(query, { delay: 90 });
  const esc = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const option = page
    .getByRole('listbox', { name: 'Option List' })
    .getByRole('option')
    .filter({ hasText: pickRe || new RegExp(esc, 'i') })
    .first();
  await option.waitFor({ state: 'visible', timeout: 20000 });
  await option.click();
}

async function clearAllIfPresent(page) {
  const btn = clearAllBtn(page);
  if (await btn.isVisible().catch(() => false)) {
    await btn.click();
    await expect(btn).toHaveCount(0);
    await expect(applyBtn(page)).toBeDisabled();
  }
}

// ---------- single-filter setters (reused to build combination scenarios) ----------

// The Name field does NOT enable "Apply Filters" on its own — it must be paired with a
// company-name filter (Current Company section). setName only fills the input; pair it
// with setCompanyName in a test.
async function setName(page, name) {
  await expandSection(page, specificContactsAcc);
  const input = page.getByPlaceholder('Enter Name');
  await input.click();
  await input.fill(name);
}

async function setCompanyName(page, company) {
  await expandSection(page, currentCompanyAcc);
  const combo = page.getByRole('combobox', { name: 'Search company...' }).first();
  await combo.click();
  await combo.pressSequentially(company, { delay: 100 });
  const option = page.getByRole('option').filter({ hasText: new RegExp(company, 'i') }).first();
  if (await option.isVisible({ timeout: 8000 }).catch(() => false)) {
    await option.click();
  } else {
    await combo.press('Enter');
  }
}

async function setLinkedIn(page, url) {
  await expandSection(page, specificContactsAcc);
  const input = page.getByPlaceholder('Enter LinkedIn URLs');
  await input.click();
  await input.pressSequentially(url, { delay: 15 });
  await input.press('Enter');
}

// Email-type radios expose accessible names "business"/"personal"; the visible
// "Business Email"/"Personal Email" labels are separate text nodes. Clicking the label
// reliably checks the radio.
async function selectEmailType(page, label) {
  await expandSection(page, specificContactsAcc);
  await page.getByText(label, { exact: true }).click();
}

async function setEmail(page, email) {
  await expandSection(page, specificContactsAcc);
  const input = page.getByPlaceholder('Email Address');
  await input.click();
  await input.fill(email);
  // Commit with Enter only if a plain fill didn't enable Apply.
  if (await applyBtn(page).isDisabled().catch(() => true)) {
    await input.press('Enter');
  }
}

async function setPhone(page, phone) {
  await expandSection(page, specificContactsAcc);
  const input = page.getByPlaceholder('(201) 555-0123');
  await input.click();
  await input.fill(phone);
  await input.press('Tab');
}

async function chooseTitle(page, title) {
  await expandSection(page, roleSeniorityAcc);
  await chooseAutocomplete(page, 'Enter Title', title);
}

// Management levels AND job roles render as PrimeNG tree nodes under the Role and
// seniority accordion (not checkboxes), so both use selectTreeNode. exact:true avoids
// over-matching: e.g. "US States" as a substring also matches the concatenated root
// node ("All LocationsUS States…"), which selects the wrong thing.
async function selectTreeNode(page, accordionBtnFn, name) {
  await expandSection(page, accordionBtnFn);
  const node = page.getByRole('treeitem', { name, exact: true }).first();
  await node.scrollIntoViewIfNeeded();
  await node.locator('.p-tree-node-content').first().click();
}

// PrimeVue Select dropdowns shown by their placeholder text ("Select Last Job Changed",
// "Select years"). Open by clicking the placeholder, then pick the first real option.
async function selectDropdownFirstOption(page, accordionBtnFn, placeholder) {
  await expandSection(page, accordionBtnFn);
  await page.getByText(placeholder, { exact: true }).first().click();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
}

// Skills is a (slow) autocomplete. Type the skill, then WAIT for the exact matching
// suggestion and CLICK it — this is what registers the skill as a selected token.
// We deliberately do NOT fall back to Enter: pressing Enter leaves the text typed but
// unselected (no token, "Apply Filters" stays disabled), which is the bug we're fixing.
async function addSkill(page, skill) {
  await expandSection(page, skillsAcc);
  const input = page.getByPlaceholder('Enter skills');
  await input.click();
  await input.fill('');
  await input.pressSequentially(skill, { delay: 90 });
  const esc = skill.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const option = page
    .getByRole('listbox', { name: 'Option List' })
    .getByRole('option')
    .filter({ hasText: new RegExp(`^${esc}$`, 'i') })
    .first();
  await option.waitFor({ state: 'visible', timeout: 20000 });
  await option.click();
}

async function fillSkillsPrompt(page, text) {
  await expandSection(page, skillsAcc);
  const prompt = page.locator('textarea[placeholder*="people with skills"]').first();
  await prompt.click();
  await prompt.fill(text);
}

async function setYearsOfExperience(page, min, max) {
  await expandSection(page, experienceAcc);
  const minInput = page.getByRole('spinbutton', { name: 'Min', exact: true }).first();
  const maxInput = page.getByRole('spinbutton', { name: 'Max', exact: true }).first();
  await minInput.click();
  await minInput.fill(String(min));
  await minInput.press('Tab');
  await maxInput.click();
  await maxInput.fill(String(max));
  await maxInput.press('Tab');
}

async function addExperienceKeyword(page, keyword) {
  await expandSection(page, experienceAcc);
  const input = page.getByPlaceholder('Enter experience keywords');
  await input.click();
  await input.pressSequentially(keyword, { delay: 60 });
  await input.press('Enter');
}

async function fillExperiencePrompt(page, text) {
  await expandSection(page, experienceAcc);
  const prompt = page.locator('textarea[placeholder*="people with experience"]').first();
  await prompt.click();
  await prompt.fill(text);
}

async function chooseMajor(page, major) {
  await expandSection(page, educationAcc);
  await chooseAutocomplete(page, 'Enter majors', major);
}

async function chooseDegree(page, degree) {
  await expandSection(page, educationAcc);
  await chooseAutocomplete(page, 'Enter degree', degree);
}

async function chooseSchool(page, school) {
  await expandSection(page, educationAcc);
  await chooseAutocomplete(page, 'Enter school', school);
}

async function enterLocationManually(page, location) {
  await expandSection(page, locationAcc);
  await page.getByText('Or Enter Location Manually').first().click();
  const input = page.getByPlaceholder('Enter city, state, or country').first();
  await input.click();
  await input.fill('');
  await input.pressSequentially(location, { delay: 90 });
  const option = page
    .getByRole('listbox', { name: 'Option List' })
    .getByRole('option')
    .filter({ hasText: new RegExp(location, 'i') })
    .first();
  if (await option.isVisible({ timeout: 20000 }).catch(() => false)) {
    await option.click();
  } else {
    await input.press('Enter');
  }
}

// ============================================================
// Shared-page suite — one authenticated page across all tests
// ============================================================
test.describe('Contacts Page filters (shared page)', () => {
  test.setTimeout(120000);

  let context;
  let page;

  test.beforeAll(async ({ browser }) => {
    // Hook timeouts are NOT covered by test.setTimeout above — extend this hook's
    // own budget so a slow cold SPA boot doesn't blow the default 30s.
    test.setTimeout(120000);
    context = await browser.newContext({ storageState: 'playwright/.auth/user.json' });
    page = await context.newPage();
    await page.goto('https://preprod.zenbee.io/search/contacts', { waitUntil: 'domcontentloaded', timeout: 120000 });
    // domcontentloaded fires before the SPA hydrates. Wait (generously) for the real
    // UI to render rather than for the boot splash to clear.
    await expect(applyBtn(page)).toBeVisible({ timeout: 120000 });
    // The content panel loader ("...prepare your search interface") clears only once the
    // app fully hydrates. Wait for it to disappear before touching any accordion.
    await expect(page.getByText(/prepare your search interface/i))
      .toBeHidden({ timeout: 60000 });
    // Wipe any filter state that may have been persisted server-side from prior runs.
    await clearAllIfPresent(page);
  });

  test.afterEach(async () => {
    // Reset to a clean filter state before the next test runs on the same page.
    // preprod intermittently serves a broken page; if clearing fails, re-navigate so a
    // single transient hiccup doesn't poison every subsequent test on the shared page.
    try {
      await page.keyboard.press('Escape').catch(() => {});
      await clearAllIfPresent(page);
    } catch {
      await page.goto('https://preprod.zenbee.io/search/contacts', { waitUntil: 'domcontentloaded', timeout: 120000 }).catch(() => {});
      await expect(applyBtn(page)).toBeVisible({ timeout: 120000 }).catch(() => {});
      await clearAllIfPresent(page).catch(() => {});
    }
  });

  test.afterAll(async () => {
    await context?.close();
  });

  // ----------------------------------------------------------------
  // Specific contacts — Name (+company), LinkedIn URLs, Email Type, Email, Phone
  // ----------------------------------------------------------------
  test('Name filter (paired with company) returns matching contacts', async () => {
    // Name alone can't be applied; pair it with a Current Company filter.
    await setCompanyName(page, 'Google');
    await setName(page, 'John');
    await applyAndExpectResults(page);
  });

  test('LinkedIn URL filter returns the matching contact', async () => {
    await setLinkedIn(page, LINKEDIN_URL);
    await applyAndExpectResults(page);
  });

  test('Email Type "Business Email" returns business-email contacts', async () => {
    // Email Type can't be applied alone — it pairs with the Email filter.
    await setEmail(page, EMAIL);
    await selectEmailType(page, 'Business Email');
    await applyAndExpectResults(page);
  });

  test('Email Type "Personal Email" returns personal-email contacts', async () => {
    await setEmail(page, EMAIL);
    await selectEmailType(page, 'Personal Email');
    await applyAndExpectResults(page);
  });

  test('Email filter returns the matching contact', async () => {
    await setEmail(page, EMAIL);
    await applyAndExpectResults(page);
  });

  test('Phone filter returns the matching contact', async () => {
    await setPhone(page, PHONE);
    await applyAndExpectResults(page);
  });

  // ----------------------------------------------------------------
  // Role and seniority — Titles, Management level, Job role,
  // Job role last changed, Current job duration
  // ----------------------------------------------------------------
  test('Titles filter returns contacts with the selected title', async () => {
    await chooseTitle(page, 'Software Engineer');
    await applyAndExpectResults(page);
  });

  test('Management level filter returns contacts at the selected level', async () => {
    await selectTreeNode(page, roleSeniorityAcc, 'Senior');
    await applyAndExpectResults(page);
  });

  test('Job role filter returns contacts in the selected job role', async () => {
    await selectTreeNode(page, roleSeniorityAcc, 'Engineering');
    await applyAndExpectResults(page);
  });

  test('Job role last changed filter returns matching contacts', async () => {
    await selectDropdownFirstOption(page, roleSeniorityAcc, 'Select Last Job Changed');
    await applyAndExpectResults(page);
  });

  test('Current job duration filter returns matching contacts', async () => {
    await selectDropdownFirstOption(page, roleSeniorityAcc, 'Select years');
    await applyAndExpectResults(page);
  });

  // ----------------------------------------------------------------
  // Skills — Skills input + Boolean Skills Prompt
  // ----------------------------------------------------------------
  test('Skills filter returns contacts with the selected skill', async () => {
    await addSkill(page, 'Java');
    await applyAndExpectResults(page);
  });

  test('Skills Prompt (Boolean) returns contacts matching the expression', async () => {
    await fillSkillsPrompt(page, 'Java AND Python');
    await applyAndExpectResults(page);
  });

  // ----------------------------------------------------------------
  // Experience — Years of experience, Experience Keywords, Boolean prompt
  // ----------------------------------------------------------------
  test('Years of experience range returns contacts within the range', async () => {
    await setYearsOfExperience(page, 2, 10);
    await applyAndExpectResults(page);
  });

  test('Experience Keywords filter returns contacts mentioning the keyword', async () => {
    await addExperienceKeyword(page, 'Python');
    await applyAndExpectResults(page);
  });

  test('Experience Prompt (Boolean) returns contacts matching the expression', async () => {
    await fillExperiencePrompt(page, 'Python OR Java');
    await applyAndExpectResults(page);
  });

  // ----------------------------------------------------------------
  // Education — Major, Degrees, Schools (all autocomplete)
  // ----------------------------------------------------------------
  test('Major filter returns contacts with the selected major', async () => {
    await chooseMajor(page, 'Computer Science');
    await applyAndExpectResults(page);
  });

  test('Degrees filter returns contacts with the selected degree', async () => {
    await chooseDegree(page, 'PhD');
    await applyAndExpectResults(page);
  });

  test('Schools filter returns contacts from the selected school', async () => {
    await chooseSchool(page, 'Harvard');
    await applyAndExpectResults(page);
  });

  // ----------------------------------------------------------------
  // Industry — PrimeNG checkbox tree under the "Industry" accordion
  // ----------------------------------------------------------------
  test('Industry filter returns contacts in the selected industry', async () => {
    await selectTreeNode(page, industryAcc, 'Advertising Services');
    await applyAndExpectResults(page);
  });

  // ----------------------------------------------------------------
  // Location — tree selection + manual autocomplete entry
  // ----------------------------------------------------------------
  test('Location filter (tree) returns contacts in the selected location', async () => {
    await selectTreeNode(page, locationAcc, 'US States');
    await applyAndExpectResults(page);
  });

  test('Location filter (manual autocomplete) returns contacts matching a typed location', async () => {
    await enterLocationManually(page, 'New York');
    await applyAndExpectResults(page);
  });

  // ----------------------------------------------------------------
  // Clear All resets filter state
  // ----------------------------------------------------------------
  test('Clear All restores default state after applying a filter', async () => {
    await addSkill(page, 'Java');
    await applyAndExpectResults(page);

    await clearAllIfPresent(page);
    await expect(clearAllBtn(page)).toHaveCount(0);
    await expect(applyBtn(page)).toBeDisabled();
  });

  // ================================================================
  // Combination scenarios — apply 2-3 filters together to narrow down
  // to a particular set of contacts, Apply, assert results, then
  // afterEach clears all filters before the next scenario. Each test
  // reuses the single-filter setters above so the intent stays readable.
  // ================================================================
  test('Scenario: software engineers in the Advertising industry', async () => {
    await chooseTitle(page, 'Software Engineer');
    await selectTreeNode(page, industryAcc, 'Advertising Services');
    await applyAndExpectResults(page);
  });

  test('Scenario: software engineers located in the US', async () => {
    await chooseTitle(page, 'Software Engineer');
    await selectTreeNode(page, locationAcc, 'US States');
    await applyAndExpectResults(page);
  });

  test('Scenario: senior-level contacts in the Advertising industry', async () => {
    await selectTreeNode(page, roleSeniorityAcc, 'Senior');
    await selectTreeNode(page, industryAcc, 'Advertising Services');
    await applyAndExpectResults(page);
  });

  test('Scenario: Java-skilled contacts located in the US', async () => {
    await addSkill(page, 'Java');
    await selectTreeNode(page, locationAcc, 'US States');
    await applyAndExpectResults(page);
  });

  test('Scenario: experienced contacts in the Advertising industry', async () => {
    await setYearsOfExperience(page, 5, 20);
    await selectTreeNode(page, industryAcc, 'Advertising Services');
    await applyAndExpectResults(page);
  });

  test('Scenario: Computer Science PhD contacts (major + degree)', async () => {
    await chooseMajor(page, 'Computer Science');
    await chooseDegree(page, 'PhD');
    await applyAndExpectResults(page);
  });

  test('Scenario: PhD contacts from Harvard (degree + school)', async () => {
    await chooseDegree(page, 'PhD');
    await chooseSchool(page, 'Harvard');
    await applyAndExpectResults(page);
  });

  test('Scenario: Advertising-industry contacts located in the US', async () => {
    await selectTreeNode(page, industryAcc, 'Advertising Services');
    await selectTreeNode(page, locationAcc, 'US States');
    await applyAndExpectResults(page);
  });

  test('Scenario: software engineers with Java skills in the US (3 filters)', async () => {
    await chooseTitle(page, 'Software Engineer');
    await addSkill(page, 'Java');
    await selectTreeNode(page, locationAcc, 'US States');
    await applyAndExpectResults(page);
  });

  test('Scenario: business-email contacts in the Advertising industry', async () => {
    await selectEmailType(page, 'Business Email');
    await selectTreeNode(page, industryAcc, 'Advertising Services');
    await applyAndExpectResults(page);
  });

  test('Scenario: contacts experienced in Python within the Advertising industry', async () => {
    await addExperienceKeyword(page, 'Python');
    await selectTreeNode(page, industryAcc, 'Advertising Services');
    await applyAndExpectResults(page);
  });

  test('Scenario: Engineering job-role contacts located in the US', async () => {
    await selectTreeNode(page, roleSeniorityAcc, 'Engineering');
    await selectTreeNode(page, locationAcc, 'US States');
    await applyAndExpectResults(page);
  });

  test('Scenario: senior software engineers with Java skills (title + level + skill)', async () => {
    await chooseTitle(page, 'Software Engineer');
    await selectTreeNode(page, roleSeniorityAcc, 'Senior');
    await addSkill(page, 'Java');
    await applyAndExpectResults(page);
  });

  test('Scenario: Computer Science graduates in Engineering (major + job role)', async () => {
    await chooseMajor(page, 'Computer Science');
    await selectTreeNode(page, roleSeniorityAcc, 'Engineering');
    await applyAndExpectResults(page);
  });

  test('Scenario: experienced engineers skilled in Python (years + role + skill)', async () => {
    await setYearsOfExperience(page, 5, 20);
    await selectTreeNode(page, roleSeniorityAcc, 'Engineering');
    await addSkill(page, 'Python');
    await applyAndExpectResults(page);
  });

  test('Scenario: business-email software engineers in the US (email type + title + location)', async () => {
    await selectEmailType(page, 'Business Email');
    await chooseTitle(page, 'Software Engineer');
    await selectTreeNode(page, locationAcc, 'US States');
    await applyAndExpectResults(page);
  });

  test('Scenario: Harvard Computer Science engineers (school + major + role)', async () => {
    await chooseSchool(page, 'Harvard');
    await chooseMajor(page, 'Computer Science');
    await selectTreeNode(page, roleSeniorityAcc, 'Engineering');
    await applyAndExpectResults(page);
  });

  test('Scenario: senior contacts experienced in Python in the Advertising industry (level + keyword + industry)', async () => {
    await selectTreeNode(page, roleSeniorityAcc, 'Senior');
    await addExperienceKeyword(page, 'Python');
    await selectTreeNode(page, industryAcc, 'Advertising Services');
    await applyAndExpectResults(page);
  });

  test('Scenario: PhD-degree software engineers located in the US (degree + title + location)', async () => {
    await chooseDegree(page, 'PhD');
    await chooseTitle(page, 'Software Engineer');
    await selectTreeNode(page, locationAcc, 'US States');
    await applyAndExpectResults(page);
  });
});
