---
name: companies-functionalities-test-flow
description: Companies Page Functionalities Test Flow Skill
---

# Companies Page Functionalities Test Flow Skill

## Objective

While generating or updating Playwright tests for the **Companies page action
features** — currently **Export Selected → Export to CSV / HubSpot / Salesforce** —
always follow this execution flow. These features act on **company records produced
by an applied filter search**, so a filter must always be applied first and results
rendered, then the export action performed on the selected rows.

This skill complements the Companies filter suite (`tests/companies.spec.js`).
Reuse its filter helpers to apply a filter; this skill covers what you do with the
**company results** afterwards (`tests/companies-page-functionalities.spec.js`).

---

## Mandatory Rules

1. Log in only **once** at the start of the session (storageState). Never
   re-login between tests.
2. Use **one shared authenticated page** for the whole suite (beforeAll), opened
   on `https://preprod.zenbee.io/search/companies`. Always use **Preprod**.
3. Every action feature requires an **applied filter first**: apply a filter
   (e.g. Industry = "Technology Companies" or a HeadCount range) → wait for the
   results table → then select rows and export.
4. Select companies by ticking each **row checkbox** (the "Select all" control is
   in the toolbar, not a row). Assert at least one row was selected.
5. Between tests, **re-navigate to `/search/companies`** and **Clear all** filters
   so the next test starts clean (a goto sidesteps any leftover export dialog or
   selection).

---

## Test Cases — Export Selected to a destination

Each destination (CSV / HubSpot / Salesforce) follows the identical shape:

1. Apply a filter (e.g. Industry = "Technology Companies") → results table appears.
2. Select one or more company rows (tick their row checkboxes).
3. Click **Export Selected** → the **export dropdown** is displayed.
4. Click the destination item — **Export to CSV** / **Export to HubSpot** /
   **Export to Salesforce**.
5. The **confirmation popup** appears → click **Yes**.
6. The popup closing confirms the export was accepted.

---

## Export quirks (observed — these bite if ignored)

- **"Export Selected"** sits at the **far-right edge of a horizontally scrollable**
  results toolbar. Nudge the nearest scrollable ancestor fully right (or call
  `scrollIntoViewIfNeeded()`) before clicking or the click won't land.
- The dropdown's destination item is a **PrimeNG button that animates in and
  detaches/re-mounts**, so a normal `.click()` fails the stability check and hangs.
  Fix: `waitForTimeout(500)` to let it settle, then `click({ force: true })` with a
  `dispatchEvent('click')` fallback.
- Some builds surface an **export-options popup** (with its own "Export" button)
  before the confirmation. Click that inner **Export** only when present
  (`isVisible` guard), so all three destinations converge on the **Yes** confirmation.
- The **confirmation popup** ("Are you sure...?" / token-usage confirmation) →
  **Yes**. Assert the Yes button goes hidden afterwards = export accepted.
- CSV, HubSpot and Salesforce share the **same** toolbar button, dropdown, popup
  and confirmation — only the dropdown item label differs. Route them through one
  `exportSelectedTo(page, destinationRe)` helper with thin named wrappers.

---

## Coding Guidelines

- JavaScript + Playwright only. async/await, stable role-based locators
  (`getByRole`, `getByText`, `getByPlaceholder`).
- Reuse the Companies filter setters (`expandSection`, `applyAndExpectResults`,
  `clearAllIfPresent`, `selectIndustry`, `setHeadCount`) so the intent of each
  test stays readable.
- Assert after every step (results visible, ≥1 row selected, dropdown item
  visible, confirmation popup hidden after Yes).
- Never delete test files. Keep test cases readable and well-named.

---

## Important Intent

👉 One login session · one Companies page (Preprod) · filter → select rows →
   Export Selected → choose destination → confirm (Yes).
👉 Export Selected is far-right on a horizontally scrollable toolbar; the dropdown
   item animates (force-click + dispatch fallback); the confirmation popup closing
   = export accepted. CSV / HubSpot / Salesforce differ only by the item label.
