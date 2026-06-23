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
const advancedSelectionBtn = (page) => page.getByRole('button', { name: /Advanced Selection/i });
const saveToListsBtn = (page) => page.getByRole('button', { name: /^Save to lists$/i });
const exportSelectedBtn = (page) => page.getByRole('button', { name: /Export selected/i });

// ---------- CSV export popup option locators ----------
const businessEmailOption = (page) => page.getByRole('checkbox', { name: /Business Emails? only/i });
const unverifiedEmailOption = (page) => page.getByRole('checkbox', { name: /Unverified Emails/i });
const supplementaryInfoOption = (page) => page.getByRole('checkbox', { name: /Supplementary Info/i });

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

// ---------- Advanced Selection + Save to List helpers ----------
// PrimeNG spinbuttons ignore .fill() — click, select-all, then type the digits.
async function setSpin(spin, value) {
  await spin.click();
  await spin.press('Control+A');
  await spin.pressSequentially(value, { delay: 50 });
}

// Open "Advanced Selection" and select a page range (Start page → End page), then
// apply. The Recruitment page exposes this as a small panel above the results with
// a Start/End page range (it lets you select beyond the current page, up to the
// page cap shown in the panel), mirroring the Contacts Advanced Selection.
async function selectPageRange(page, startPage, endPage) {
  await advancedSelectionBtn(page).click();
  const advPanel = page.getByRole('dialog').filter({ hasText: /Advanced Selection/i });
  await expect(advPanel).toBeVisible({ timeout: 15000 });

  const spinners = advPanel.getByRole('spinbutton');
  await setSpin(spinners.nth(0), String(startPage));
  await setSpin(spinners.nth(1), String(endPage));

  // The apply control is labelled "Apply Options" / "Apply Selection" depending on
  // the build — match either.
  const applySelection = advPanel.getByRole('button', { name: /Apply (Options|Selection)/i });
  await expect(applySelection).toBeEnabled({ timeout: 10000 });
  await applySelection.click();
}

// Save the current selection to a brand-new list (Search or create list → type a
// unique name → Create new list → Create List). Same list-builder dialog the
// Contacts page uses.
async function saveSelectionToNewList(page, listName) {
  await expect(saveToListsBtn(page)).toBeEnabled({ timeout: 15000 });
  await saveToListsBtn(page).click();

  const listSearch = page.getByRole('searchbox', { name: 'Search or create list' });
  await expect(listSearch).toBeVisible({ timeout: 15000 });
  await listSearch.fill(listName);

  const createNew = page.getByText(/Create new list/i);
  await expect(createNew).toBeVisible({ timeout: 10000 });
  await createNew.click();

  // Footer button relabels from "Save" to "Create List" once a new name is staged.
  const createListBtn = page.getByRole('button', { name: /^Create List$/ });
  await expect(createListBtn).toBeEnabled({ timeout: 10000 });
  await createListBtn.click();

  // The dialog closing confirms the list was created with the selected candidates.
  await expect(listSearch).toBeHidden({ timeout: 15000 });
}

// ---------- Export helpers ----------
// Select the first `n` candidate rows by checking each row's checkbox. The
// "Select all" control lives in the toolbar (not a table row), so each results
// row exposes exactly one candidate checkbox.
async function selectFirstCandidates(page, n) {
  const rows = resultsTable(page).getByRole('row');
  const total = await rows.count();
  let selected = 0;
  for (let i = 0; i < total && selected < n; i++) {
    const cb = rows.nth(i).getByRole('checkbox').first();
    if ((await cb.count()) === 0) continue;
    await cb.scrollIntoViewIfNeeded().catch(() => {});
    await cb.check();
    selected++;
  }
  return selected;
}

// Open the "Export selected" dropdown → "Export to CSV" and wait for the export
// popup to render. Shared by every CSV-export case (Steps 4–8). Returns once the
// popup is on screen (its "Unverified Emails" option is the render marker).
async function openCsvExportPopup(page) {
  // Step 4 — The results toolbar is horizontally scrollable and the "Export
  // selected" button sits at its far-right edge, so it can be out of the visible
  // area. Scroll it into view before interacting so the click reliably lands.
  const exportSelected = exportSelectedBtn(page);
  await expect(exportSelected).toBeEnabled({ timeout: 30000 });
  await exportSelected.scrollIntoViewIfNeeded().catch(() => {});

  // Step 5 — Click "Export selected". Step 6 — confirm the dropdown opened (its
  // "Export to CSV" item appears); if the menu didn't open, click once more.
  await exportSelected.click();
  const exportToCsvOption = page.getByRole('button', { name: /Export to CSV/i }).first();
  if (!(await exportToCsvOption.isVisible().catch(() => false))) {
    await exportSelected.click();
  }
  await expect(exportToCsvOption).toBeVisible({ timeout: 10000 });

  // Step 7 — Click "Export to CSV". The PrimeNG dropdown item animates in (and
  // auto-focuses), so a normal click keeps failing the "element is stable" check
  // until the item detaches/re-mounts. Let the entrance animation settle, then
  // force the click (skips the actionability wait); fall back to dispatching it.
  await page.waitForTimeout(500);
  try {
    await exportToCsvOption.click({ force: true, timeout: 8000 });
  } catch {
    await exportToCsvOption.dispatchEvent('click').catch(() => {});
  }

  // Step 8 — Verify the export popup ("Choose Export Type (CSV)") is displayed.
  await expect(unverifiedEmailOption(page)).toBeVisible({ timeout: 15000 });
}

