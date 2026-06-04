# Chatbot Prompt Testing Skill

## Objective

While testing the Chatbot on any page (Contacts, Companies, Jobs, Recruitment, or any other supported page), always follow this execution flow.

---

## Mandatory Rules

1. Log in to the application only once at the beginning of the test session.
2. Do NOT perform login again for subsequent prompt tests.
3. Navigate to the Chatbot and keep using the same authenticated session.
4. Enter the provided prompt in the chatbot input field.
5. Click the Send button.
6. Wait until the chatbot response is fully generated and displayed.
7. Validate the response against the expected result.
8. Click the "Clear All" button to reset the conversation.
9. Wait for a fresh chatbot screen to appear.
10. Enter the next prompt and repeat the same process.
11. Continue testing all prompts using the same session until all test cases are completed.

---

## Test Execution Pattern

* Login once.
* Enter prompt.
* Click Send.
* Wait for response.
* Validate result.
* Click Clear All.
* Wait for empty chatbot screen.
* Enter next prompt.
* Repeat until all prompts are tested.

---

## Important Notes

* Never re-login between prompt tests.
* Always clear the previous conversation before testing a new prompt.
* Ensure the chatbot is ready before entering the next prompt.
* Follow the same workflow for Contacts, Companies, Jobs, Recruitment, and any future chatbot-supported pages.
