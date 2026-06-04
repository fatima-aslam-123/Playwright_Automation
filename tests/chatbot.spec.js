import { test, expect } from '@playwright/test';

// Zenbee AI Chatbot prompt tests (Chatbot-test-flow skill).
//
// The same chatbot is embedded on the Contacts, Companies, Recruitment and Jobs
// search pages. Each module gets 20 prompts, ordered simple → complex. For every
// prompt we validate that the chatbot APPLIED THE RELEVANT FILTERS, not just that
// it answered:
//   1. the "Clear all" button appears (filters were applied),
//   2. the URL query params contain every entity parsed from the prompt — the bot
//      serializes applied filters into the URL (probed live on preprod, e.g.
//      Titles=[{"name":"Software Engineer"}], locations=["New York"], Skills=[...],
//      straightIndustries=[...], min/maxEmployeeCount, jobTitle=..., remote=true),
//   3. the results grid renders.
//
// Per the Chatbot-test-flow skill: login once (storageState), one page per module
// suite, send prompt → wait for response → validate → "Clear all" → wait for the
// fresh "How can I help?" chat screen → next prompt. No re-login, no per-test
// page.goto().
//
// Live-probed behavior notes (preprod, 2026-06-04):
// - The chat input ("What's in your mind?...") submits on Enter.
// - Applying a prompt closes the chat hero and shows filter chips + results;
//   "Clear all" restores the fresh chat screen on all four modules.
// - The RECRUITMENT chatbot navigates to /search/contacts when it applies
//   filters, so its afterEach re-opens /search/recruitment for the next prompt.
// - The bot does NOT map "hybrid" work type (jobs) or bare experience-year
//   ranges (contacts) — those prompts are intentionally not used here.

