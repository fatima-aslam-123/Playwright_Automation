export async function login(page) {

  await page.goto('https://qa.zenbee.io/sign-in', {
    waitUntil: 'domcontentloaded'
  });

  // enter email
  await page.fill("//input[@id='emailAddress']", 'faslam+223@croyten.com');

  // enter password
  await page.fill("input[placeholder='Password']", 'Lahore@123');

  // click login button
  await page.getByRole('button', { name: 'Login' }).click();

  // wait for dashboard/company page
  await page.waitForURL('https://qa.zenbee.io/search/companies');

}