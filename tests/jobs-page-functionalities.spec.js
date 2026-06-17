import { test, expect } from '@playwright/test';

// Jobs Page *action* functionalities (preprod.zenbee.io/search/jobs).
//
// These features act on the Job Preview panel that opens when you click a job
// title in the results table, so a filter must always be applied first and a
// job opened. The preview is a PrimeNG modal (`app-job-preview-modal`, top-right,
// with an overlay mask) exposing three action buttons:
//
//   1. Save Job            — saves the job → success toast "Job saved successfully".
//   2. Find Candidates     — navigates (same tab, slowly) to the Recruitment page
//                            (/search/recruitment) pre-filled with the job's titles.
//   3. Find Decision Makers— reveals a "Decision Makers" section inside the preview
//                            panel (no navigation).
//
// All tests share a single authenticated page opened once in beforeAll (login
// happens once via storageState). Each test applies a filter, opens a job
// preview, performs one action, then afterEach closes the modal and clears all
// filters so the next test starts clean — no per-test login. (jobs-functionalities-test-flow skill.)

const JOBS_URL = 'https://preprod.zenbee.io/search/jobs';

// Local job-description PDF used by the "Create Job via upload" test. Forward
// slashes work fine on Windows in Node, and avoid backslash escaping.
const JOB_PDF_PATH = 'C:/Users/LENOVO/Downloads/Software engineer job description.pdf';

// ---------- locator helpers (reused from the Jobs filter suite) ----------
const applyBtn = (page) => page.getByRole('button', { name: 'Apply Filters' });
const clearAllBtn = (page) => page.getByRole('button', { name: /^Clear all$/i });
const jobTitleAcc = (page) => page.getByRole('button', { name: 'Job title' });
const resultsTable = (page) => page.getByRole('table');
const jobPreview = (page) => page.locator('app-job-preview-modal');

// ---------- Create Job locator helpers ----------
// The "Create a Job" button (top-right of the Jobs page) opens the "Create Job"
// dialog. That dialog has two entry points: upload a job document, or "Enter Job
// Details Manually" to fill the form by hand. The submit button inside the form
// is labelled "Create Job" (exact, to avoid matching the outer "Create a Job").
const createJobBtn = (page) => page.getByRole('button', { name: 'Create a Job' });
const createJobModal = (page) => page.getByRole('dialog').filter({ hasText: 'Create Job' });
const submitCreateJobBtn = (page) =>
  createJobModal(page).getByRole('button', { name: 'Create Job', exact: true });

// ---------- filter helpers ----------
async function expandSection(page, accordionBtnFn) {
  const btn = accordionBtnFn(page);
  await expect(btn).toBeVisible({ timeout: 20000 });
  const expanded = await btn.evaluate((el) => el.getAttribute('aria-expanded'));
  if (expanded !== 'true') await btn.click();
}

async function setJobTitle(page, title) {
  await expandSection(page, jobTitleAcc);
  const input = page.getByPlaceholder('Enter title');
  await input.click();
  await input.fill('');
  // Type real keystrokes (some engines don't fire the form-enable change on
  // fill()), then blur to commit so Apply Filters enables.
  await input.pressSequentially(title, { delay: 50 });
  await input.blur();
}

