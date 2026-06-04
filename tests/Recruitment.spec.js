import { test, expect } from '@playwright/test';

// Recruitment Page filter tests (preprod.zenbee.io/search/recruitment).
// Mirrors the architecture of contacts.spec.js: all tests share a single
// authenticated page opened once in beforeAll (login itself happens once in the
// auth.setup.js project via storageState), each test expands a filter accordion,
// applies its filter and asserts results, and afterEach clicks "Clear all" so the
// next test starts from a clean filter state — no per-test page.goto() reload.
//
// Sections per the live page sidebar:
//   Specific candidates  — name (+ exact match), LinkedIn URLs, email type, email, phone
//   Role and seniority   — title (+ exact match), management level, job role,
//                          job role last changed, current job duration
//   Skills               — skills autocomplete + Boolean skills prompt
//   Experience           — keywords, Boolean prompt, years of experience
//   Education            — major, degrees, schools
//   Industry             — checkbox tree
//   Candidate location   — tree + manual autocomplete
//   Headquarter location — tree + manual autocomplete
//   Current company      — name autocomplete, manual name, LinkedIn URL, headcount
//   By past companies    — name autocomplete, manual name

// ---------- test data ----------
const PHONE = '(817) 291-7322';
const EMAIL = 'rcearley@corduro.com';
const LINKEDIN_URL = 'https://www.linkedin.com/in/robert-cearley-888a112';

// ---------- locator helpers ----------
const applyBtn = (page) => page.getByRole('button', { name: 'Apply Filters' });
const clearAllBtn = (page) => page.getByRole('button', { name: /^Clear all$/i });
const specificCandidatesAcc = (page) => page.getByRole('button', { name: 'Specific candidates' });
const roleSeniorityAcc = (page) => page.getByRole('button', { name: 'Role and seniority' });
const skillsAcc = (page) => page.getByRole('button', { name: 'Skills' });
const experienceAcc = (page) => page.getByRole('button', { name: 'Experience' });
const educationAcc = (page) => page.getByRole('button', { name: 'Education' });
const industryAcc = (page) => page.getByRole('button', { name: 'Industry' });
const candidateLocationAcc = (page) => page.getByRole('button', { name: 'Candidate location' });
const headquarterAcc = (page) => page.getByRole('button', { name: 'Headquarter location' });
const currentCompanyAcc = (page) => page.getByRole('button', { name: 'Current company' });
const pastCompaniesAcc = (page) => page.getByRole('button', { name: 'By past companies' });
const resultsTable = (page) => page.getByRole('table');

// ---------- workflow helpers ----------
async function expandSection(page, accordionBtnFn) {
  const btn = accordionBtnFn(page).first();
  // preprod can be slow to render the sidebar — give the accordion a generous window.
  await expect(btn).toBeVisible({ timeout: 20000 });
  const expanded = await btn.evaluate(el => el.getAttribute('aria-expanded'));
  if (expanded !== 'true') await btn.click();
}

// Expand an accordion and return a locator for its content panel (via the header's
// aria-controls). Several filters reuse identical placeholders/accessible names across
// sections — "Search company..." (Current company vs By past companies), "Min"/"Max"
// (Years of experience vs Headcount), the location tree node names + manual-entry
// placeholder (Candidate location vs Headquarter location), and "Show exact matches
// only" (Specific candidates vs Role and seniority) — so scoping queries to the panel
// is the only reliable way to hit the right instance.
async function expandAndGetPanel(page, accordionBtnFn) {
  await expandSection(page, accordionBtnFn);
  const panelId = await accordionBtnFn(page).first().evaluate(el => el.getAttribute('aria-controls'));
  return panelId ? page.locator(`[id="${panelId}"]`) : page;
}

