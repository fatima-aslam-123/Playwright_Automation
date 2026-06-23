import { test, expect } from '@playwright/test';

// Companies Page *action* functionalities (preprod.zenbee.io/search/companies).
//
// These features act on company records produced by an applied filter search, so
// a filter must always be applied first and results rendered. This suite covers
// the "Export Selected" toolbar flow to three destinations:
//
//   Test Case 1 — Export Selected companies → Export to CSV
//   Test Case 2 — Export Selected companies → Export to HubSpot
//   Test Case 3 — Export Selected companies → Export to Salesforce
//   Test Case 4 — Advanced Selection of a page range → Save to a new List
//   Test Case 5 — Find Contacts from selected companies → Save contacts to a List
//
// TC1–3 follow the same shape:
//   1. Apply a filter            — results render as company rows in the table.
//   2. Select one or more rows   — tick each company's row checkbox.
//   3. Click "Export Selected"   — opens the export dropdown.
//   4. Choose the destination    — "Export to CSV" / "HubSpot" / "Salesforce".
//   5. Confirm the popup (Yes)   — the export is accepted; the popup closes.
//
// TC4 selects whole pages of companies via Advanced Selection, then saves them to
// a brand-new list (mirrors the Contacts/Recruitment Save-to-List flow).
//
// All tests share a single authenticated page opened once in beforeAll (login
// happens once via storageState). afterEach returns to a clean filter state.
// (companies-functionalities-test-flow skill.)

const COMPANIES_URL = 'https://preprod.zenbee.io/search/companies';
const LISTS_URL = 'https://preprod.zenbee.io/lists';

// ---------- core locator helpers (reused from the Companies filter suite) ----------
const applyBtn = (page) => page.getByRole('button', { name: 'Apply Filters' });
const clearAllBtn = (page) => page.getByRole('button', { name: /^Clear all$/i });
const companyAttributesAcc = (page) => page.getByRole('button', { name: 'Company attributes' });
const industryAcc = (page) => page.getByRole('button', { name: 'Industry' });
const resultsTable = (page) => page.getByRole('table');
const advancedSelectionBtn = (page) => page.getByRole('button', { name: /Advanced Selection/i });
const saveToListsBtn = (page) => page.getByRole('button', { name: /^Save to lists?$/i });

// ---------- filter workflow helpers ----------
async function expandSection(page, accordionBtnFn) {
  const btn = accordionBtnFn(page).first();
  await expect(btn).toBeVisible({ timeout: 20000 });
  const expanded = await btn.evaluate((el) => el.getAttribute('aria-expanded'));
  if (expanded !== 'true') await btn.click();
}

