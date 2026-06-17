import { test, expect } from '@playwright/test';

// Recruitment Page *action* functionalities (preprod.zenbee.io/search/recruitment).
//
// These features act on a candidate produced by an applied filter search, so a
// filter must always be applied first and results rendered. This suite covers the
// Clone Candidate → Save Clone flow:
//
//   1. Apply a filter            — results render as candidate cards in the table.
//   2. Hover a candidate         — reveals a "Clone Candidate" action on the card.
//   3. Click "Clone Candidate"   — the app builds a clone (takes a few seconds);
//                                  when ready a "Save this clone" button appears.
//   4. Click "Save this clone"   — opens the "Save Candidate Clone" dialog.
//   5. Name the clone + Save     — persists the clone; wait for it to settle.
//
// All tests share a single authenticated page opened once in beforeAll (login
// happens once via storageState). afterEach returns to a clean filter state.
// (recruitment-functionalities-test-flow skill.)

const RECRUITMENT_URL = 'https://preprod.zenbee.io/search/recruitment';

// ---------- locator helpers (reused from the Recruitment filter suite) ----------
const applyBtn = (page) => page.getByRole('button', { name: 'Apply Filters' });
const clearAllBtn = (page) => page.getByRole('button', { name: /^Clear all$/i });
const roleSeniorityAcc = (page) => page.getByRole('button', { name: 'Role and seniority' });
const resultsTable = (page) => page.getByRole('table');

// ---------- filter workflow helpers (reused) ----------
async function expandSection(page, accordionBtnFn) {
  const btn = accordionBtnFn(page).first();
  await expect(btn).toBeVisible({ timeout: 20000 });
  const expanded = await btn.evaluate((el) => el.getAttribute('aria-expanded'));
  if (expanded !== 'true') await btn.click();
}

// Type `query` into an autocomplete combobox and click the first matching suggestion.
// preprod's autocomplete is slow, so we WAIT for the option to render before clicking.
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

async function chooseTitle(page, title) {
  await expandSection(page, roleSeniorityAcc);
  await chooseAutocomplete(page, 'Enter Title', title);
}

async function applyAndExpectResults(page) {
  await page.keyboard.press('Escape').catch(() => {});
  await expect(applyBtn(page)).toBeEnabled({ timeout: 15000 });
  await applyBtn(page).click();
  // The Recruitment landing pane shows the AI-chat hero until a search runs; the
  // results table replaces it after Apply.
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

// ---------- Clone Candidate helpers ----------
// Hover the first candidate card to reveal its "Clone Candidate" action, then click
// it. The button lives inside the candidate's row but is only shown on hover, so we
// scope to the row that contains it, hover the row, and click the button.
async function cloneFirstCandidate(page) {
  const cloneBtn = page.getByRole('button', { name: 'Clone Candidate' }).first();
  const candidateRow = resultsTable(page)
    .getByRole('row')
    .filter({ has: page.getByRole('button', { name: 'Clone Candidate' }) })
    .first();
  await candidateRow.scrollIntoViewIfNeeded();
  await candidateRow.hover();
  await cloneBtn.click();
}

// ---------- test suite ----------
test.describe.serial('Recruitment Page functionalities (shared page)', () => {
  // Cloning a candidate is slow on preprod (~30s+ to build, sometimes more), so
  // give each test a generous budget.
  test.describe.configure({ timeout: 240000 });

  let context;
  let page;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(180000);
    context = await browser.newContext({ storageState: 'playwright/.auth/user.json' });
    page = await context.newPage();
    await page.goto(RECRUITMENT_URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await expect(applyBtn(page)).toBeVisible({ timeout: 120000 });
    // The content panel loader clears only once the app fully hydrates.
    await expect(page.getByText(/prepare your search interface/i))
      .toBeHidden({ timeout: 60000 })
      .catch(() => {});
    await clearAllIfPresent(page);
  });

  test.afterEach(async () => {
    // Reset to a clean Recruitment page each time. A goto sidesteps any leftover
    // clone state / open dialog. Login persists via storageState, so this never
    // re-authenticates.
    await page.goto(RECRUITMENT_URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await expect(applyBtn(page)).toBeVisible({ timeout: 120000 });
    await clearAllIfPresent(page);
  });

  test.afterAll(async () => {
    await context?.close();
  });

  // ================================================================
  // Test Case 1 — Clone a candidate and save the clone
  // ================================================================
  test('Test Case 1: Clone a candidate then save the clone with a name', async () => {
    // 1. Apply a filter so candidate results render.
    await chooseTitle(page, 'Chief Technology Officer');
    await applyAndExpectResults(page);

    // 2. Hover the first candidate and click "Clone Candidate".
    await cloneFirstCandidate(page);

    // 3. Cloning takes a few seconds — wait for the "Save this clone" button to
    //    appear, which signals the clone has been created.
    const saveThisCloneBtn = page.getByRole('button', { name: 'Save this clone' });
    await expect(saveThisCloneBtn).toBeVisible({ timeout: 150000 });
    await saveThisCloneBtn.click();

    // 4. The "Save Candidate Clone" dialog appears — name the clone.
    const cloneDialog = page.getByRole('dialog').filter({ hasText: 'Save Candidate Clone' });
    await expect(cloneDialog).toBeVisible({ timeout: 20000 });
    const nameInput = cloneDialog.getByPlaceholder(/clone name/i);
    await nameInput.click();
    // Name must be at least 3 characters; keep it unique per run to avoid collisions.
    await nameInput.fill(`Automated Clone ${Date.now()}`);

    // 5. Save and wait 3 seconds for the save to settle.
    await cloneDialog.getByRole('button', { name: 'Save', exact: true }).click();
    await page.waitForTimeout(3000);

    // The dialog closing confirms the clone was saved.
    await expect(cloneDialog).toBeHidden({ timeout: 20000 });
  });
});
