# Jobs Page Functionalities Test Flow Skill

## Objective

While generating or updating Playwright tests for the **Jobs page action
features** — *Save Job*, *Find Candidates*, and *Find Decision Makers* — always
follow this execution flow. These features act on a **job opened from the
results of an applied filter**, so a filter must always be applied first, then a
job preview opened.

This skill complements `companies-page-test-flow` style filter handling (the
left-hand filter panel on the Jobs page). Reuse the Jobs filter helpers in
`tests/Jobs.spec.js` to apply filters; this skill covers what you do with the
**opened job preview** afterwards.

---

## Mandatory Rules

1. Log in only **once** at the start of the session (storageState). Never
   re-login between tests.
2. Use **one shared authenticated page** for the whole suite (beforeAll), opened
   on `https://preprod.zenbee.io/search/jobs`. Always use **Preprod**.
3. Every action feature requires an **applied filter first**: apply a filter →
   wait for the results table (rows render skeletons first, wait for real data)
   → then open a job preview.
4. **Open the Job Preview** by clicking the **job title** in the results table
   (the title is a clickable `span`, not a link). This opens the
   `app-job-preview-modal` — a PrimeNG modal pinned **top-right** with an overlay
   mask. The action buttons (*Find Candidates*, *Find Decision Makers*,
   *Save Job*) live **inside this modal** — scope locators to it.
5. Between tests, **close the preview modal** (its close button has
   `aria-label="Close"`) and **Clear all** filters so the next test starts clean.
   *Find Candidates* navigates away, so afterEach must also return to
   `/search/jobs` when the URL is no longer on the Jobs page.

---

## Test Case 1 — Save Job

1. Apply any filter (e.g. Job title = "Marketing Manager") → results table appears.
2. Click a job title → Job Preview modal opens.
3. Click **Save Job**.
4. Verify success via the toast notification **"Job saved successfully"**
   (`.p-toast-message`). The button itself stays labelled "Save Job" (it does not
   relabel to "Saved").

> Note: once a job is saved in a preview, the **Find Decision Makers** button
> disappears from that same preview. Keep each action in its own test on a
> freshly-opened preview.

---

## Test Case 2 — Find Candidates (redirect to Recruitment)

1. Apply a filter → open a job preview.
2. Click **Find Candidates**.
3. The app **navigates in the same tab** to the **Recruitment page**
   (`/search/recruitment`), pre-filled with the job's titles (and experience
   keywords) in the URL query string.
4. **The navigation is slow** (~30–40s on preprod) — wait for the URL with a
   generous timeout (`page.waitForURL(/\/search\/recruitment/, { timeout: 90000 })`).
   Do **not** assert immediately after the click.

---

## Test Case 3 — Find Decision Makers (section in preview panel)

1. Apply a filter → open a job preview.
2. Before clicking, the **"Decision Makers"** section is **not** present
   (assert count 0) — clicking the button is what reveals it.
3. Click **Find Decision Makers**.
4. Verify the **Decision Makers** section now renders **inside the preview
   panel** (no navigation). The section header is an exact-text `Decision Makers`
   paragraph; a "See all contacts" link and either decision-maker rows or a
   "No Decision Maker found." message appear under it.

---

## Modal map (observed UI)

- **Results table** (`role=table`): columns JOB TITLE / COMPANY NAME / INDUSTRY /
  LOCATION / PUBLISHED ON / EMPLOYMENT TYPE / WORK TYPE. Job title is a clickable
  `span.cursor-pointer`.
- **Job Preview** (`app-job-preview-modal`, top-right, overlay mask): heading job
  title, company/location/job-type details, action buttons *Find Candidates* /
  *Find Decision Makers* / *Save Job*, *Read more* (job + company), *See job
  details*, a *Close* button (`aria-label="Close"`), and an *About the Job* /
  *Decision Makers* / *Company Details* body.

---

## Coding Guidelines

- JavaScript + Playwright only. async/await, stable role-based locators
  (`getByRole`, `getByPlaceholder`, `getByText`).
- Reuse the Jobs filter setters (`setJobTitle`, `applyAndExpectResults`,
  `clearAllIfPresent`) so the intent of each test stays readable.
- Scope action locators to the open `app-job-preview-modal` so you don't match
  background page elements.
- Wait explicitly for slow steps: skeletons clearing before reading a job title,
  and the slow Find Candidates navigation before asserting the URL.
- Assert after every step (modal visible, toast shown, section visible, URL).
- Never delete test files. Keep test cases readable and well-named.

---

## Important Intent

👉 One login session · one Jobs page (Preprod) · filter → open preview → action.
👉 Save Job = success toast. Find Candidates = slow redirect to /search/recruitment.
   Find Decision Makers = section appears inside the preview panel.
👉 Each action in its own test on a freshly-opened preview; close the modal and
   Clear all between tests.
