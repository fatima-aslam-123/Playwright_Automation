import { chromium } from '@playwright/test';

const browser = await chromium.launch();
const context = await browser.newContext({ storageState: 'playwright/.auth/user.json' });
const page = await context.newPage();
await page.goto('https://qa.zenbee.io/search/companies', { waitUntil: 'domcontentloaded' });
const applyBtn = page.getByRole('button', { name: 'Apply Filters' });
await applyBtn.waitFor({ timeout: 30000 });
await page.waitForTimeout(1500);
const clearAll = page.getByRole('button', { name: /^Clear all$/i });

async function expand(name) {
  const btn = page.getByRole('button', { name }).first();
  if ((await btn.getAttribute('aria-expanded')) !== 'true') { await btn.scrollIntoViewIfNeeded(); await btn.click(); }
  await page.waitForTimeout(1000);
}

// LOCATION tree chip text
await expand('Location');
await page.getByPlaceholder('Search Locations').fill('United States');
await page.waitForTimeout(1200);
await page.getByRole('treeitem', { name: /united states/i }).first().locator('.p-tree-node-content').first().click();
await page.waitForTimeout(600);
await applyBtn.click();
await page.getByRole('table').waitFor({ timeout: 30000 });
console.log('LOC TREE rows:', await page.getByRole('table').getByRole('row').count());
const lines = (await page.locator('body').innerText()).split('\n').map(s=>s.trim()).filter(Boolean);
console.log('chip lines:', lines.filter(l=>/location/i.test(l)).slice(0,6));
if (await clearAll.isVisible().catch(()=>false)) { await clearAll.click(); await page.waitForTimeout(800); }

// MANUAL LOCATION proper autocomplete
await expand('Location');
await page.getByText(/Or Enter Location Manually/i).first().click();
await page.waitForTimeout(800);
const combo = page.getByPlaceholder('Enter city, state, or country');
await combo.click();
await combo.pressSequentially('New York', { delay: 120 });
// wait until a non-empty option shows up
let chosen = false;
for (let t=0; t<20; t++) {
  await page.waitForTimeout(500);
  const opts = page.getByRole('option');
  const c = await opts.count();
  let texts = [];
  for (let i=0;i<c;i++) texts.push((await opts.nth(i).textContent()||'').trim());
  const nonEmpty = texts.find(x=>x.length>0);
  if (nonEmpty) {
    console.log('attempt',t,'options:', JSON.stringify(texts.slice(0,5)));
    await page.getByRole('option').filter({ hasText: /new york/i }).first().click();
    chosen = true;
    break;
  }
}
console.log('chosen:', chosen);
await page.waitForTimeout(600);
console.log('Apply enabled (manual)?', await applyBtn.isEnabled());
if (await applyBtn.isEnabled()) {
  await applyBtn.click();
  await page.getByRole('table').waitFor({ timeout: 30000 });
  console.log('MANUAL rows:', await page.getByRole('table').getByRole('row').count());
  const l2 = (await page.locator('body').innerText()).split('\n').map(s=>s.trim()).filter(Boolean);
  console.log('manual chip lines:', l2.filter(l=>/location|new york/i.test(l)).slice(0,6));
}
await browser.close();

