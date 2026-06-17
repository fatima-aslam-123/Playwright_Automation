---
name: recruitment-functionalities-test-flow
description: Recruitment Page Functionalities Test Flow Skill
---

# Recruitment Page Functionalities Test Flow Skill

## Objective

While generating or updating Playwright tests for the **Recruitment page action
features** — currently **Clone Candidate → Save Clone** — always follow this
execution flow. These features act on a **candidate produced by an applied filter
search**, so a filter must always be applied first and results rendered, then the
clone action performed on a candidate card.

This skill complements the Recruitment filter suite (`tests/Recruitment.spec.js`).
Reuse its filter helpers to apply a filter; this skill covers what you do with the
**candidate results** afterwards.

---

## Mandatory Rules

1. Log in only **once** at the start of the session (storageState). Never
   re-login between tests.
2. Use **one shared authenticated page** for the whole suite (beforeAll), opened
   on `https://preprod.zenbee.io/search/recruitment`. Always use **Preprod**.
3. Every action feature requires an **applied filter first**: apply a filter
   (e.g. Title = "Chief Technology Officer") → wait for the results table → then
   act on a candidate.
4. The **Clone Candidate** action is **hover-revealed** on each candidate card —
   scope to the candidate row that contains the button, hover the row, then click.
5. Between tests, **re-navigate to `/search/recruitment`** and **Clear all**
   filters so the next test starts clean (a goto sidesteps any leftover clone
   state or an open dialog).

---

## Test Case — Clone Candidate then Save Clone

1. Apply a filter (e.g. Title = "Chief Technology Officer") → results table appears.
2. **Hover** the first candidate card → the **"Clone Candidate"** button appears.
3. Click **Clone Candidate**.
4. **Cloning takes a few seconds.** Wait for the **"Save this clone"** button to
   appear — that is the signal the clone is ready. Do **not** assert immediately.
5. Click **Save this clone** → the **"Save Candidate Clone"** dialog opens.
6. Type a **Clone Name** (the field requires **minimum 3 characters**; use a
   unique name per run to avoid collisions) and click **Save**.
7. **Wait 3 seconds** for the save to settle. The dialog closing confirms success.

---

## Modal / UI map (observed)

- **Results table** (`role=table`): candidate cards (name, experience, education,
  top skills). Each card exposes a hover-revealed **"Clone Candidate"** button at
  the top-right.
- **Clone in progress**: after Clone Candidate, the card shows **"Save this clone"**
  (plus "Cancel clone" / "Export Candidate") once the clone is built.
- **Save Candidate Clone** dialog (`role=dialog`): a **Clone Name** input
  (placeholder "Enter clone name (minimum 3 characters)") with **Cancel** / **Save**
  buttons.

---

## Coding Guidelines

- JavaScript + Playwright only. async/await, stable role-based locators
  (`getByRole`, `getByPlaceholder`, `getByText`).
- Reuse the Recruitment filter setters (`chooseTitle`, `applyAndExpectResults`,
  `clearAllIfPresent`) so the intent of each test stays readable.
- Scope the clone action to the candidate **row** that has the Clone Candidate
  button, and **hover before clicking** (the button is hidden until hover).
- Wait explicitly for slow steps: the clone build (wait for "Save this clone")
  and the save settle (`waitForTimeout(3000)`).
- Assert after every step (results visible, Save this clone visible, dialog
  visible, dialog hidden after save).
- Never delete test files. Keep test cases readable and well-named.

---

## Important Intent

👉 One login session · one Recruitment page (Preprod) · filter → hover candidate →
   Clone Candidate → wait → Save this clone → name + Save → wait 3s.
👉 Clone is hover-revealed; cloning is slow (wait for "Save this clone"); the
   Clone Name needs ≥3 characters; dialog closing = saved.
