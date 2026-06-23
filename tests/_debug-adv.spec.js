import { test, expect } from '@playwright/test';

test('probe advanced selection panel', async ({ browser }) => {
  test.setTimeout(120000);
  const context = await browser.newContext({ storageState: 'playwright/.auth/user.json' });
  const page = await context.newPage();
  await page.goto('https://preprod.zenbee.io/search/companies', { waitUntil: 'domcontentloaded', timeout: 120000 });
  await expect(page.getByRole('button', { name: 'Apply Filters' })).toBeVisible({ timeout: 120000 });
  await page.getByText(/prepare your search interface/i).waitFor({ state: 'hidden', timeout: 60000 }).catch(() => {});

  const industryAcc = page.getByRole('button', { name: 'Industry' });
  if ((await industryAcc.getAttribute('aria-expanded')) !== 'true') await industryAcc.click();
  const node = page.getByRole('treeitem', { name: 'Technology Companies' }).first();
  await node.scrollIntoViewIfNeeded();
  await node.locator('.p-tree-node-content').first().click();
  await page.getByRole('button', { name: 'Apply Filters' }).click();
  await expect(page.getByRole('table')).toBeVisible({ timeout: 30000 });
  await page.locator('table p-skeleton').first().waitFor({ state: 'hidden', timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1500);

  await page.getByRole('button', { name: /Advanced Selection/i }).click();
  await page.waitForTimeout(1500);

  const info = await page.evaluate(() => {
    const out = {};
    // Smallest ancestor of the Apply Selection button that also contains "Start Page".
    const applyBtn = Array.from(document.querySelectorAll('button')).find((b) => /Apply Selection/i.test(b.textContent || ''));
    let panel = applyBtn;
    while (panel && !/Start Page/i.test(panel.textContent || '')) panel = panel.parentElement;
    out.panelRole = panel ? panel.getAttribute('role') : null;
    out.panelClass = panel ? panel.className : null;
    out.panelHTML = panel ? panel.outerHTML.replace(/\s+/g, ' ').slice(0, 1500) : null;
    // every input/spinbutton inside that panel + its placeholder
    out.panelInputs = panel
      ? Array.from(panel.querySelectorAll('input')).map((i) => ({ type: i.type, role: i.getAttribute('role'), ph: i.placeholder }))
      : null;
    out.dialogs = document.querySelectorAll('[role="dialog"]').length;
    // PrimeNG overlays
    const overlays = Array.from(document.querySelectorAll('.p-overlaypanel, .p-dialog, .p-popover, [class*="overlay"], [class*="popover"]'))
      .filter((e) => e.offsetParent !== null);
    out.overlayClasses = overlays.map((e) => e.className).slice(0, 6);
    out.spinbuttons = document.querySelectorAll('input[type="number"], [role="spinbutton"]').length;
    // find element with "Start"/"End"/"page" text
    const all = Array.from(document.querySelectorAll('body *'));
    const labels = all
      .filter((e) => e.children.length === 0 && /start|end|page|select/i.test(e.textContent || ''))
      .map((e) => (e.textContent || '').trim())
      .filter((t) => t.length < 40)
      .slice(0, 15);
    out.labels = [...new Set(labels)];
    out.applyButtons = Array.from(document.querySelectorAll('button'))
      .map((b) => (b.textContent || '').trim())
      .filter((t) => /apply|select/i.test(t))
      .slice(0, 10);
    return out;
  });
  console.log('PROBE_ADV', JSON.stringify(info, null, 2));
  await context.close();
});
