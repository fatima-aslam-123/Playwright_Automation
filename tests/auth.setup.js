import { test as setup } from '@playwright/test';
import { login } from './utils/login';

const authFile = 'playwright/.auth/user.json';

setup('authenticate', async ({ page }) => {
  setup.setTimeout(120000);
  await login(page);
  await page.context().storageState({ path: authFile });
});