// Set a popup checkbox to an exact desired state, but only when it is present.
// `desired`: true → ensure checked, false → ensure unchecked, undefined → leave
// it untouched (don't check or uncheck). Returns true if the option was found.
async function setExportOption(option, desired) {
  if (desired === undefined) return false;
  if (!(await option.isVisible().catch(() => false))) return false;
  const checked = await option.isChecked().catch(() => false);
  if (desired && !checked) await option.check();
  if (!desired && checked) await option.uncheck();
  return true;
}

// Click "Export" and confirm the optional token-usage prompt if it appears.
async function submitCsvExport(page) {
  const exportBtn = page.getByRole('button', { name: /^Export$/i });
  await expect(exportBtn).toBeEnabled({ timeout: 10000 });
  await exportBtn.click();

  // A token-usage confirmation ("...will use approximately X tokens...") may
  // follow on some builds — confirm it if it appears.
  const yesBtn = page.getByRole('button', { name: /^Yes$/i });
  if (await yesBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
    await yesBtn.click();
  }
}

// Full CSV export with explicit popup options. Open the popup, set each option to
// its desired state (undefined = leave as-is), then Export. `supplementaryInfo`
// defaults to undefined so existing callers are unaffected.
async function exportSelectedToCsv(page, opts = {}) {
  const { businessEmails, unverifiedEmails, supplementaryInfo } = opts;
  await openCsvExportPopup(page);

  await setExportOption(businessEmailOption(page), businessEmails);
  await setExportOption(unverifiedEmailOption(page), unverifiedEmails);
  await setExportOption(supplementaryInfoOption(page), supplementaryInfo);

  await submitCsvExport(page);
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

  // ================================================================
  // Test Case 2 — Advanced Selection → Save candidates to a new List
  // ================================================================
  // Mirrors the Contacts "Save to List" flow, but on the Recruitment page:
  // apply a filter so candidates render, open Advanced Selection and pick a page
  // range (selects candidates beyond the current page), then Save to lists into a
  // brand-new list.
  test('Test Case 2: Advanced Selection of a page range saves candidates to a new list', async () => {
    // 1. Apply a filter so candidate results render.
    await chooseTitle(page, 'Chief Technology Officer');
    await applyAndExpectResults(page);

    // 2. Open Advanced Selection and select pages 1–2.
    await selectPageRange(page, 1, 2);

    // 3. Save the selected candidates into a uniquely-named new list.
    await saveSelectionToNewList(page, `QA Recruitment List ${Date.now()}`);
  });

  // ================================================================
  // Test Case 3 — Export selected candidates to CSV
  // ================================================================
  // Apply a filter so candidates render, select a few candidates, open the
  // "Export selected" dropdown and choose "Export to CSV", then complete the CSV
  // export popup (Business Emails only + Unverified Emails → Export → confirm).
  test('Test Case 3: Export selected candidates to CSV', async () => {
    // 1. Apply a filter so candidate results render.
    await chooseTitle(page, 'Chief Technology Officer');
    await applyAndExpectResults(page);

    // 2. Select a few candidates.
    const selected = await selectFirstCandidates(page, 2);
    expect(selected).toBeGreaterThan(0);

    // 3. Export selected → Export to CSV → finish the CSV export popup.
    await exportSelectedToCsv(page, { businessEmails: true, unverifiedEmails: true });
  });

  // ================================================================
  // Test Case 4 — Export CSV with Supplementary Info
  // ================================================================
  // Open the CSV export popup, then: uncheck "Business Emails only", leave
  // "Unverified Emails" unchecked, check "Supplementary Info", and Export.
  test('Test Case 4: Export selected candidates to CSV with Supplementary Info', async () => {
    // 1. Apply a filter so candidate results render.
    await chooseTitle(page, 'Chief Technology Officer');
    await applyAndExpectResults(page);

    // 2. Select a few candidates.
    const selected = await selectFirstCandidates(page, 2);
    expect(selected).toBeGreaterThan(0);

    // 3. Export to CSV: Business Email off, Unverified off, Supplementary Info on.
    await exportSelectedToCsv(page, {
      businessEmails: false,
      unverifiedEmails: false,
      supplementaryInfo: true,
    });
  });

  // ================================================================
  // Test Case 5 — Export CSV with all options enabled
  // ================================================================
  // Open the CSV export popup, then: ensure "Business Emails only" is checked
  // (without unchecking it if already on), check "Unverified Emails", check
  // "Supplementary Info", and Export.
  test('Test Case 5: Export selected candidates to CSV with all options enabled', async () => {
    // 1. Apply a filter so candidate results render.
    await chooseTitle(page, 'Chief Technology Officer');
    await applyAndExpectResults(page);

    // 2. Select a few candidates.
    const selected = await selectFirstCandidates(page, 2);
    expect(selected).toBeGreaterThan(0);

    // 3. Export to CSV with every option enabled.
    await exportSelectedToCsv(page, {
      businessEmails: true,
      unverifiedEmails: true,
      supplementaryInfo: true,
    });
  });
});
