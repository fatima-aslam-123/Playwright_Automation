# Recruitment Page Test Flow Skill

## Objective

While generating or updating Playwright test cases for the Recruitment page, always follow this strict execution pattern.

---

## Mandatory Rules

1. Perform login/sign-in **only once at the start of the first test case**.
2. Do NOT repeat login in any subsequent test cases.
3. After login, **stay on the same authenticated session for all tests**.
4. Do NOT reload or re-open the Recruitment page for every test case.
5. All test cases must run on the **same already opened Recruitment page session**.

---

## Test Execution Flow

### First Test Case Only:

* Perform login
* Navigate to Recruitment page (once)
* Apply filter or action
* Verify results appear
* Click "Clear All" (if applicable)
* Verify:

  * filters reset
  * results disappear or return to default state

---

### All Remaining Test Cases:

* Do NOT login again
* Do NOT reopen Recruitment page
* Continue on the same page/session
* Apply filter or action
* Verify results
* Click "Clear All" (if applicable)
* Verify reset state
* Proceed to next test

---

## Critical Behaviour Rules

* Keep browser session alive across all tests.
* Use `beforeAll` for login setup.
* Use `beforeEach` ONLY if required, but avoid page reloads.
* Avoid `page.goto()` repeatedly for Recruitment page.
* Ensure tests are session-aware, not page-restarting.
* Each test must assume user is already on Recruitment page (after first test).

---

## Expected Flow Summary

### Test 1:

* Login
* Open Recruitment page
* Run filter or action
* Verify results
* Clear All
* Verify reset

### Test 2 onwards:

* Directly operate on same page
* Run filter or action
* Verify results
* Clear All
* Verify reset

---

## Coding Guidelines

* Use async/await properly
* Use Playwright best practices
* Use stable locators:

  * `page.getByRole()`
  * `page.getByPlaceholder()`
  * `page.locator()`
* Avoid hardcoded waits (`waitForTimeout`)
* Prefer assertions after every step:

  * `expect(results).toBeVisible()`
* Create reusable login helper function

---

## Important Intent

The goal is:

👉 One login session

👉 One Recruitment page session

👉 Multiple test validations

👉 No unnecessary navigation or reloads

👉 Clean and fast execution flow
