import { test, expect } from '@playwright/test';

test('User should signup successfully', async ({ page }) => {

  // open signup page
  await page.goto('https://qa.zenbee.io/register', {
    waitUntil: 'domcontentloaded'
  });

  // Step 1

  await page.fill('#fullName', 'Fatima Aslam');

 await page.fill('#emailAddress', 'faslam+230@croyten.com');

 await page.fill('#companyName', 'Croyten');

 await page.fill('#domainName', 'croyten.com');

await page.fill('#phoneNumber', '12312341234');
  // upload image
import path from 'path';

const filePath = path.resolve('tests/assets/profilepic.jpeg');

await page.setInputFiles('#profilePhoto', filePath);

  // checkbox
await page.check('#remember_me');

  // next button
  await page.getByRole('button', { name: 'Next' }).click();

  // Step 2

await page.fill('#role', 'QA');

const dropdown = page.locator('#numberOfEmployees');
await dropdown.click();

// select option
await page.locator("//li[normalize-space()='1-10']").click();

const workPhone = page.locator('#workPhone');

await workPhone.click();

await workPhone.pressSequentially('1234567890');

await page.locator('#department').click();

await page.locator("//li[normalize-space()='Engineering']").click();
// password
await page.fill("p-password[formcontrolname='password'] input[type='password']", 'Lahore@123');

// confirm password
await page.fill("p-password[formcontrolname='confirmPassword'] input[type='password']", 'Lahore@123');

// Sign Up button
await page.click("//button[normalize-space()='Sign Up']");

});