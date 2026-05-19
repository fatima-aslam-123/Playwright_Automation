import { test, expect } from '@playwright/test';

test('User should login successfully', async ({ page }) => {
  await page.goto('https://qa.zenbee.io/sign-in');
  waitUntil: 'domcontentloaded'

  // enter email
  await page.fill("//input[@id='emailAddress']", 'faslam+223@croyten.com');

  // enter password
  await page.fill("input[placeholder='Password']", 'Lahore@123');

 await page.getByRole('button', { name: 'Login' }).click();
 waitUntil: 'domcontentloaded'

await expect(page).toHaveURL('https://qa.zenbee.io/search/companies');
 waitUntil: 'domcontentloaded'
});