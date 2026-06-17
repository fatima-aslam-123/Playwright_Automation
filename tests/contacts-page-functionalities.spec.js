import { test, expect } from '@playwright/test';

// Contacts Page *action* functionalities:
//   1. Save to List          — Advanced Selection of 2 pages → new list
//   2. Personalized Email → Export (3 methods: System Generated, Custom Prompt, Template)
//   3. Personalized Email → Send   (3 methods: System Generated, Custom Prompt, Template)
//
// Export flow per method:
//   Create personalized email → Personalize to export → Choose Sender Profile (Fatima/QA)
//   → Save & Continue → Choose method → Continue → Export Selected → Export to CSV
//   → Business email + unverified checkbox
//
// Send flow per method:
//   Create personalized email → Personalize to send → Unverified Emails popup (check → Continue)
//   → confirmation (Yes) → Choose Sender Profile (Fatima/QA) → Save & Continue
//   → Choose method → Continue → Send email
//
// Croyten contacts verified present: Fatima Aslam, Asad Mahmood (used for Send tests; Amine excluded).
// PrimeNG spinbuttons ignore .fill() — use setSpin() (click → Ctrl+A → pressSequentially).

const CONTACTS_URL = 'https://preprod.zenbee.io/search/contacts';

// ---------- core locator helpers ----------
const applyBtn = (page) => page.getByRole('button', { name: 'Apply Filters' });
const clearAllBtn = (page) => page.getByRole('button', { name: /^Clear all$/i });
const resultsTable = (page) => page.getByRole('table');
const roleSeniorityAcc = (page) => page.getByRole('button', { name: 'Role and seniority' });
const currentCompanyAcc = (page) => page.getByRole('button', { name: 'Current Company' });
const createEmailBtn = (page) => page.getByRole('button', { name: 'Create personalized email' });
const saveToListsBtn = (page) => page.getByRole('button', { name: /^Save to lists$/ });
const advancedSelectionBtn = (page) => page.getByRole('button', { name: 'Advanced Selection' });
const dataRows = (page) => resultsTable(page).getByRole('row').filter({ hasText: /View Details/i });

// ---------- filter helpers ----------
async function expandSection(page, accordionBtnFn) {
  const btn = accordionBtnFn(page).first();
  await expect(btn).toBeVisible({ timeout: 20000 });
  const expanded = await btn.evaluate((el) => el.getAttribute('aria-expanded'));
  if (expanded !== 'true') await btn.click();
}

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

async function setCompanyName(page, company) {
  await expandSection(page, currentCompanyAcc);
  await chooseAutocomplete(page, 'Search company...', company);
}