async function applyAndExpectResults(page) {
  // Dismiss any open autocomplete overlay so it can't intercept the Apply click
  // (dense multi-filter scenarios can leave a dropdown mid-close over the button).
  await page.keyboard.press('Escape').catch(() => {});
  // Some filters debounce before enabling Apply — give it a generous window.
  await expect(applyBtn(page)).toBeEnabled({ timeout: 15000 });
  await applyBtn(page).click();
  // The Recruitment landing pane shows the AI-chat hero until a search runs; the
  // results table replaces it after Apply.
  await expect(resultsTable(page)).toBeVisible({ timeout: 30000 });
  await expect(resultsTable(page).getByRole('row')).not.toHaveCount(0);
}

// Type `query` into an autocomplete combobox and click the first suggestion matching it.
// preprod's autocomplete endpoints are slow and lag behind keystrokes, so we WAIT
// (up to 20s) for the matching option to actually render and click it. We do NOT fall
// back to Enter — for these fields Enter does not register a value, leaving "Apply
// Filters" disabled. `.first()` guards against duplicate-placeholder fields.
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
// company-name filter (Current company section). setCandidateName only fills the input;
// pair it with setCompanyName in a test.
async function setCandidateName(page, name) {
  await expandSection(page, specificCandidatesAcc);
  const input = page.getByPlaceholder('Enter Name');
  await input.click();
  await input.fill(name);
}

// Toggle the "Show exact matches only" checkbox inside a given accordion panel
// (Specific candidates → name; Role and seniority → title). The label text is
// duplicated across both sections, hence the panel scoping.
async function toggleExactMatches(page, accordionBtnFn) {
  const panel = await expandAndGetPanel(page, accordionBtnFn);
  const label = panel.getByText('Show exact matches only').first();
  await label.scrollIntoViewIfNeeded();
  await label.click();
}

async function setCompanyName(page, company) {
  await expandSection(page, currentCompanyAcc);
  const combo = page.getByRole('combobox', { name: 'Search company...' }).first();
  await pickCompanySuggestion(page, combo, company);
}

// Shared company-autocomplete flow. Two confirmed-by-failure traps here:
// 1. The combobox is itself nested inside an `option` element whose accessible name
//    mirrors the typed text, so an unscoped getByRole('option') matches that wrapper
//    (clicking it is a no-op) — scope to the body-level "Option List" overlay instead.
// 2. locator.isVisible({timeout}) does NOT wait (it returns immediately), which raced
//    the slow preprod autocomplete — use waitFor, which actually waits.
async function pickCompanySuggestion(page, combo, company) {
  await combo.click();
  await combo.pressSequentially(company, { delay: 100 });
  const option = page
    .getByRole('listbox', { name: 'Option List' })
    .getByRole('option')
    .filter({ hasText: new RegExp(company, 'i') })
    .first();
  try {
    await option.waitFor({ state: 'visible', timeout: 20000 });
    await option.click();
  } catch {
    await combo.press('Enter');
  }
}

async function setLinkedIn(page, url) {
  await expandSection(page, specificCandidatesAcc);
  const input = page.getByPlaceholder('Enter LinkedIn URLs');
  await input.click();
  await input.pressSequentially(url, { delay: 15 });
  await input.press('Enter');
}

// Email-type radios expose accessible names "business"/"personal"; the visible
// "Business Email"/"Personal Email" labels are separate text nodes. Clicking the label
// reliably checks the radio.
async function selectEmailType(page, label) {
  await expandSection(page, specificCandidatesAcc);
  await page.getByText(label, { exact: true }).click();
}

async function setEmail(page, email) {
  await expandSection(page, specificCandidatesAcc);
  const input = page.getByPlaceholder('Email Address');
  await input.click();
  await input.fill(email);
  // Commit with Enter only if a plain fill didn't enable Apply.
  if (await applyBtn(page).isDisabled().catch(() => true)) {
    await input.press('Enter');
  }
}

