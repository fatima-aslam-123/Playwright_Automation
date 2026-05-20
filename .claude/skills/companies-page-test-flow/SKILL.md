# Companies Page Test Flow Skill

## Objective
While generating or updating Playwright test cases for the Companies page, always follow this execution pattern.

## Mandatory Rules

1. Perform sign in/login only in the first test case.
2. Do NOT repeat login in remaining test cases.
3. Reuse the existing authenticated session for all next test cases.
4. After every filter test:
   - Run the search/filter.
   - Wait for results to appear.
   - Verify results are displayed.
   - Click the "Clear All" button.
   - Verify all applied filters and results disappear/reset.
5. Continue the same flow for all remaining test cases.
6. Avoid unnecessary page reloads.
7. Use Playwright best practices.
8. Prefer reusable functions and clean locators.
9. Keep tests independent but session-aware.
10. Use proper assertions after every action.

## Expected Flow

- First test:
  - Login
  - Open Companies page
  - Apply filter
  - Verify results
  - Click Clear All
  - Verify reset

- Remaining tests:
  - Directly open Companies page
  - Apply filter
  - Verify results
  - Click Clear All
  - Verify reset

## Example Expectations

- Results section should become visible after search.
- After clicking Clear All:
  - Filters should reset.
  - Search results should disappear or return to default state.

## Coding Guidelines

- Use async/await properly.
- Use stable selectors.
- Avoid hardcoded waits.
- Prefer:
  - page.getByRole()
  - page.getByPlaceholder()
  - page.locator()
- Use expect assertions.
- Keep reusable login helper separate.