async function applyAndExpectResults(page) {
  await page.keyboard.press('Escape').catch(() => {});
  await expect(applyBtn(page)).toBeEnabled({ timeout: 15000 });
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

// PrimeNG checkbox tree — top-level industries are visible directly, so tick the
// category's tree node (no search box needed) to apply an Industry filter.
async function selectIndustry(page, name) {
  await expandSection(page, industryAcc);
  const node = page.getByRole('treeitem', { name }).first();
  await node.scrollIntoViewIfNeeded();
  await node.locator('.p-tree-node-content').first().click();
}

// HeadCount min/max range under the Company attributes accordion. exact:true so
// "Min"/"Max" don't also match Funding's "Min $"/"Max $" spinbuttons.
async function setHeadCount(page, min, max) {
  await expandSection(page, companyAttributesAcc);
  const minInput = page.getByRole('spinbutton', { name: 'Min', exact: true });
  const maxInput = page.getByRole('spinbutton', { name: 'Max', exact: true });
  await minInput.click();
  await minInput.fill(String(min));
  await minInput.press('Tab');
  await maxInput.click();
  await maxInput.fill(String(max));
  await maxInput.press('Tab');
}

// Revenue band under the Company attributes accordion — open the "Select revenue"
// dropdown, pick a band, then dismiss the overlay.
async function selectRevenue(page, label) {
  await expandSection(page, companyAttributesAcc);
  await page.getByText('Select revenue').click();
  await page.getByRole('option', { name: label }).click();
  await page.keyboard.press('Escape');
}

// ---------- selection helpers ----------
// Select the first `n` company rows by ticking each row's checkbox. Each data
// row's checkbox is a PrimeNG `<p-tablecheckbox><p-checkbox>` that does NOT expose
// role="checkbox" (so getByRole('checkbox') finds nothing) — locate the
// `p-tablecheckbox` elements directly. The header "select all" is a separate
// `p-tableheadercheckbox`, so this matches data rows only.
//
// Results render as skeleton rows first and real data (with the checkboxes)
// streams in after, so wait for the first real row checkbox before selecting.
// Returns how many rows were actually selected.
async function selectFirstCompanies(page, n) {
  await resultsTable(page).locator('p-skeleton').first().waitFor({ state: 'hidden', timeout: 30000 }).catch(() => {});
  const checkboxes = resultsTable(page).locator('p-tablecheckbox');
  await expect(checkboxes.first()).toBeVisible({ timeout: 30000 });
  const total = await checkboxes.count();
  const target = Math.min(n, total);
  for (let i = 0; i < target; i++) {
    const box = checkboxes.nth(i);
    await box.scrollIntoViewIfNeeded().catch(() => {});
    await box.click();
  }
  return target;
}

// The Contacts results table (reached via "Find contacts") uses the identical
// PrimeNG row-checkbox markup, so the same row selector works there — alias it so
// the contacts-selection intent reads clearly in Test Case 5.
const selectFirstContacts = (page, n) => selectFirstCompanies(page, n);

// ---------- Advanced Selection + Save to List helpers ----------
// PrimeNG spinbuttons ignore .fill() — click, select-all, then type the digits.
async function setSpin(spin, value) {
  await spin.click();
  await spin.press('Control+A');
  await spin.pressSequentially(value, { delay: 50 });
}

// Open "Advanced Selection" and select a page range (Start page → End page), then
// apply. This selects every company across the chosen pages (beyond the current
// page), mirroring the Contacts/Recruitment Advanced Selection panel.
async function selectPageRange(page, startPage, endPage) {
  await advancedSelectionBtn(page).click();
  // The panel is a plain <form> overlay (NOT a role=dialog). Its two page fields
  // are PrimeNG <p-inputnumber> bound to formcontrolname companyPageStart /
  // companyPageEnd, each wrapping an input[role=spinbutton] with no placeholder —
  // so anchor on the formcontrolname, which is stable.
  const startField = page.locator('p-inputnumber[formcontrolname="companyPageStart"] input[role="spinbutton"]');
  const endField = page.locator('p-inputnumber[formcontrolname="companyPageEnd"] input[role="spinbutton"]');
  await expect(startField).toBeVisible({ timeout: 15000 });
  await setSpin(startField, String(startPage));
  await setSpin(endField, String(endPage));

  const applySelection = page.getByRole('button', { name: /Apply Selection/i });
  await expect(applySelection).toBeEnabled({ timeout: 10000 });
  await applySelection.click();
  // The panel closes (Apply Selection leaves the DOM) once the selection applies.
  await expect(applySelection).toBeHidden({ timeout: 15000 });
}

// Save the current selection to a brand-new list: Save to lists → type a unique
// name into "Search or create list" → pick "Create new list" → Save. The same
// list-builder dialog the Contacts/Recruitment pages use; the footer button reads
// "Save" (or relabels to "Create List" on some builds), so match either.
async function saveSelectionToNewList(page, listName) {
  await expect(saveToListsBtn(page)).toBeEnabled({ timeout: 15000 });
  await saveToListsBtn(page).click();

  // Anchor on the "Search or create list" searchbox (the popup may not be a
  // role=dialog), type a unique name, then pick the "Create new list" option.
  const listSearch = page.getByRole('searchbox', { name: /Search or create list/i });
  await expect(listSearch).toBeVisible({ timeout: 15000 });
  await listSearch.fill(listName);

  const createNew = page.getByText(/Create new list/i);
  await expect(createNew).toBeVisible({ timeout: 10000 });
  await createNew.click();

  // Footer button reads "Save" here (relabels to "Create List" on some builds).
  const saveBtn = page.getByRole('button', { name: /^(Save|Create List)$/i });
  await expect(saveBtn).toBeEnabled({ timeout: 10000 });
  await saveBtn.click();

  // The popup closing (searchbox gone) confirms the list was created with the
  // selected companies.
  await expect(listSearch).toBeHidden({ timeout: 15000 });
}

// The "Export Selected" toolbar button sits at the far right of the results area,
// so nudge the nearest horizontally-scrollable ancestor fully right to bring it
// into view before clicking (best-effort; safe if nothing scrolls).
async function scrollResultsHorizontally(page) {
  await resultsTable(page)
    .evaluate((el) => {
      let node = el.parentElement;
      while (node) {
        if (node.scrollWidth > node.clientWidth) {
          node.scrollLeft = node.scrollWidth;
          break;
        }
        node = node.parentElement;
      }
    })
    .catch(() => {});
}

// ---------- export helper ----------
// Export the currently-selected companies to a destination from the results
// toolbar: Export Selected → "Export to <destination>" dropdown item → (optional
// export-options popup) → confirmation popup → Yes. CSV, HubSpot and Salesforce
// share the exact same toolbar button, dropdown, popup and confirmation — only
// the dropdown item label differs — so they all route through this one helper.
//   destinationRe: regex matching the dropdown item (e.g. /Export to CSV/i).
async function exportSelectedTo(page, destinationRe) {
  // Step 1 — bring "Export Selected" into view (far-right of the scrollable
  // toolbar) and click it to open the export dropdown.
  await scrollResultsHorizontally(page);
  const exportSelectedBtn = page.getByRole('button', { name: /Export Selected/i });
  await expect(exportSelectedBtn).toBeEnabled({ timeout: 30000 });
  await exportSelectedBtn.scrollIntoViewIfNeeded().catch(() => {});
  await exportSelectedBtn.click();

  // Step 2 — the export dropdown is displayed; choose the destination item. The
  // PrimeNG dropdown item animates in and detaches/re-mounts, so a normal click
  // fails the stability check — let it settle, then force-click with a
  // dispatchEvent fallback.
  const destinationOption = page.getByText(destinationRe).first();
  await expect(destinationOption).toBeVisible({ timeout: 10000 });
  await page.waitForTimeout(500);
  await destinationOption.click({ force: true }).catch(async () => {
    await destinationOption.dispatchEvent('click');
  });

  // Step 3 — some builds surface an export-options popup with its own "Export"
  // button before the final confirmation. Click it only when it is present so
  // the CSV / HubSpot / Salesforce flows all converge on the Yes confirmation.
  const dialog = page.getByRole('dialog').last();
  const innerExport = dialog.getByRole('button', { name: /^Export$/i });
  if (await innerExport.isVisible({ timeout: 4000 }).catch(() => false)) {
    await innerExport.click();
  }

  // Step 4 — the confirmation popup appears ("Are you sure...?" / token-usage
  // confirmation). Click Yes; the popup closing confirms the export was accepted.
  const yesBtn = page.getByRole('button', { name: /^Yes$/i });
  await expect(yesBtn).toBeVisible({ timeout: 15000 });
  await yesBtn.click();
  await expect(yesBtn).toBeHidden({ timeout: 15000 });
}

// Named wrappers — one per export destination. They differ only in the dropdown
// item label, so they delegate to exportSelectedTo() above.
const exportSelectedToCsv = (page) => exportSelectedTo(page, /Export to CSV/i);
const exportSelectedToHubSpot = (page) => exportSelectedTo(page, /Export to HubSpot/i);
const exportSelectedToSalesforce = (page) => exportSelectedTo(page, /Export to Salesforce/i);

// ---------- Find Contacts → Contacts tab → Lists verification helpers ----------
// Click "Find contacts" (lowercase c) on the Companies toolbar. It opens the
// Contacts search in a NEW TAB, pre-filtered by the selected companies' domains
// (companyNamesOrDomains in the URL). Returns the new contacts page once its
// results table has rendered.
async function findContactsInNewTab(page, context) {
  const findContactsBtn = page.getByRole('button', { name: /^Find contacts$/i });
  await expect(findContactsBtn).toBeEnabled({ timeout: 30000 });
  const popupPromise = context.waitForEvent('page', { timeout: 30000 });
  await findContactsBtn.click();
  const contactsPage = await popupPromise;
  await contactsPage.waitForLoadState('domcontentloaded').catch(() => {});
  await expect(contactsPage).toHaveURL(/\/search\/contacts/i, { timeout: 30000 });
  await expect(contactsPage.getByRole('table')).toBeVisible({ timeout: 60000 });
  return contactsPage;
}

// On the FIRST tab (the shared Companies page), navigate to the Lists page via the
// in-app sidebar "Lists" link (an in-app route — a hard goto on this tab trips a
// beforeunload guard and closes it), find the freshly-created list (newest → first
// row) by its unique name and click it. Opening the list navigates this same tab to
// /search/contacts?contactListIds=... — wait for the list's contacts to render with
// the list filter applied, then return how many contact rows are present.
async function openListAndCountContacts(page, listName) {
  await page.bringToFront();

  // Click the sidebar "Lists" link (in-app navigation, no full reload).
  const listsNav = page.getByRole('link', { name: /^Lists$/i }).first();
  await expect(listsNav).toBeVisible({ timeout: 30000 });
  await listsNav.click();
  await expect(page).toHaveURL(/\/lists/i, { timeout: 30000 });

  // NOTE: on this in-app route the "Loading your sales intelligence platform..."
  // splash text lingers in the DOM and never flips to hidden, so DON'T wait on it
  // (that just burns the timeout and looks stuck) — wait for the Lists table itself.
  //
  // The Lists table defaults to the "Contacts List" tab and the newest list sorts
  // to the top, so our just-saved list is the FIRST row. Confirm our list name is
  // present, then click the FIRST list row — this navigates this tab to the
  // Contacts page, filtered to that list's contacts.
  const listsTable = page.getByRole('table');
  await expect(listsTable).toBeVisible({ timeout: 60000 });
  await expect(page.getByText(listName)).toBeVisible({ timeout: 30000 });
  const firstList = listsTable.getByRole('cell').first();
  await firstList.click();

  // The opened list renders as a Contacts search filtered by the list id. Wait for
  // the contacts to load (loader + skeletons clear) before counting rows.
  await expect(page).toHaveURL(/contactListIds=/i, { timeout: 30000 });
  await page.getByText(/Loading Contacts/i).waitFor({ state: 'hidden', timeout: 60000 }).catch(() => {});
  const table = page.getByRole('table');
  await expect(table).toBeVisible({ timeout: 60000 });
  await table.locator('p-skeleton').first().waitFor({ state: 'hidden', timeout: 30000 }).catch(() => {});
  const rowCheckboxes = table.locator('p-tablecheckbox');
  await expect(rowCheckboxes.first()).toBeVisible({ timeout: 30000 });
  return rowCheckboxes.count();
}

// ---------- test suite ----------
test.describe.serial('Companies Page functionalities (shared page)', () => {
  test.describe.configure({ timeout: 120000 });

  let context;
  let page;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(120000);
    context = await browser.newContext({ storageState: 'playwright/.auth/user.json' });
    page = await context.newPage();
    await page.goto(COMPANIES_URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await expect(applyBtn(page)).toBeVisible({ timeout: 120000 });
    // The content panel loader ("...prepare your search interface") clears only
    // once the app fully hydrates.
    await expect(page.getByText(/prepare your search interface/i))
      .toBeHidden({ timeout: 60000 })
      .catch(() => {});
    await clearAllIfPresent(page);
  });

  test.afterEach(async () => {
    // Reset to a clean Companies page each time. A goto sidesteps any leftover
    // export dialog / selection. Login persists via storageState, so this never
    // re-authenticates.
    await page.goto(COMPANIES_URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await expect(applyBtn(page)).toBeVisible({ timeout: 120000 });
    await clearAllIfPresent(page);
  });

  test.afterAll(async () => {
    await context?.close();
  });

  // ================================================================
  // Test Case 1 — Export Selected companies → Export to CSV
  // ================================================================
  test('Test Case 1: Export selected companies to CSV', async () => {
    // 1. Apply a filter so company results render.
    await selectIndustry(page, 'Technology Companies');
    await applyAndExpectResults(page);

    // 2. Select one or more companies from the results table.
    const selected = await selectFirstCompanies(page, 2);
    expect(selected).toBeGreaterThan(0);

    // 3. Export Selected → Export to CSV → confirm the popup.
    await exportSelectedToCsv(page);

    // Let the export settle before the suite resets the page.
    await page.waitForTimeout(3000);
  });

  // ================================================================
  // Test Case 2 — Export Selected companies → Export to HubSpot
  // ================================================================
  test('Test Case 2: Export selected companies to HubSpot', async () => {
    // 1. Apply a filter so company results render.
    await setHeadCount(page, 100, 5000);
    await applyAndExpectResults(page);

    // 2. Select one or more companies from the results table.
    const selected = await selectFirstCompanies(page, 2);
    expect(selected).toBeGreaterThan(0);

    // 3. Export Selected → Export to HubSpot → confirm the popup.
    await exportSelectedToHubSpot(page);

    // Let the export settle before the suite resets the page.
    await page.waitForTimeout(3000);
  });

  // ================================================================
  // Test Case 3 — Export Selected companies → Export to Salesforce
  // ================================================================
  test('Test Case 3: Export selected companies to Salesforce', async () => {
    // 1. Apply a filter so company results render.
    await selectRevenue(page, '$10M-$25M');
    await applyAndExpectResults(page);

    // 2. Select one or more companies from the results table.
    const selected = await selectFirstCompanies(page, 2);
    expect(selected).toBeGreaterThan(0);

    // 3. Export Selected → Export to Salesforce → confirm the popup.
    await exportSelectedToSalesforce(page);

    // Let the export settle before the suite resets the page.
    await page.waitForTimeout(3000);
  });

  // ================================================================
  // Test Case 4 — Advanced Selection of a page range → Save to a new List
  // ================================================================
  // Apply a filter so companies render, open Advanced Selection and select
  // pages 3–4 (selects every company across those pages), then Save to lists
  // into a brand-new, uniquely-named list.
  test('Test Case 4: Advanced Selection of a page range saves companies to a new list', async () => {
    // 1. Apply a filter so company results render.
    await selectIndustry(page, 'Technology Companies');
    await applyAndExpectResults(page);

    // 2. Open Advanced Selection and select pages 3–4.
    await selectPageRange(page, 3, 4);

    // 3. Save the selected companies into a uniquely-named new list.
    await saveSelectionToNewList(page, `QA Companies List ${Date.now()}`);

    // Let the save settle before the suite resets the page.
    await page.waitForTimeout(3000);
  });

  // ================================================================
  // Test Case 5 — Find Contacts from selected companies → Save to a List
  // ================================================================
  // Apply a filter, select companies, click "Find contacts" (opens the Contacts
  // page in a NEW TAB pre-filtered by those companies), select contacts there and
  // save them to a brand-new list, then open that list from the Lists page and
  // verify its contacts are displayed.
  test('Test Case 5: Find Contacts from selected companies and save them to a list', async () => {
    test.setTimeout(180000);

    // 1. Apply a filter so company results render.
    await selectIndustry(page, 'Technology Companies');
    await applyAndExpectResults(page);

    // 2. Select one or more companies from the results table.
    const selected = await selectFirstCompanies(page, 2);
    expect(selected).toBeGreaterThan(0);

    // 3. Click "Find contacts" — the Contacts page opens in a new tab, pre-filtered
    //    by the selected companies.
    const contactsPage = await findContactsInNewTab(page, context);

    // 4. Wait for contacts to load, then select one or more contacts.
    const contactsSelected = await selectFirstContacts(contactsPage, 2);
    expect(contactsSelected).toBeGreaterThan(0);

    // 5. Save the selected contacts into a uniquely-named new list.
    const listName = `QA Find-Contacts List ${Date.now()}`;
    await saveSelectionToNewList(contactsPage, listName);

    // 6. Let the save settle, then close the contacts tab and switch back to the
    //    first (Companies) tab.
    await contactsPage.waitForTimeout(3000);
    await contactsPage.close();

    // 7. On the first tab, open the Lists page, open the newly created list and
    //    verify its saved contacts are displayed.
    const savedContacts = await openListAndCountContacts(page, listName);
    expect(savedContacts).toBeGreaterThan(0);

    // Let the navigation settle before the suite resets the page.
    await page.waitForTimeout(2000);
  });
});