async function setPhone(page, phone) {
  await expandSection(page, specificCandidatesAcc);
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
// "Select Current Job Duration"). Open by clicking the placeholder, then pick the
// first real option.
async function selectDropdownFirstOption(page, accordionBtnFn, placeholder) {
  await expandSection(page, accordionBtnFn);
  await page.getByText(placeholder, { exact: true }).first().click();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
}

// Skills is a (slow) autocomplete. Type the skill, then WAIT for the exact matching
// suggestion and CLICK it — this is what registers the skill as a selected token.
// We deliberately do NOT fall back to Enter: pressing Enter leaves the text typed but
// unselected (no token, "Apply Filters" stays disabled).
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

// ---------- Candidate location ----------
async function enterLocationManually(page, location) {
  const panel = await expandAndGetPanel(page, candidateLocationAcc);
  const input = panel.getByPlaceholder('Enter city, state, or country').first();
  await input.click();
  await input.fill('');
  await input.pressSequentially(location, { delay: 90 });
  const option = page
    .getByRole('listbox', { name: 'Option List' })
    .getByRole('option')
    .filter({ hasText: new RegExp(location, 'i') })
    .first();
  // waitFor actually waits for the slow suggestion endpoint; isVisible({timeout})
  // ignores the timeout and returns immediately, which raced and lost on firefox.
  try {
    await option.waitFor({ state: 'visible', timeout: 20000 });
    await option.click();
  } catch {
    await input.press('Enter');
  }
}

// ---------- Headquarter location ----------
// The HQ tree duplicates the Candidate location tree's node names (US States,
// CA States, …), so both helpers scope to the Headquarter accordion panel.
async function selectHeadquarterTreeNode(page, name) {
  const panel = await expandAndGetPanel(page, headquarterAcc);
  const node = panel.getByRole('treeitem', { name, exact: true }).first();
  await node.scrollIntoViewIfNeeded();
  await node.locator('.p-tree-node-content').first().click();
}

async function enterHeadquarterLocationManually(page, location) {
  const panel = await expandAndGetPanel(page, headquarterAcc);
  const input = panel.getByPlaceholder('Enter city, state, or country').first();
  await input.click();
  await input.fill('');
  await input.pressSequentially(location, { delay: 90 });
  const option = page
    .getByRole('listbox', { name: 'Option List' })
    .getByRole('option')
    .filter({ hasText: new RegExp(location, 'i') })
    .first();
  try {
    await option.waitFor({ state: 'visible', timeout: 20000 });
    await option.click();
  } catch {
    await input.press('Enter');
  }
}

// ---------- Current company ----------
async function setCompanyLinkedIn(page, url) {
  const panel = await expandAndGetPanel(page, currentCompanyAcc);
  const input = panel.getByPlaceholder('Enter Company LinkedIn URLs');
  await input.click();
  await input.pressSequentially(url, { delay: 15 });
  await input.press('Enter');
}

async function setHeadcount(page, min, max) {
  const panel = await expandAndGetPanel(page, currentCompanyAcc);
  const minInput = panel.getByRole('spinbutton', { name: 'Min', exact: true });
  const maxInput = panel.getByRole('spinbutton', { name: 'Max', exact: true });
  await minInput.click();
  await minInput.fill(String(min));
  await minInput.press('Tab');
  await maxInput.click();
  await maxInput.fill(String(max));
  await maxInput.press('Tab');
}

// Tick "Manually enter company name" and type a free-text company. The toggle reveals
// a plain "Enter company name or domain" input (the autocomplete stays in the DOM
// alongside it). Works for both Current company and By past companies.
async function setCompanyNameManually(page, accordionBtnFn, company) {
  const panel = await expandAndGetPanel(page, accordionBtnFn);
  const toggle = panel.getByText('Manually enter company name').first();
  await toggle.scrollIntoViewIfNeeded();
  await toggle.click();
  const input = panel.getByPlaceholder('Enter company name or domain').first();
  await input.click();
  await input.pressSequentially(company, { delay: 40 });
  await input.press('Enter');
}

// ---------- By past companies ----------
async function setPastCompanyName(page, company) {
  const panel = await expandAndGetPanel(page, pastCompaniesAcc);
  const combo = panel.getByRole('combobox', { name: 'Search company...' }).first();
  await pickCompanySuggestion(page, combo, company);
}

// ============================================================
// Shared-page suite — one authenticated page across all tests
// ============================================================
test.describe('Recruitment Page filters (shared page)', () => {
  // test.setTimeout() is a no-op in describe-body scope — use describe.configure()
  // so the 120s timeout actually applies to every test in the group.
  test.describe.configure({ timeout: 120000 });

  let context;
  let page;

  test.beforeAll(async ({ browser }) => {
    // Hook timeouts are NOT covered by describe.configure above — extend this hook's
    // own budget so a slow cold SPA boot doesn't blow the default 30s.
    test.setTimeout(120000);
    context = await browser.newContext({ storageState: 'playwright/.auth/user.json' });
    page = await context.newPage();
    await page.goto('https://preprod.zenbee.io/search/recruitment', { waitUntil: 'domcontentloaded', timeout: 120000 });
    // domcontentloaded fires before the SPA hydrates. Wait (generously) for the real
    // UI to render rather than for the boot splash to clear.
    await expect(applyBtn(page)).toBeVisible({ timeout: 120000 });
    // The content panel loader clears only once the app fully hydrates. Wait for it
    // to disappear before touching any accordion.
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
      await page.goto('https://preprod.zenbee.io/search/recruitment', { waitUntil: 'domcontentloaded', timeout: 120000 }).catch(() => {});
      await expect(applyBtn(page)).toBeVisible({ timeout: 120000 }).catch(() => {});
      await clearAllIfPresent(page).catch(() => {});
    }
  });

  test.afterAll(async () => {
    await context?.close();
  });

  // ----------------------------------------------------------------
  // Specific candidates — Name (+company), exact matches, LinkedIn URLs,
  // Email Type, Email, Phone
  // ----------------------------------------------------------------
  test('Candidate name filter (paired with company) returns matching candidates', async () => {
    // Name alone can't be applied; pair it with a Current company filter.
    await setCompanyName(page, 'Google');
    await setCandidateName(page, 'John');
    await applyAndExpectResults(page);
  });

  test('Candidate name with "Show exact matches only" unticked returns broader matches', async () => {
    // The name exact-match checkbox is ON by default — untick it for a fuzzy search.
    await setCompanyName(page, 'Microsoft');
    await setCandidateName(page, 'John Smith');
    await toggleExactMatches(page, specificCandidatesAcc);
    await applyAndExpectResults(page);
  });

  test('LinkedIn URL filter returns the matching candidate', async () => {
    await setLinkedIn(page, LINKEDIN_URL);
    await applyAndExpectResults(page);
  });

  test('Email Type "Business Email" returns business-email candidates', async () => {
    // Email Type can't be applied alone — it pairs with the Email filter.
    await setEmail(page, EMAIL);
    await selectEmailType(page, 'Business Email');
    await applyAndExpectResults(page);
  });

  test('Email Type "Personal Email" returns personal-email candidates', async () => {
    await setEmail(page, EMAIL);
    await selectEmailType(page, 'Personal Email');
    await applyAndExpectResults(page);
  });

  test('Email filter returns the matching candidate', async () => {
    await setEmail(page, EMAIL);
    await applyAndExpectResults(page);
  });

  test('Phone filter returns the matching candidate', async () => {
    await setPhone(page, PHONE);
    await applyAndExpectResults(page);
  });

  // ----------------------------------------------------------------
  // Role and seniority — Title (+ exact matches), Management level,
  // Job role, Job role last changed, Current job duration
  // ----------------------------------------------------------------
  test('Title filter returns candidates with the selected title', async () => {
    await chooseTitle(page, 'Software Engineer');
    await applyAndExpectResults(page);
  });

  test('Title filter with "Show exact matches only" returns exact-title candidates', async () => {
    // The title exact-match checkbox is OFF by default — tick it.
    await chooseTitle(page, 'Software Engineer');
    await toggleExactMatches(page, roleSeniorityAcc);
    await applyAndExpectResults(page);
  });

  test('Management level filter returns candidates at the selected level', async () => {
    await selectTreeNode(page, roleSeniorityAcc, 'Senior');
    await applyAndExpectResults(page);
  });

  test('Job role filter returns candidates in the selected job role', async () => {
    await selectTreeNode(page, roleSeniorityAcc, 'Engineering');
    await applyAndExpectResults(page);
  });

  test('Job role last changed filter returns matching candidates', async () => {
    await selectDropdownFirstOption(page, roleSeniorityAcc, 'Select Last Job Changed');
    await applyAndExpectResults(page);
  });

  test('Current job duration filter returns matching candidates', async () => {
    await selectDropdownFirstOption(page, roleSeniorityAcc, 'Select Current Job Duration');
    await applyAndExpectResults(page);
  });

  // ----------------------------------------------------------------
  // Skills — Skills input + Boolean Skills Prompt
  // ----------------------------------------------------------------
  test('Skills filter returns candidates with the selected skill', async () => {
    await addSkill(page, 'Java');
    await applyAndExpectResults(page);
  });

  test('Skills Prompt (Boolean) returns candidates matching the expression', async () => {
    await fillSkillsPrompt(page, 'Java AND Python');
    await applyAndExpectResults(page);
  });

  // ----------------------------------------------------------------
  // Experience — Years of experience, Experience Keywords, Boolean prompt
  // ----------------------------------------------------------------
  test('Years of experience range returns candidates within the range', async () => {
    await setYearsOfExperience(page, 2, 10);
    await applyAndExpectResults(page);
  });

  test('Experience Keywords filter returns candidates mentioning the keyword', async () => {
    await addExperienceKeyword(page, 'Python');
    await applyAndExpectResults(page);
  });

  test('Experience Prompt (Boolean) returns candidates matching the expression', async () => {
    await fillExperiencePrompt(page, 'Python OR Java');
    await applyAndExpectResults(page);
  });

  // ----------------------------------------------------------------
  // Education — Major, Degrees, Schools (all autocomplete)
  // ----------------------------------------------------------------
  test('Major filter returns candidates with the selected major', async () => {
    await chooseMajor(page, 'Computer Science');
    await applyAndExpectResults(page);
  });

  test('Degrees filter returns candidates with the selected degree', async () => {
    await chooseDegree(page, 'PhD');
    await applyAndExpectResults(page);
  });

  test('Schools filter returns candidates from the selected school', async () => {
    await chooseSchool(page, 'Harvard');
    await applyAndExpectResults(page);
  });

  // ----------------------------------------------------------------
  // Industry — PrimeNG checkbox tree under the "Industry" accordion
  // ----------------------------------------------------------------
  test('Industry filter returns candidates in the selected industry', async () => {
    await selectTreeNode(page, industryAcc, 'Accounting');
    await applyAndExpectResults(page);
  });

  // ----------------------------------------------------------------
  // Candidate location — tree selection + manual autocomplete entry
  // ----------------------------------------------------------------
  test('Candidate location (tree) returns candidates in the selected location', async () => {
    await selectTreeNode(page, candidateLocationAcc, 'US States');
    await applyAndExpectResults(page);
  });

  test('Candidate location (manual autocomplete) returns candidates matching a typed location', async () => {
    await enterLocationManually(page, 'New York');
    await applyAndExpectResults(page);
  });

  // ----------------------------------------------------------------
  // Headquarter location — tree selection + manual autocomplete entry
  // ----------------------------------------------------------------
  test('Headquarter location (tree) returns candidates with HQ in the selected region', async () => {
    await selectHeadquarterTreeNode(page, 'CA States');
    await applyAndExpectResults(page);
  });

  test('Headquarter location (manual autocomplete) returns candidates with the typed HQ', async () => {
    await enterHeadquarterLocationManually(page, 'London');
    await applyAndExpectResults(page);
  });

  // ----------------------------------------------------------------
  // Current company — name autocomplete, manual name, LinkedIn URL, Headcount
  // ----------------------------------------------------------------
  test('Current company name filter returns candidates at the company', async () => {
    await setCompanyName(page, 'Microsoft');
    await applyAndExpectResults(page);
  });

  test('Current company manual name entry returns candidates at the typed company', async () => {
    await setCompanyNameManually(page, currentCompanyAcc, 'Tesla');
    await applyAndExpectResults(page);
  });

  test('Company LinkedIn URL filter returns candidates at that company', async () => {
    await setCompanyLinkedIn(page, 'https://www.linkedin.com/company/amazon');
    await applyAndExpectResults(page);
  });

  test('Headcount range filter returns candidates at companies within the range', async () => {
    await setHeadcount(page, 50, 1000);
    await applyAndExpectResults(page);
  });

  // ----------------------------------------------------------------
  // By past companies — name autocomplete, manual name
  // ----------------------------------------------------------------
  test('Past company name filter returns candidates who worked at the company', async () => {
    await setPastCompanyName(page, 'Oracle');
    await applyAndExpectResults(page);
  });

  test('Past company manual name entry returns candidates for the typed company', async () => {
    await setCompanyNameManually(page, pastCompaniesAcc, 'Yahoo');
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
  // to a particular set of candidates, Apply, assert results, then
  // afterEach clears all filters before the next scenario. Each test
  // reuses the single-filter setters above so the intent stays readable.
  // ================================================================
  test('Scenario: software engineers in the Accounting industry', async () => {
    await chooseTitle(page, 'Software Engineer');
    await selectTreeNode(page, industryAcc, 'Accounting');
    await applyAndExpectResults(page);
  });

  test('Scenario: software engineers located in the US', async () => {
    await chooseTitle(page, 'Software Engineer');
    await selectTreeNode(page, candidateLocationAcc, 'US States');
    await applyAndExpectResults(page);
  });

  test('Scenario: senior-level candidates in the Accounting industry', async () => {
    await selectTreeNode(page, roleSeniorityAcc, 'Senior');
    await selectTreeNode(page, industryAcc, 'Accounting');
    await applyAndExpectResults(page);
  });

  test('Scenario: Java-skilled candidates located in the US', async () => {
    await addSkill(page, 'Java');
    await selectTreeNode(page, candidateLocationAcc, 'US States');
    await applyAndExpectResults(page);
  });

  test('Scenario: experienced candidates in Engineering roles (years + job role)', async () => {
    await setYearsOfExperience(page, 5, 20);
    await selectTreeNode(page, roleSeniorityAcc, 'Engineering');
    await applyAndExpectResults(page);
  });

  test('Scenario: Computer Science PhD candidates (major + degree)', async () => {
    await chooseMajor(page, 'Computer Science');
    await chooseDegree(page, 'PhD');
    await applyAndExpectResults(page);
  });

  test('Scenario: PhD candidates from Harvard (degree + school)', async () => {
    await chooseDegree(page, 'PhD');
    await chooseSchool(page, 'Harvard');
    await applyAndExpectResults(page);
  });

  test('Scenario: software engineers with Java skills in the US (3 filters)', async () => {
    await chooseTitle(page, 'Software Engineer');
    await addSkill(page, 'Java');
    await selectTreeNode(page, candidateLocationAcc, 'US States');
    await applyAndExpectResults(page);
  });

  test('Scenario: senior software engineers with Java skills (title + level + skill)', async () => {
    await chooseTitle(page, 'Software Engineer');
    await selectTreeNode(page, roleSeniorityAcc, 'Senior');
    await addSkill(page, 'Java');
    await applyAndExpectResults(page);
  });

  test('Scenario: experienced engineers skilled in Python (years + role + skill)', async () => {
    await setYearsOfExperience(page, 5, 20);
    await selectTreeNode(page, roleSeniorityAcc, 'Engineering');
    await addSkill(page, 'Python');
    await applyAndExpectResults(page);
  });

  test('Scenario: Harvard Computer Science engineers (school + major + role)', async () => {
    await chooseSchool(page, 'Harvard');
    await chooseMajor(page, 'Computer Science');
    await selectTreeNode(page, roleSeniorityAcc, 'Engineering');
    await applyAndExpectResults(page);
  });

  test('Scenario: Product Managers currently at Netflix (title + company)', async () => {
    await chooseTitle(page, 'Product Manager');
    await setCompanyName(page, 'Netflix');
    await applyAndExpectResults(page);
  });

  test('Scenario: Data Scientists at companies headquartered in CA (title + HQ tree)', async () => {
    await chooseTitle(page, 'Data Scientist');
    await selectHeadquarterTreeNode(page, 'CA States');
    await applyAndExpectResults(page);
  });

  test('Scenario: SQL-skilled candidates currently at Adobe (skill + company)', async () => {
    await addSkill(page, 'SQL');
    await setCompanyName(page, 'Adobe');
    await applyAndExpectResults(page);
  });

  test('Scenario: senior candidates who previously worked at Salesforce (level + past company)', async () => {
    await selectTreeNode(page, roleSeniorityAcc, 'Senior');
    await setPastCompanyName(page, 'Salesforce');
    await applyAndExpectResults(page);
  });

  test('Scenario: AWS-experienced candidates with HQ in Berlin (keyword + manual HQ)', async () => {
    await addExperienceKeyword(page, 'AWS');
    await enterHeadquarterLocationManually(page, 'Berlin');
    await applyAndExpectResults(page);
  });

  test('Scenario: experienced candidates currently at Apple (company + years of experience)', async () => {
    await setCompanyName(page, 'Apple');
    await setYearsOfExperience(page, 3, 15);
    await applyAndExpectResults(page);
  });

  test('Scenario: candidates at mid-size companies in the Accounting industry (industry + headcount)', async () => {
    await selectTreeNode(page, industryAcc, 'Accounting');
    await setHeadcount(page, 51, 200);
    await applyAndExpectResults(page);
  });

  test('Scenario: Python-skilled candidates at small international-HQ companies (skill + HQ + headcount)', async () => {
    await addSkill(page, 'Python');
    await selectHeadquarterTreeNode(page, 'International');
    await setHeadcount(page, 201, 500);
    await applyAndExpectResults(page);
  });

  test('Scenario: senior candidates at Google who previously worked at Microsoft (level + company + past company)', async () => {
    await selectTreeNode(page, roleSeniorityAcc, 'Senior');
    await setCompanyName(page, 'Google');
    await setPastCompanyName(page, 'Microsoft');
    await applyAndExpectResults(page);
  });

  // ================================================================
  // Complex combination scenarios — 4-5 filters stacked per search,
  // each scenario deliberately uses DIFFERENT values (titles, skills,
  // companies, industries, schools, locations) from the earlier tests
  // so the suite exercises a wider slice of the filter value space.
  // ================================================================
  test('Scenario: senior DevOps engineers with Kubernetes in US metros, 4-12 yrs (title + level + skill + location + years)', async () => {
    await chooseTitle(page, 'DevOps Engineer');
    await selectTreeNode(page, roleSeniorityAcc, 'Senior');
    await addSkill(page, 'Kubernetes');
    await selectTreeNode(page, candidateLocationAcc, 'US Metro Regions');
    await setYearsOfExperience(page, 4, 12);
    await applyAndExpectResults(page);
  });

  test('Scenario: Director-level Finance candidates in Banking located in Chicago (level + job role + industry + manual location)', async () => {
    await selectTreeNode(page, roleSeniorityAcc, 'Director');
    await selectTreeNode(page, roleSeniorityAcc, 'Finance');
    await selectTreeNode(page, industryAcc, 'Banking');
    await enterLocationManually(page, 'Chicago');
    await applyAndExpectResults(page);
  });

  test('Scenario: React frontend developers at mid-size companies in CA, 2-8 yrs (title + skill + headcount + location + years)', async () => {
    await chooseTitle(page, 'Frontend Developer');
    await addSkill(page, 'React');
    await setHeadcount(page, 51, 200);
    await selectTreeNode(page, candidateLocationAcc, 'CA States');
    await setYearsOfExperience(page, 2, 8);
    await applyAndExpectResults(page);
  });

  test('Scenario: MIT Master\'s engineers majoring in Electrical Engineering with C++ (school + degree + major + job role + skill)', async () => {
    await chooseSchool(page, 'MIT');
    await chooseDegree(page, 'Master');
    await chooseMajor(page, 'Electrical Engineering');
    await selectTreeNode(page, roleSeniorityAcc, 'Engineering');
    await addSkill(page, 'C++');
    await applyAndExpectResults(page);
  });

  test('Scenario: C-Level consultants at small international-HQ companies (level + job role + HQ + headcount)', async () => {
    await selectTreeNode(page, roleSeniorityAcc, 'C-Level');
    await selectTreeNode(page, roleSeniorityAcc, 'Consulting');
    await selectHeadquarterTreeNode(page, 'International');
    await setHeadcount(page, 11, 50);
    await applyAndExpectResults(page);
  });

  test('Scenario: business-email HR managers in Advertising near Boston, 5-15 yrs (email type + title + industry + manual location + years)', async () => {
    await selectEmailType(page, 'Business Email');
    await chooseTitle(page, 'HR Manager');
    await selectTreeNode(page, industryAcc, 'Advertising Services');
    await enterLocationManually(page, 'Boston');
    await setYearsOfExperience(page, 5, 15);
    await applyAndExpectResults(page);
  });

  test('Scenario: ex-Amazon experienced managers now at Meta with AWS skills in Engineering (past company + company + level + skill + job role)', async () => {
    await setPastCompanyName(page, 'Amazon');
    await setCompanyName(page, 'Meta');
    await selectTreeNode(page, roleSeniorityAcc, 'Experienced Manager');
    await addSkill(page, 'AWS');
    await selectTreeNode(page, roleSeniorityAcc, 'Engineering');
    await applyAndExpectResults(page);
  });

  test('Scenario: Stanford MBA financial analysts in US metro regions (school + degree + title + location)', async () => {
    await chooseSchool(page, 'Stanford');
    await chooseDegree(page, 'MBA');
    await chooseTitle(page, 'Financial Analyst');
    await selectTreeNode(page, candidateLocationAcc, 'US Metro Regions');
    await applyAndExpectResults(page);
  });

  test('Scenario: Docker-skilled candidates with Terraform experience at large Toronto-HQ companies, 3-10 yrs (skill + keyword + headcount + manual HQ + years)', async () => {
    await addSkill(page, 'Docker');
    await addExperienceKeyword(page, 'Terraform');
    await setHeadcount(page, 501, 1000);
    await enterHeadquarterLocationManually(page, 'Toronto');
    await setYearsOfExperience(page, 3, 10);
    await applyAndExpectResults(page);
  });

  test('Scenario: entry-level Marketing candidates in Airlines with an SEO skills prompt outside the US (level + job role + industry + skills prompt + location)', async () => {
    await selectTreeNode(page, roleSeniorityAcc, 'Entry Level');
    await selectTreeNode(page, roleSeniorityAcc, 'Marketing');
    await selectTreeNode(page, industryAcc, 'Airlines and Aviation');
    await fillSkillsPrompt(page, 'SEO AND Google Analytics');
    await selectTreeNode(page, candidateLocationAcc, 'International');
    await applyAndExpectResults(page);
  });

  test('Scenario: Tableau business analysts at IBM with a SQL/Excel experience prompt, 2-9 yrs (title + skill + company + experience prompt + years)', async () => {
    await chooseTitle(page, 'Business Analyst');
    await addSkill(page, 'Tableau');
    await setCompanyName(page, 'IBM');
    await fillExperiencePrompt(page, 'SQL AND Excel');
    await setYearsOfExperience(page, 2, 9);
    await applyAndExpectResults(page);
  });

  test('Scenario: recently job-changed engineers at Cisco in the US (last job changed + job role + company + location)', async () => {
    await selectDropdownFirstOption(page, roleSeniorityAcc, 'Select Last Job Changed');
    await selectTreeNode(page, roleSeniorityAcc, 'Engineering');
    await setCompanyName(page, 'Cisco');
    await selectTreeNode(page, candidateLocationAcc, 'US States');
    await applyAndExpectResults(page);
  });
});