async function applyAndExpectResults(page) {
  await expect(applyBtn(page)).toBeEnabled({ timeout: 15000 });
  await applyBtn(page).click();
  await expect(resultsTable(page)).toBeVisible({ timeout: 30000 });
  await expect(resultsTable(page).getByRole('row')).not.toHaveCount(0);
  // Rows render skeletons first — wait for real data before reading a title.
  await expect(page.locator('p-skeleton').first()).toBeHidden({ timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1000);
}

async function clearAllIfPresent(page) {
  const btn = clearAllBtn(page);
  if (await btn.isVisible().catch(() => false)) {
    await btn.click();
    await expect(btn).toHaveCount(0);
    await expect(applyBtn(page)).toBeDisabled();
  }
}

// Click the title of the first job in the results table to open the Job Preview
// modal. Returns the job title that was opened.
async function openFirstJobPreview(page) {
  const firstRow = resultsTable(page).getByRole('row').nth(1);
  const titleCell = firstRow.getByRole('cell').first();
  const title = (await titleCell.innerText()).split('\n')[0].trim();
  await titleCell.getByText(title, { exact: false }).first().click();
  // The three action buttons live inside the modal — wait for it to be ready.
  await expect(jobPreview(page).getByRole('button', { name: 'Save Job' })).toBeVisible({ timeout: 20000 });
  return title;
}

// Open the "Create Job" dialog from the Jobs page and wait for its upload step
// (the "Upload Job Document" drop zone) to be ready.
async function openCreateJobModal(page) {
  await expect(createJobBtn(page)).toBeVisible({ timeout: 20000 });
  await createJobBtn(page).click();
  await expect(createJobModal(page)).toBeVisible({ timeout: 20000 });
  await expect(createJobModal(page).getByText('Upload Job Document')).toBeVisible({ timeout: 20000 });
}

// Select the first available option of a PrimeNG dropdown identified by its
// placeholder text (e.g. "Select work type"). Clicking the placeholder opens the
// overlay panel; its items expose role="option".
async function selectFirstDropdownOption(page, placeholder) {
  await createJobModal(page).getByText(placeholder, { exact: true }).click();
  const firstOption = page.getByRole('option').first();
  await expect(firstOption).toBeVisible({ timeout: 10000 });
  await firstOption.click();
}

// Fill every required field of the manual Create Job form with valid sample data.
async function fillJobDetailsManually(page) {
  const modal = createJobModal(page);
  await modal.getByPlaceholder('Enter job title').fill('Software Engineer');
  await selectFirstDropdownOption(page, 'Select work type');
  await selectFirstDropdownOption(page, 'Select Industry');
  await selectFirstDropdownOption(page, 'Select Employment Type');
  await modal.getByPlaceholder('Enter job location').fill('New York, USA');
  await modal.getByPlaceholder('Enter company name').fill('Croyten');
  await modal.getByPlaceholder('Enter company domain (e.g., example.com)').fill('croyten.com');
  await modal.getByPlaceholder('Enter job timezone (e.g., GMT+5, PST)').fill('GMT+5');
  await modal
    .getByPlaceholder('Enter Job Description')
    .fill(
      'We are looking for an experienced Software Engineer to design, build, and ' +
        'maintain scalable web applications and collaborate across teams.'
    );
}

// ---------- test suite ----------
test.describe.serial('Jobs Page functionalities (shared page)', () => {
  test.describe.configure({ timeout: 120000 });

  let context;
  let page;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(180000);
    context = await browser.newContext({ storageState: 'playwright/.auth/user.json' });
    page = await context.newPage();
    await page.goto(JOBS_URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await expect(applyBtn(page)).toBeVisible({ timeout: 120000 });
    await expect(jobTitleAcc(page)).toBeVisible({ timeout: 60000 });
    await clearAllIfPresent(page);
  });

  test.afterEach(async () => {
    // Re-open a fresh Jobs page each time as the reset. This is the most reliable
    // cleanup because: (a) the Save Job success toast renders top-right, overlapping
    // the preview modal's Close button (clicking Close gets intercepted), and
    // (b) Find Candidates navigates away to the Recruitment page. A goto sidesteps
    // both. Login persists via storageState, so this never re-authenticates.
    await page.goto(JOBS_URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await expect(applyBtn(page)).toBeVisible({ timeout: 120000 });
    await expect(jobTitleAcc(page)).toBeVisible({ timeout: 60000 });
    await clearAllIfPresent(page);
  });

  test.afterAll(async () => {
    await context?.close();
  });

  // ================================================================
  // Test Case 1 — Save Job
  // ================================================================
  test('Test Case 1: Save Job saves the job successfully', async () => {
    await setJobTitle(page, 'Marketing Manager');
    await applyAndExpectResults(page);

    await openFirstJobPreview(page);

    await jobPreview(page).getByRole('button', { name: 'Save Job' }).click();

    // Give the save action a few seconds to process before reading the result —
    // don't close the modal instantly after clicking.
    await page.waitForTimeout(4000);

    // Success is confirmed by the toast notification "Job saved successfully".
    const toast = page.locator('.p-toast-message');
    await expect(toast).toBeVisible({ timeout: 15000 });
    await expect(toast.getByText(/saved/i)).toBeVisible({ timeout: 15000 });
  });

  // ================================================================
  // Test Case 2 — Find Candidates → redirected to Recruitment page
  // ================================================================
  test('Test Case 2: Find Candidates redirects to the Recruitment page', async () => {
    await setJobTitle(page, 'Marketing Manager');
    await applyAndExpectResults(page);

    await openFirstJobPreview(page);

    await jobPreview(page).getByRole('button', { name: 'Find Candidates' }).click();

    // Navigation happens in the same tab but the backend is slow — wait generously
    // for the URL to land on the Recruitment page (pre-filled with the job's titles).
    await page.waitForURL(/\/search\/recruitment/, { timeout: 90000 });
    expect(page.url()).toContain('/search/recruitment');

    // Let the Recruitment page content settle after the redirect — wait a few
    // seconds for it to load before the test ends.
    await page.waitForTimeout(4000);
  });

  // ================================================================
  // Test Case 3 — Find Decision Makers → section shown in preview panel
  // ================================================================
  test('Test Case 3: Find Decision Makers shows the Decision Makers section', async () => {
    await setJobTitle(page, 'Marketing Manager');
    await applyAndExpectResults(page);

    await openFirstJobPreview(page);

    // The "Decision Makers" section is not present until the button is clicked.
    const decisionMakersSection = jobPreview(page).getByText('Decision Makers', { exact: true });
    await expect(decisionMakersSection).toHaveCount(0);

    await jobPreview(page).getByRole('button', { name: 'Find Decision Makers' }).click();

    // Give the Decision Makers content a few seconds to load — don't read the
    // section instantly after clicking.
    await page.waitForTimeout(4000);

    // After clicking, the Decision Makers section renders inside the preview panel.
    await expect(decisionMakersSection).toBeVisible({ timeout: 30000 });
  });

  // ================================================================
  // Test Case 4 — Create Job by uploading a PDF
  // ================================================================
  test('Test Case 4: Create a job by uploading a job-description PDF', async () => {
    await openCreateJobModal(page);

    // "Choose File" opens the OS file picker; in Playwright we set the file
    // directly on the dialog's hidden <input type="file">.
    await createJobModal(page).locator('input[type="file"]').setInputFiles(JOB_PDF_PATH);

    // The PDF is parsed and the form is pre-filled — give it a few seconds to
    // process before moving on.
    await page.waitForTimeout(4000);

    // Advance from the upload step to the Create Job form.
    await createJobModal(page).getByRole('button', { name: 'Next' }).click();

    // Wait for the populated Create Job form (Job Title field) to render.
    await expect(createJobModal(page).getByPlaceholder('Enter job title')).toBeVisible({ timeout: 30000 });

    await submitCreateJobBtn(page).click();

    // Let the create request complete; success closes the dialog.
    await page.waitForTimeout(4000);
    await expect(createJobModal(page)).toBeHidden({ timeout: 30000 });
  });

  // ================================================================
  // Test Case 5 — Create Job manually (Enter Job Details Manually)
  // ================================================================
  test('Test Case 5: Create a job by entering details manually', async () => {
    await openCreateJobModal(page);

    // Switch from the upload step to the manual form.
    await createJobModal(page).getByRole('button', { name: 'Enter Job Details Manually' }).click();
    await expect(createJobModal(page).getByPlaceholder('Enter job title')).toBeVisible({ timeout: 20000 });

    await fillJobDetailsManually(page);

    await submitCreateJobBtn(page).click();

    // Let the create request complete; success closes the dialog.
    await page.waitForTimeout(4000);
    await expect(createJobModal(page)).toBeHidden({ timeout: 30000 });
  });
});
