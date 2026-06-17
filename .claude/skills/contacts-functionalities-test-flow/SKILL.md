# Contacts Page Functionalities Test Flow Skill

## Objective

While generating or updating Playwright tests for the **Contacts page action
features** — *Save to List*, *Personalized Email → Export*, and *Personalized
Email → Send* — always follow this execution flow. These features act on the
**results of an applied filter**, so a filter must always be applied first.

This skill complements `contacts-page-test-flow` (which covers the left-hand
filter panel). Reuse that skill's filter helpers to apply filters; this skill
covers what you do with the **selected results** afterwards.

---

## Mandatory Rules

1. Log in only **once** at the start of the session (storageState). Never
   re-login between tests.
2. Use **one shared authenticated page** for the whole suite (beforeAll). Do not
   `page.goto()` the Contacts page again per test — clear filters/selection
   instead.
3. Every action feature requires an **applied filter first**: apply a filter →
   wait for the results table → then select contacts.
4. The **"Create personalized email" button is disabled until a filter is
   applied** (and contacts are selected). Apply the filter before expecting it
   enabled.
5. **Filter choice:**
   - *Save to List* and *Personalized Email → Export*: use **any** filter
     (e.g. a Title filter).
   - *Personalized Email → Send*: use the **Current Company = "Croyten"** filter
     ONLY, because the send test targets the real contacts **Fatima Aslam**,
     **Asad Mahmood**, **Julius John**.
6. Between tests, **Clear selection** and **Clear all** filters so the next test
   starts clean (no reload).

---

## Feature 1 — Save to List

1. Apply any filter → results table appears.
2. Open **Advanced Selection** and select **two pages** of results (advanced
   selection lets you select beyond the current page).
3. Click **Save to list**.
4. Enter a **list name** of your choice.
5. **Save** the list and confirm a success state (list saved / appears under the
   "Saved list" filter section).

---

## Feature 2 — Personalized Email → Export

Apply any filter first so **Create personalized email** enables.
Click **Create personalized email → Personalize to export**, then for EACH of the
three generation methods run the full sub-flow:

**Common steps each round:** select some contacts → Create personalized email →
Personalize to export → **Choose Sender Profile** (select a profile → Save &
Continue) → **Choose method** → generate → **Export** the contacts with the
generated emails.

1. **System Generated email**
   - Method modal → choose **System Generated** → Continue.
   - Wait for the AI (Zenbot) to generate the email(s).
   - **Export** the contacts together with their generated emails.

2. **Template email**
   - Select contacts again → export flow → method modal → choose **Templates** →
     Continue.
   - In **Select a Saved Template**, pick an existing template.
   - **If no template exists, create one first**, then generate from it.
   - Generate the emails → **Export**.

3. **Custom Prompt email**
   - Select contacts again → export flow → method modal → choose **Custom
     Prompt** → Continue.
   - In the **Zenbot** modal, **write a prompt** and click **Create** to generate.
   - Generate the emails → **Export**.

---

## Feature 3 — Personalized Email → Send

Before this feature, apply the **Current Company = "Croyten"** filter so the
results contain the target contacts.

1. Apply Current Company = **Croyten** → results appear.
2. Find and select: **Fatima Aslam**, **Asad Mahmood**, **Julius John**.
3. Click **Create personalized email → Personalize to send**.
4. **Choose Sender Profile** → select a profile → Save & Continue.
5. Run all three generation methods, **sending** each time:
   - **System Generated** → generate emails → click **Send**.
   - Re-select the three contacts → **Templates** → pick a template (create one
     if none) → generate → **Send**.
   - Re-select the three contacts → **Custom Prompt** → write a prompt → Create →
     generate → **Send**.

---

## Modal map (observed UI)

- **Create personalized email** (toolbar button, dropdown): *Personalize to
  export* / *Personalize to send*.
- **Choose Sender Profile**: a *Choose Profile* select (e.g. "Fatima | QA"),
  buttons *Back / Cancel / Save & Continue*.
- **Choose one of the following methods**: radios *Templates* / *Custom Prompt* /
  *System Generated*, button *Continue*.
- **Select a Saved Template**: search box + saved templates list (e.g. "Feedback
  Request").
- **Zenbot** (custom prompt): prompt textarea ("Start typing…"), example prompts,
  button *Create*.
- **Save to list**: list-name input + Save.
- **Advanced Selection**: select current page / select multiple pages.

---

## Coding Guidelines

- async/await, Playwright best practices, stable role-based locators
  (`getByRole`, `getByPlaceholder`, `getByText`).
- Reuse the filter setters from the contacts filter suite to apply filters.
- Scope locators to the open `dialog` (`page.getByRole('dialog')`) when a modal
  is up, to avoid matching background page elements.
- Wait for AI generation explicitly (it is slow) before asserting/Export/Send.
- Assert after every step (modal visible, generated content present, success
  toast/state).
- Never delete test files. Keep test cases readable and well-named.

---

## Important Intent

👉 One login session · one Contacts page · filter → select → action.
👉 Croyten filter only for the **Send** feature.
👉 Cover all three generation methods (System Generated, Template, Custom Prompt)
   for both Export and Send.
👉 Create a template on the fly if none exists.