// Management levels / job roles render as PrimeNG tree nodes (not checkboxes)
// under the Role and seniority accordion — click the node content to select.
async function selectTreeNode(page, accordionBtnFn, name) {
  await expandSection(page, accordionBtnFn);
  const node = page.getByRole('treeitem', { name, exact: true }).first();
  await node.scrollIntoViewIfNeeded();
  await node.locator('.p-tree-node-content').first().click();
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

async function selectFirstRows(page, n) {
  const rows = dataRows(page);
  const count = await rows.count();
  const target = Math.min(n, count);
  for (let i = 0; i < target; i++) {
    await rows.nth(i).getByRole('checkbox').first().check();
  }
  return target;
}

async function selectRowByName(page, name) {
  const row = resultsTable(page).getByRole('row').filter({ hasText: name }).first();
  await expect(row, `expected a results row for "${name}"`).toBeVisible({ timeout: 15000 });
  await row.getByRole('checkbox').first().check();
}

async function setSpin(spin, value) {
  await spin.click();
  await spin.press('Control+A');
  await spin.pressSequentially(value, { delay: 50 });
}

// ---------- shared flow helpers ----------

// Step: Choose Sender Profile → pick Fatima/QA → Save & Continue
async function chooseSenderProfile(page) {
  await expect(page.getByText(/profile with which you want to send/i)).toBeVisible({ timeout: 15000 });
  const profileCombo = page.getByRole('combobox', { name: 'Select a Profile' });
  await expect(profileCombo).toBeVisible();
  await profileCombo.click();
  const profileOption = page
    .getByRole('listbox')
    .getByRole('option')
    .filter({ hasText: /Fatima|QA/i })
    .first();
  await expect(profileOption).toBeVisible({ timeout: 10000 });
  await profileOption.click();
  const saveAndContinue = page.getByRole('button', { name: /Save & Continue/i });
  await expect(saveAndContinue).toBeEnabled({ timeout: 10000 });
  await saveAndContinue.click();
}

// Step: Choose generation method → Continue → method-specific popup interaction
// method: 'system' | 'custom' | 'template'
//
// System Generated: select → Continue → proceeds to Export/Send Selected
// Template:         select → Continue → popup: click first template (expands email) → click Select
// Custom Prompt:    select → Continue → popup: fill prompt textarea → click Create
// The "Continue →" button has an arrow in its label — use /Continue/i (no anchors).
async function chooseMethodAndContinue(page, method) {
  await expect(page.getByText(/Choose one of the following methods/i)).toBeVisible({ timeout: 15000 });

  if (method === 'system') {
    await page.getByText(/System Generated/i).first().click();
    const continueBtn = page.getByRole('button', { name: /Continue/i });
    await expect(continueBtn).toBeEnabled({ timeout: 10000 });
    await continueBtn.click();
    // Clicking Continue navigates to the listing screen where AI generates emails per contact.
    // exportToCsv() waits for Export Selected to enable before proceeding.

  } else if (method === 'template') {
    await page.getByText(/Templates/i).first().click();
    const continueBtn = page.getByRole('button', { name: /Continue/i });
    await expect(continueBtn).toBeEnabled({ timeout: 10000 });
    await continueBtn.click();
    // "Select a Saved Template" dialog — click the first template row to expand preview
    await expect(page.getByText(/Select a Saved Template/i)).toBeVisible({ timeout: 15000 });
    const firstTemplate = page.getByText(/Feedback Request/i).first();
    await expect(firstTemplate).toBeVisible({ timeout: 10000 });
    await firstTemplate.click();
    // Select button appears once template is expanded
    const selectBtn = page.getByRole('button', { name: /^Select$/i });
    await expect(selectBtn).toBeVisible({ timeout: 10000 });
    await selectBtn.click();

  } else if (method === 'custom') {
    await page.getByText(/Custom Prompt/i).first().click();
    const continueBtn = page.getByRole('button', { name: /Continue/i });
    await expect(continueBtn).toBeEnabled({ timeout: 10000 });
    await continueBtn.click();
    // Zenbot popup: type prompt → Create → listing screen (same export flow as system)
    const promptInput = page.getByPlaceholder(/Start typing/i);
    await expect(promptInput).toBeVisible({ timeout: 15000 });
    await promptInput.fill('Write an introductory email to a new contact explaining who we are and what our company does.');
    const createBtn = page.getByRole('button', { name: /^Create$/i });
    await expect(createBtn).toBeEnabled({ timeout: 10000 });
    await createBtn.click();
  }
}

// Step: Export Selected → CSV Export dropdown → choose Business email → check unverified → Continue
async function exportToCsv(page) {
  const exportSelectedBtn = page.getByRole('button', { name: /Export Selected/i });
  // Button stays disabled while AI generates emails per contact — wait until it enables
  await expect(exportSelectedBtn).toBeEnabled({ timeout: 120000 });
  await exportSelectedBtn.click();

  const exportToCsvOption = page.getByText(/Export to CSV/i).first();
  await expect(exportToCsvOption).toBeVisible({ timeout: 10000 });
  await exportToCsvOption.click();

  // Popup "Choose Export Type (CSV)": check "Business Emails only" if not already checked
  const businessEmailCheckbox = page.getByRole('checkbox', { name: /Business Emails only/i });
  await expect(businessEmailCheckbox).toBeVisible({ timeout: 10000 });
  if (!(await businessEmailCheckbox.isChecked())) {
    await businessEmailCheckbox.check();
  }

  // Also include contacts with Unverified Emails
  const unverifiedCheckbox = page.getByRole('checkbox', { name: /Unverified Emails/i });
  await expect(unverifiedCheckbox).toBeVisible({ timeout: 5000 });
  await unverifiedCheckbox.check();

  const exportBtn = page.getByRole('button', { name: /^Export$/i });
  await expect(exportBtn).toBeEnabled({ timeout: 10000 });
  await exportBtn.click();

  // Confirmation dialog: "This action will use approximately X tokens. Are you sure you want to proceed?"
  const yesBtn = page.getByRole('button', { name: /^Yes$/i });
  await expect(yesBtn).toBeVisible({ timeout: 10000 });
  await yesBtn.click();
}

// Step (Send only): after "Personalize to send" a popup appears before the
// Sender Profile step. Check "Unverified Emails" → Continue → confirmation Yes.
async function personalizeSendOptions(page) {
  const unverifiedCheckbox = page.getByRole('checkbox', { name: /Unverified Emails/i });
  await expect(unverifiedCheckbox).toBeVisible({ timeout: 15000 });
  await unverifiedCheckbox.check();

  const continueBtn = page.getByRole('button', { name: /Continue/i });
  await expect(continueBtn).toBeEnabled({ timeout: 10000 });
  await continueBtn.click();

  // Confirmation popup: "Are you sure ...?" → Yes
  const yesBtn = page.getByRole('button', { name: /^Yes$/i });
  await expect(yesBtn).toBeVisible({ timeout: 10000 });
  await yesBtn.click();
}

// Step: final — click "Send email" on the listing screen. The button stays
// disabled while AI generates emails per contact, so wait until it enables.
async function sendEmail(page) {
  const sendBtn = page.getByRole('button', { name: /Send Email/i });
  await expect(sendBtn).toBeEnabled({ timeout: 120000 });
  await sendBtn.click();
}

// ---------- test suite ----------

test.describe('Contacts Page functionalities (shared page)', () => {
  test.describe.configure({ timeout: 120000 });

  let context;
  let page;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(120000);
    context = await browser.newContext({ storageState: 'playwright/.auth/user.json' });
    page = await context.newPage();
    await page.goto(CONTACTS_URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await expect(applyBtn(page)).toBeVisible({ timeout: 120000 });
    await expect(page.getByText(/prepare your search interface/i)).toBeHidden({ timeout: 60000 });
    await clearAllIfPresent(page);
  });

  test.afterEach(async () => {
    try {
      await page.keyboard.press('Escape').catch(() => {});
      await page.keyboard.press('Escape').catch(() => {});
      await clearAllIfPresent(page);
    } catch {
      await page.goto(CONTACTS_URL, { waitUntil: 'domcontentloaded', timeout: 120000 }).catch(() => {});
      await expect(applyBtn(page)).toBeVisible({ timeout: 120000 }).catch(() => {});
      await clearAllIfPresent(page).catch(() => {});
    }
  });

  test.afterAll(async () => {
    await context?.close();
  });

  // ================================================================
  // Feature 1 — Save to List
  // ================================================================
  test('Save to List: Advanced Selection of 2 pages saves contacts to a new list', async () => {
    await chooseTitle(page, 'Software Engineer');
    await applyAndExpectResults(page);

    await advancedSelectionBtn(page).click();
    const advDialog = page.getByRole('dialog').filter({ hasText: /Advanced Selection/i });
    await expect(advDialog).toBeVisible({ timeout: 15000 });
    const spinners = advDialog.getByRole('spinbutton');
    await setSpin(spinners.nth(0), '1');
    await setSpin(spinners.nth(1), '2');
    const applySelection = advDialog.getByRole('button', { name: 'Apply Selection' });
    await expect(applySelection).toBeEnabled();
    await applySelection.click();

    await expect(saveToListsBtn(page)).toBeEnabled({ timeout: 15000 });
    await saveToListsBtn(page).click();

    const listSearch = page.getByRole('searchbox', { name: 'Search or create list' });
    await expect(listSearch).toBeVisible({ timeout: 15000 });
    const listName = `QA Functionalities List ${Date.now()}`;
    await listSearch.fill(listName);

    const createNew = page.getByText(/Create new list/i);
    await expect(createNew).toBeVisible({ timeout: 10000 });
    await createNew.click();

    // Footer button relabels from "Save" to "Create List" once a new name is staged
    const createListBtn = page.getByRole('button', { name: /^Create List$/ });
    await expect(createListBtn).toBeEnabled({ timeout: 10000 });
    await createListBtn.click();

    await expect(listSearch).toBeHidden({ timeout: 15000 });
  });

  // ================================================================
  // Feature 2 — Personalized Email → Export
  // ================================================================

  test('Export (1/3) — System Generated: full flow to Export to CSV', async () => {
    test.setTimeout(180000);

    await chooseTitle(page, 'Product Manager');
    await applyAndExpectResults(page);
    const selected = await selectFirstRows(page, 2);
    expect(selected).toBeGreaterThan(0);
    await expect(createEmailBtn(page)).toBeEnabled({ timeout: 15000 });

    await createEmailBtn(page).click();
    const exportItem = page.getByRole('button', { name: /Personalize to export/i });
    await expect(exportItem).toBeVisible({ timeout: 10000 });
    await exportItem.click();

    await chooseSenderProfile(page);
    await chooseMethodAndContinue(page, 'system');
    await exportToCsv(page);
  });

  test('Export (2/3) — Custom Prompt: full flow to Export to CSV', async () => {
    test.setTimeout(180000);

    await setCompanyName(page, 'Microsoft');
    await applyAndExpectResults(page);
    const selected = await selectFirstRows(page, 2);
    expect(selected).toBeGreaterThan(0);
    await expect(createEmailBtn(page)).toBeEnabled({ timeout: 15000 });

    await createEmailBtn(page).click();
    const exportItem = page.getByRole('button', { name: /Personalize to export/i });
    await expect(exportItem).toBeVisible({ timeout: 10000 });
    await exportItem.click();

    await chooseSenderProfile(page);
    await chooseMethodAndContinue(page, 'custom');
    await exportToCsv(page);
  });

  test('Export (3/3) — Template: full flow to Export to CSV', async () => {
    test.setTimeout(180000);

    await chooseTitle(page, 'Software Engineer');
    await applyAndExpectResults(page);
    const selected = await selectFirstRows(page, 2);
    expect(selected).toBeGreaterThan(0);
    await expect(createEmailBtn(page)).toBeEnabled({ timeout: 15000 });

    await createEmailBtn(page).click();
    const exportItem = page.getByRole('button', { name: /Personalize to export/i });
    await expect(exportItem).toBeVisible({ timeout: 10000 });
    await exportItem.click();

    await chooseSenderProfile(page);
    await chooseMethodAndContinue(page, 'template');
    await exportToCsv(page);
  });

  // ================================================================
  // Feature 3 — Personalized Email → Send
  // ================================================================

  test('Send (1/3) — System Generated: full flow to Send Selected', async () => {
    test.setTimeout(180000);

    await setCompanyName(page, 'Croyten');
    await applyAndExpectResults(page);
    for (const name of ['Fatima Aslam', 'Asad Mahmood']) {
      await selectRowByName(page, name);
    }
    await expect(createEmailBtn(page)).toBeEnabled({ timeout: 15000 });

    await createEmailBtn(page).click();
    await expect(page.getByRole('button', { name: /Personalize to export/i })).toBeVisible({ timeout: 10000 });
    const sendItem = page.getByRole('button', { name: /Personalize to send/i });
    await expect(sendItem).toBeVisible();
    await sendItem.click();

    await personalizeSendOptions(page);
    await chooseSenderProfile(page);
    await chooseMethodAndContinue(page, 'system');
    await sendEmail(page);
  });

  test('Send (2/3) — Custom Prompt: full flow to Send Selected', async () => {
    test.setTimeout(180000);

    await setCompanyName(page, 'Croyten');
    await applyAndExpectResults(page);
    for (const name of ['Fatima Aslam', 'Asad Mahmood']) {
      await selectRowByName(page, name);
    }
    await expect(createEmailBtn(page)).toBeEnabled({ timeout: 15000 });

    await createEmailBtn(page).click();
    await expect(page.getByRole('button', { name: /Personalize to export/i })).toBeVisible({ timeout: 10000 });
    const sendItem = page.getByRole('button', { name: /Personalize to send/i });
    await expect(sendItem).toBeVisible();
    await sendItem.click();

    await personalizeSendOptions(page);
    await chooseSenderProfile(page);
    await chooseMethodAndContinue(page, 'custom');
    await sendEmail(page);
  });

  test('Send (3/3) — Template: full flow to Send Selected', async () => {
    test.setTimeout(180000);

    await setCompanyName(page, 'Croyten');
    await applyAndExpectResults(page);
    for (const name of ['Fatima Aslam', 'Asad Mahmood']) {
      await selectRowByName(page, name);
    }
    await expect(createEmailBtn(page)).toBeEnabled({ timeout: 15000 });

    await createEmailBtn(page).click();
    await expect(page.getByRole('button', { name: /Personalize to export/i })).toBeVisible({ timeout: 10000 });
    const sendItem = page.getByRole('button', { name: /Personalize to send/i });
    await expect(sendItem).toBeVisible();
    await sendItem.click();

    await personalizeSendOptions(page);
    await chooseSenderProfile(page);
    await chooseMethodAndContinue(page, 'template');
    await sendEmail(page);
  });
});