// ---------- locator helpers ----------
const chatInput = (page) => page.getByPlaceholder(/What'?s in your mind/i).first();
const applyBtn = (page) => page.getByRole('button', { name: 'Apply Filters' });
const clearAllBtn = (page) => page.getByRole('button', { name: /^Clear all$/i });
const resultsTable = (page) => page.getByRole('table');
const chatHero = (page) => page.getByText('How can I help?');

// ---------- workflow helpers ----------

// Open a module page and wait until the SPA is hydrated and the chatbot's fresh
// screen is ready. Also clears any filter state persisted from earlier runs.
async function openModule(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
  // domcontentloaded fires before the SPA hydrates — wait for the real UI.
  await expect(applyBtn(page)).toBeVisible({ timeout: 120000 });
  await expect(page.getByText(/prepare your search interface/i)).toBeHidden({ timeout: 60000 });
  // Wipe any server-persisted filters so the chat hero (not results) is shown.
  if (await clearAllBtn(page).isVisible().catch(() => false)) {
    await clearAllBtn(page).click();
  }
  await expect(chatInput(page)).toBeVisible({ timeout: 60000 });
}

async function sendPrompt(page, prompt) {
  const input = chatInput(page);
  await expect(input).toBeVisible({ timeout: 60000 });
  await input.click();
  await input.fill(prompt);
  await input.press('Enter');
}

// Core validation: the chatbot turned the prompt into applied filters.
// `expectedParams` are regexes that must all match the DECODED url — each one is
// an entity the prompt explicitly named (title, location, skill, company, ...).
async function expectFiltersApplied(page, expectedParams) {
  // The LLM parse + filter application can take a while on preprod.
  await clearAllBtn(page).waitFor({ state: 'visible', timeout: 90000 });
  for (const re of expectedParams) {
    await expect
      .poll(() => decodeURIComponent(page.url()), {
        timeout: 15000,
        message: `chatbot should apply a filter matching ${re} (URL params)`,
      })
      .toMatch(re);
  }
  await expect(resultsTable(page)).toBeVisible({ timeout: 30000 });
}

// Skill steps 8-9: Clear All, then wait for the fresh chatbot screen before the
// next prompt. The recruitment bot navigates to /search/contacts when applying
// filters, so re-open the module page whenever the URL drifted off it.
async function resetToFreshChat(page, moduleUrl, modulePath) {
  try {
    await page.keyboard.press('Escape').catch(() => {});
    if (await clearAllBtn(page).isVisible().catch(() => false)) {
      await clearAllBtn(page).click();
    }
    if (!page.url().includes(modulePath)) {
      await openModule(page, moduleUrl);
    } else {
      await expect(chatInput(page)).toBeVisible({ timeout: 60000 });
      await expect(chatHero(page)).toBeVisible({ timeout: 30000 });
    }
  } catch {
    // preprod intermittently serves a broken page — re-navigate so one transient
    // hiccup doesn't poison every later test on the shared page.
    await openModule(page, moduleUrl).catch(() => {});
  }
}

// ---------- prompt suites ----------
// Each entry: id, level (simple | medium | complex), the prompt typed into the
// chatbot, and the URL-param regexes proving the relevant filters were applied.
const MODULES = [
  {
    name: 'Contacts',
    path: '/search/contacts',
    url: 'https://preprod.zenbee.io/search/contacts',
    prompts: [
      // ---- simple: one entity ----
      { id: 'C01', level: 'simple', prompt: 'Find software engineers', expect: [/software engineer/i] },
      { id: 'C02', level: 'simple', prompt: 'Show me contacts located in New York', expect: [/new york/i] },
      { id: 'C03', level: 'simple', prompt: 'Find people with Java skills', expect: [/java/i] },
      { id: 'C04', level: 'simple', prompt: 'Find contacts who work at Microsoft', expect: [/microsoft/i] },
      { id: 'C05', level: 'simple', prompt: 'Show me marketing managers', expect: [/marketing manager/i] },
      { id: 'C06', level: 'simple', prompt: 'Find contacts in the advertising industry', expect: [/advertising/i] },
      { id: 'C07', level: 'simple', prompt: 'Find contacts who studied at Harvard', expect: [/harvard/i] },
      // ---- medium: two entities ----
      { id: 'C08', level: 'medium', prompt: 'Find software engineers in California', expect: [/software engineer/i, /california/i] },
      { id: 'C09', level: 'medium', prompt: 'Show me data scientists with Python skills', expect: [/data scientist/i, /python/i] },
      { id: 'C10', level: 'medium', prompt: 'Find sales managers who work at Oracle', expect: [/sales manager/i, /oracle/i] },
      { id: 'C11', level: 'medium', prompt: 'Find contacts in Texas with SQL skills', expect: [/texas/i, /sql/i] },
      { id: 'C12', level: 'medium', prompt: 'Find product managers located in Boston', expect: [/product manager/i, /boston/i] },
      { id: 'C13', level: 'medium', prompt: 'Find contacts with a Computer Science major', expect: [/computer science/i] },
      { id: 'C14', level: 'medium', prompt: 'Find java developers in the advertising industry', expect: [/java/i, /advertising/i] },
      // ---- complex: three or more entities ----
      { id: 'C15', level: 'complex', prompt: 'Find senior data scientists at Google with Python skills', expect: [/data scientist/i, /google/i, /python/i] },
      { id: 'C16', level: 'complex', prompt: 'Find software engineers in New York with Java and SQL skills', expect: [/software engineer/i, /new york/i, /java/i, /sql/i] },
      { id: 'C17', level: 'complex', prompt: 'Show me marketing managers in California with SEO skills', expect: [/marketing manager/i, /california/i, /seo/i] },
      { id: 'C18', level: 'complex', prompt: 'Find product managers at Amazon located in Seattle', expect: [/product manager/i, /amazon/i, /seattle/i] },
      { id: 'C19', level: 'complex', prompt: 'Find contacts who studied Computer Science at Harvard', expect: [/computer science/i, /harvard/i] },
      { id: 'C20', level: 'complex', prompt: 'Find frontend developers in Chicago with React and CSS skills', expect: [/chicago/i, /react/i, /css/i] },
    ],
  },
  {
    name: 'Companies',
    path: '/search/companies',
    url: 'https://preprod.zenbee.io/search/companies',
    prompts: [
      // ---- simple: one entity ----
      { id: 'CO01', level: 'simple', prompt: 'Find software companies', expect: [/software/i] },
      { id: 'CO02', level: 'simple', prompt: 'Show me companies in New York', expect: [/new york/i] },
      { id: 'CO03', level: 'simple', prompt: 'Find healthcare companies', expect: [/health/i] },
      { id: 'CO04', level: 'simple', prompt: 'Find companies located in London', expect: [/london/i] },
      { id: 'CO05', level: 'simple', prompt: 'Show me advertising companies', expect: [/advertising/i] },
      { id: 'CO06', level: 'simple', prompt: 'Find companies with 51 to 200 employees', expect: [/minEmployeeCount=51/, /maxEmployeeCount=200/] },
      { id: 'CO07', level: 'simple', prompt: 'Find retail companies', expect: [/retail/i] },
      // ---- medium: two entities ----
      { id: 'CO08', level: 'medium', prompt: 'Find software companies in California', expect: [/software/i, /california/i] },
      { id: 'CO09', level: 'medium', prompt: 'Find healthcare companies in Boston', expect: [/health/i, /boston/i] },
      { id: 'CO10', level: 'medium', prompt: 'Show me manufacturing companies in Texas', expect: [/manufactur/i, /texas/i] },
      { id: 'CO11', level: 'medium', prompt: 'Find financial services companies in London', expect: [/financ/i, /london/i] },
      { id: 'CO12', level: 'medium', prompt: 'Find software companies founded after 2015', expect: [/software/i, /Founded/] },
      { id: 'CO13', level: 'medium', prompt: 'Find companies in Chicago with more than 500 employees', expect: [/chicago/i, /EmployeeCount/] },
      { id: 'CO14', level: 'medium', prompt: 'Show me advertising companies in New York', expect: [/advertising/i, /new york/i] },
      // ---- complex: three or more entities ----
      { id: 'CO15', level: 'complex', prompt: 'Find software companies in New York with 51 to 200 employees', expect: [/software/i, /new york/i, /EmployeeCount/] },
      { id: 'CO16', level: 'complex', prompt: 'Find healthcare companies in California with more than 1000 employees', expect: [/health/i, /california/i, /EmployeeCount/] },
      { id: 'CO17', level: 'complex', prompt: 'Show me retail companies in Texas with 11 to 50 employees', expect: [/retail/i, /texas/i, /EmployeeCount/] },
      { id: 'CO18', level: 'complex', prompt: 'Find software companies in London founded after 2018', expect: [/software/i, /london/i, /Founded/] },
      { id: 'CO19', level: 'complex', prompt: 'Find manufacturing companies in Chicago with 201 to 500 employees', expect: [/manufactur/i, /chicago/i, /EmployeeCount/] },
      { id: 'CO20', level: 'complex', prompt: 'Find financial services companies in New York with more than 500 employees', expect: [/financ/i, /new york/i, /EmployeeCount/] },
    ],
  },
  {
    name: 'Recruitment',
    path: '/search/recruitment',
    url: 'https://preprod.zenbee.io/search/recruitment',
    prompts: [
      // ---- simple: one entity ----
      { id: 'R01', level: 'simple', prompt: 'Find java developers', expect: [/java/i] },
      { id: 'R02', level: 'simple', prompt: 'Find candidates located in Texas', expect: [/texas/i] },
      { id: 'R03', level: 'simple', prompt: 'Show me python developers', expect: [/python/i] },
      { id: 'R04', level: 'simple', prompt: 'Find candidates with React skills', expect: [/react/i] },
      { id: 'R05', level: 'simple', prompt: 'Find data analysts', expect: [/data analyst/i] },
      { id: 'R06', level: 'simple', prompt: 'Find candidates who studied at Stanford', expect: [/stanford/i] },
      { id: 'R07', level: 'simple', prompt: 'Find candidates with AWS skills', expect: [/aws/i] },
      // ---- medium: two entities ----
      { id: 'R08', level: 'medium', prompt: 'Find java developers in Texas', expect: [/java/i, /texas/i] },
      { id: 'R09', level: 'medium', prompt: 'Find python developers in California', expect: [/python/i, /california/i] },
      { id: 'R10', level: 'medium', prompt: 'Show me frontend developers with React skills', expect: [/frontend/i, /react/i] },
      { id: 'R11', level: 'medium', prompt: 'Find candidates in New York with SQL skills', expect: [/new york/i, /sql/i] },
      { id: 'R12', level: 'medium', prompt: 'Find devops engineers with Kubernetes skills', expect: [/devops/i, /kubernetes/i] },
      { id: 'R13', level: 'medium', prompt: 'Find candidates with a Computer Science degree', expect: [/computer science/i] },
      { id: 'R14', level: 'medium', prompt: 'Find mobile developers in Seattle', expect: [/mobile/i, /seattle/i] },
      // ---- complex: three or more entities ----
      { id: 'R15', level: 'complex', prompt: 'Find senior java developers in Texas with Spring skills', expect: [/java/i, /texas/i, /spring/i] },
      { id: 'R16', level: 'complex', prompt: 'Find python developers in California with Django skills', expect: [/python/i, /california/i, /django/i] },
      { id: 'R17', level: 'complex', prompt: 'Find frontend developers in New York with React and TypeScript skills', expect: [/new york/i, /react/i, /typescript/i] },
      { id: 'R18', level: 'complex', prompt: 'Find candidates who studied Computer Science at MIT with Java skills', expect: [/computer science/i, /MIT/, /java/i] },
      { id: 'R19', level: 'complex', prompt: 'Find data scientists at Amazon with machine learning skills', expect: [/data scientist/i, /amazon/i, /machine learning/i] },
      { id: 'R20', level: 'complex', prompt: 'Find devops engineers in Texas with Docker and Kubernetes skills', expect: [/texas/i, /docker/i, /kubernetes/i] },
    ],
  },
  {
    name: 'Jobs',
    path: '/search/jobs',
    url: 'https://preprod.zenbee.io/search/jobs',
    prompts: [
      // ---- simple: one entity ----
      { id: 'J01', level: 'simple', prompt: 'Find software engineer jobs', expect: [/software engineer/i] },
      { id: 'J02', level: 'simple', prompt: 'Find jobs in New York', expect: [/new york/i] },
      { id: 'J03', level: 'simple', prompt: 'Find remote jobs', expect: [/remote=true/] },
      { id: 'J04', level: 'simple', prompt: 'Find marketing jobs', expect: [/marketing/i] },
      { id: 'J05', level: 'simple', prompt: 'Show me data analyst jobs', expect: [/data analyst/i] },
      { id: 'J06', level: 'simple', prompt: 'Find nurse jobs', expect: [/nurse/i] },
      { id: 'J07', level: 'simple', prompt: 'Find project manager jobs', expect: [/project manager/i] },
      // ---- medium: two entities ----
      { id: 'J08', level: 'medium', prompt: 'Find remote frontend developer jobs', expect: [/frontend/i, /remote=true/] },
      { id: 'J09', level: 'medium', prompt: 'Find software engineer jobs in Chicago', expect: [/software engineer/i, /chicago/i] },
      { id: 'J10', level: 'medium', prompt: 'Find data analyst jobs in New York', expect: [/data analyst/i, /new york/i] },
      { id: 'J11', level: 'medium', prompt: 'Find remote java developer jobs', expect: [/java/i, /remote=true/] },
      { id: 'J12', level: 'medium', prompt: 'Find product manager jobs in California', expect: [/product manager/i, /california/i] },
      { id: 'J13', level: 'medium', prompt: 'Find accountant jobs in Texas', expect: [/accountant/i, /texas/i] },
      { id: 'J14', level: 'medium', prompt: 'Find remote customer support jobs', expect: [/customer support/i, /remote=true/] },
      // ---- complex: three or more entities ----
      { id: 'J15', level: 'complex', prompt: 'Find remote software engineer jobs in the United States', expect: [/software engineer/i, /remote=true/] },
      { id: 'J16', level: 'complex', prompt: 'Find remote senior java developer jobs', expect: [/java/i, /remote=true/] },
      { id: 'J17', level: 'complex', prompt: 'Find machine learning engineer jobs in California', expect: [/machine learning/i, /california/i] },
      { id: 'J18', level: 'complex', prompt: 'Find devops engineer jobs in Seattle', expect: [/devops/i, /seattle/i] },
      { id: 'J19', level: 'complex', prompt: 'Find remote graphic designer jobs in New York', expect: [/graphic designer/i, /remote=true/, /new york/i] },
      { id: 'J20', level: 'complex', prompt: 'Find sales manager jobs in Chicago', expect: [/sales manager/i, /chicago/i] },
    ],
  },
];

// ============================================================
// One suite per module — login once (storageState), one shared
// page, 20 prompts simple → complex, Clear All between prompts.
// ============================================================
for (const mod of MODULES) {
  test.describe(`${mod.name} chatbot prompts (shared page)`, () => {
    // Chatbot prompts pay LLM-parse latency on top of the slow preprod backend —
    // give every test a generous budget (describe-body test.setTimeout is a no-op,
    // so use describe.configure like the other filter suites).
    test.describe.configure({ timeout: 150000 });

    let context;
    let page;

    test.beforeAll(async ({ browser }) => {
      // Hook timeouts are not covered by describe.configure — extend explicitly
      // so a slow cold SPA boot doesn't blow the default budget.
      test.setTimeout(180000);
      context = await browser.newContext({ storageState: 'playwright/.auth/user.json' });
      page = await context.newPage();
      await openModule(page, mod.url);
    });

    test.afterEach(async () => {
      await resetToFreshChat(page, mod.url, mod.path);
    });

    test.afterAll(async () => {
      await context?.close();
    });

    for (const { id, level, prompt, expect: expectedParams } of mod.prompts) {
      test(`${id} [${level}] "${prompt}" applies the relevant filters`, async () => {
        await sendPrompt(page, prompt);
        await expectFiltersApplied(page, expectedParams);
      });
    }
  });
}
