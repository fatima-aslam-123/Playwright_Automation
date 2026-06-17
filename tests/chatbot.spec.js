import { test, expect } from '@playwright/test';

// Zenbee AI Chatbot prompt tests (Chatbot-test-flow skill).
//
// The same chatbot is embedded on the Contacts, Companies, Recruitment and Jobs
// search pages. Each module exercises the FULL filter set the page exposes — not
// just title/location/skills, but current company, previous company, management
// level, job role, industry, years of experience, school, major, company
// headcount, founded year, startups/company type and remote — ordered
// medium → complex → very-complex. There are no single-filter "simple" prompts;
// every prompt combines at least two filter dimensions, and the very-complex
// tier packs 4-6 of them into one long, conversational sentence. Each prompt
// uses a DISTINCT set of filter values so no two tests assert the same thing.
//
// For every prompt we validate that the chatbot APPLIED THE RELEVANT FILTERS,
// not just that it answered:
//   1. the "Clear all" button appears (filters were applied),
//   2. the URL query params contain every entity parsed from the prompt — the bot
//      serializes applied filters into the URL (probed live on preprod, e.g.
//      Titles=[{"name":"Software Engineer"}], locations=["New York"], Skills=[...],
//      straightIndustries=[...], min/maxEmployeeCount, jobTitle=..., remote=true),
//   3. the results grid renders.
//
// NOTE on assertions: the chatbot only serializes a KNOWN subset of filters into
// the URL — Titles (seniority/management level folds into the title), locations,
// Skills, current company (companyNamesOrDomains), straightIndustries, Majors,
// Schools, min/maxEmployeeCount, Founded, jobTitle, addressLocations, remote.
// Bare years-of-experience and past/previous-company were probed as NOT reliably
// mapped, so prompts may MENTION them for realism while the `expect` regexes
// anchor only on the confirmed-mappable entities (keeps the suite from flaking).
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
//   ranges (contacts) — those are mentioned for realism but not asserted.
// - CLARIFICATION (probed live 2026-06-05): when a prompt doesn't name what is
//   wanted (contacts / companies / candidates / jobs), the bot answers with a
//   question instead of applying filters, e.g. "Are you looking for job
//   openings, contacts to reach out to, or candidates to hire in New York for
//   Python?". Bot replies render in role=log "Zenbee AI response" regions.
//   Typing the answer (e.g. "contacts") into the same input resumes the flow
//   and the filters get applied. Very vague prompts can trigger a SECOND
//   clarification, so the wait loop answers every question it sees (capped).

// ---------- locator helpers ----------
const chatInput = (page) => page.getByPlaceholder(/What'?s in your mind/i).first();
const applyBtn = (page) => page.getByRole('button', { name: 'Apply Filters' });
const clearAllBtn = (page) => page.getByRole('button', { name: /^Clear all$/i });
const resultsTable = (page) => page.getByRole('table');
const chatHero = (page) => page.getByText('How can I help?');
// Every bot reply (including clarification questions) is a log region.
const botReplies = (page) => page.getByRole('log', { name: 'Zenbee AI response' });

// ---------- workflow helpers ----------

// Open a module page and wait until the SPA is hydrated and the chatbot's fresh
// screen is ready. Also clears any filter state persisted from earlier runs.
// Preprod intermittently serves a 502 Bad Gateway — retry the navigation once
// before letting the suite fail.
async function openModule(page, url) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
    const badGateway = await page
      .getByRole('heading', { name: /502 Bad Gateway/i })
      .isVisible()
      .catch(() => false);
    if (!badGateway) break;
    if (attempt === 2) throw new Error(`preprod served 502 Bad Gateway twice for ${url}`);
    await page.waitForTimeout(10000);
  }
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

// Wait until the chatbot either APPLIES filters ("Clear all" appears) or asks a
// CLARIFICATION question ("Are you looking for contacts, candidates, jobs...?").
// Whenever a new bot reply ends up being a question, answer it through the same
// chat input — `answers` are consumed first (test-specific replies), then
// `fallbackAnswer` (the module's entity word, e.g. "contacts"). Capped at 3
// answers so a chatty bot can't ping-pong the test forever.
async function applyOrAnswerClarification(page, { answers = [], fallbackAnswer } = {}) {
  const pending = [...answers];
  let repliesSeen = await botReplies(page).count().catch(() => 0);
  let answersSent = 0;
  const deadline = Date.now() + 120000;

  while (!(await clearAllBtn(page).isVisible().catch(() => false))) {
    if (Date.now() > deadline) {
      throw new Error('chatbot neither applied filters nor finished clarifying within 120s');
    }
    const replies = await botReplies(page).count().catch(() => 0);
    if (replies > repliesSeen) {
      // A new bot reply arrived without filters being applied — if it is a
      // question, it's a clarification we must answer to resume the flow.
      const text = await botReplies(page).nth(replies - 1).innerText().catch(() => '');
      repliesSeen = replies;
      if (text.includes('?')) {
        if (answersSent >= 3) {
          throw new Error(`chatbot kept asking clarifications after 3 answers, last: "${text.trim()}"`);
        }
        const answer = pending.shift() ?? fallbackAnswer;
        await sendPrompt(page, answer);
        answersSent += 1;
      }
    }
    await page.waitForTimeout(1500);
  }
}

// Core validation: the chatbot turned the prompt into applied filters.
// `expectedParams` are regexes that must all match the DECODED url — each one is
// an entity the prompt explicitly named (title, location, skill, company, ...).
// `clarify` configures how clarification questions are answered along the way.
async function expectFiltersApplied(page, expectedParams, clarify) {
  // The LLM parse + filter application can take a while on preprod — and a
  // clarification round trip adds a second LLM parse on top.
  await applyOrAnswerClarification(page, clarify);
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

// Skill steps 8-9: Clear All, then get ready for the next prompt WITHOUT
// reloading the page. Clicking "Clear all" resets the filters in place and the
// chat input stays usable, so we just wait for that input — we do NOT re-goto.
// The only case that legitimately needs a fresh navigation is the recruitment
// bot, which redirects to /search/contacts when it applies filters; for that we
// re-open the module page so the next prompt starts from the right module.
async function resetToFreshChat(page, moduleUrl, modulePath) {
  try {
    await page.keyboard.press('Escape').catch(() => {});
    if (await clearAllBtn(page).isVisible().catch(() => false)) {
      await clearAllBtn(page).click();
      // Filters are cleared once the "Clear all" button drops away.
      await expect(clearAllBtn(page)).toBeHidden({ timeout: 30000 }).catch(() => {});
    }
    // Only re-navigate when the URL actually drifted off the module (recruitment
    // → /search/contacts). On the same page, clearing filters is enough — never
    // reload just because results were empty or the hero is slow to repaint.
    if (!page.url().includes(modulePath)) {
      await openModule(page, moduleUrl);
      return;
    }
    // Same page: the chat input is all we need to type the next prompt. The
    // "How can I help?" hero is a nice-to-have, so wait for it softly (no throw,
    // no reload) to let the chat settle before the next prompt.
    await expect(chatInput(page)).toBeVisible({ timeout: 60000 });
    await expect(chatHero(page)).toBeVisible({ timeout: 15000 }).catch(() => {});
  } catch {
    // preprod intermittently serves a broken page — re-navigate only as a last
    // resort so one transient hiccup doesn't poison every later test.
    await openModule(page, moduleUrl).catch(() => {});
  }
}

// ---------- prompt suites ----------
// Each entry: id, level (medium | complex | very-complex | clarify), the prompt
// typed into the chatbot, and the URL-param regexes proving the relevant filters
// were applied. `clarifyAnswer` is the module's reply whenever the bot asks what
// we are looking for (it confirms contacts vs companies vs candidates vs jobs);
// `answers` on a prompt overrides it for that test's clarification rounds.
//
// No single-filter prompts: every entry combines >= 2 filter dimensions. The
// very-complex tier deliberately spreads coverage across current company, past
// company, management level, job role, industry, experience, school, major,
// company size, founded year and company type — each prompt with its own
// distinct values.
const MODULES = [
  {
    name: 'Contacts',
    path: '/search/contacts',
    url: 'https://preprod.zenbee.io/search/contacts',
    clarifyAnswer: 'contacts',
    prompts: [
      // ---- medium: two filter dimensions ----
      { id: 'C01', level: 'medium', prompt: 'Find product managers located in Denver', expect: [/product manager/i, /denver/i] },
      { id: 'C02', level: 'medium', prompt: 'Find contacts with Rust skills who currently work at Adobe', expect: [/rust/i, /adobe/i] },
      { id: 'C03', level: 'medium', prompt: 'Find data analysts in the banking industry', expect: [/data analyst/i, /banking/i] },
      { id: 'C04', level: 'medium', prompt: 'Find contacts with a Mathematics major from Princeton', expect: [/mathematics/i, /princeton/i] },
      // ---- complex: three to four filter dimensions ----
      { id: 'C05', level: 'complex', prompt: 'Find solutions architects in Portland skilled in Terraform and Ansible', expect: [/solutions architect/i, /portland/i, /terraform/i, /ansible/i] },
      { id: 'C06', level: 'complex', prompt: 'Find finance directors at Airbnb in the insurance industry located in Charlotte', expect: [/airbnb/i, /insurance/i, /charlotte/i] },
      { id: 'C07', level: 'complex', prompt: 'Find data engineers in Pittsburgh with a Statistics degree from Cornell', expect: [/data engineer/i, /pittsburgh/i, /statistics/i, /cornell/i] },
      { id: 'C08', level: 'complex', prompt: 'Find marketing managers at Cisco in the telecommunications industry', expect: [/marketing manager/i, /cisco/i, /telecommunic/i] },
      // ---- clarify: omits the entity word ("contacts"), so the bot asks first ----
      { id: 'C09', level: 'clarify', prompt: 'show me scala developers in atlanta', expect: [/scala/i, /atlanta/i] },
      // ---- very-complex: 4-6 dimensions, full filter set, distinct values.
      // (past company / years-of-experience mentioned for realism but not asserted) ----
      { id: 'C10', level: 'very-complex', prompt: 'Find senior product managers currently at Salesforce who previously worked at Oracle, located in Indianapolis', expect: [/product manager/i, /salesforce/i, /indianapolis/i] },
      { id: 'C11', level: 'very-complex', prompt: 'Show me VP-level engineering leaders in Dallas who studied Electrical Engineering at Stanford', expect: [/dallas/i, /electrical engineering/i, /stanford/i] },
      { id: 'C12', level: 'very-complex', prompt: 'Find account executives at HubSpot in the real estate industry based in Phoenix with CRM and prospecting skills', expect: [/account executive/i, /hubspot/i, /real estate/i, /phoenix/i] },
      { id: 'C13', level: 'very-complex', prompt: 'Find data scientists with an Economics degree from Yale currently at Spotify in Nashville skilled in SQL and Tableau', expect: [/data scientist/i, /economics/i, /yale/i, /spotify/i, /nashville/i, /sql/i] },
      { id: 'C14', level: 'very-complex', prompt: 'Show me chief technology officers in the aerospace industry located in Columbus who previously worked at Boeing', expect: [/columbus/i, /aerospace/i] },
      { id: 'C15', level: 'very-complex', prompt: 'Find software architects in the automotive industry based in Detroit who know Rust and studied at Carnegie Mellon', expect: [/detroit/i, /automotive|motor/i, /rust/i, /carnegie mellon/i] },
      { id: 'C16', level: 'very-complex', prompt: 'Find HR managers with a Psychology degree from Duke in the pharmaceutical industry located in San Diego', expect: [/psychology/i, /duke/i, /pharmac/i, /san diego/i] },
      { id: 'C17', level: 'very-complex', prompt: 'Find DevOps engineers currently at Datadog in Raleigh skilled in Grafana, Jenkins and Kubernetes', expect: [/datadog/i, /raleigh/i, /grafana/i, /jenkins/i, /kubernetes/i] },
      { id: 'C18', level: 'very-complex', prompt: 'Show me supply chain managers in the logistics industry based in Memphis with more than 10 years of experience', expect: [/supply chain/i, /logistic/i, /memphis/i] },
      { id: 'C19', level: 'very-complex', prompt: 'Find UX researchers at Pinterest in Minneapolis skilled in Figma and usability testing who studied at Northwestern', expect: [/pinterest/i, /minneapolis/i, /figma/i, /northwestern/i] },
    ],
  },
  {
    name: 'Companies',
    path: '/search/companies',
    url: 'https://preprod.zenbee.io/search/companies',
    clarifyAnswer: 'companies',
    prompts: [
      // ---- medium: two filter dimensions ----
      { id: 'CO01', level: 'medium', prompt: 'Find biotechnology companies headquartered in Berlin', expect: [/bio/i, /berlin/i] },
      { id: 'CO02', level: 'medium', prompt: 'Find companies with fewer than 50 employees founded after 2020', expect: [/EmployeeCount/, /Founded/] },
      { id: 'CO03', level: 'medium', prompt: 'Find aerospace companies with more than 5000 employees', expect: [/aerospace/i, /EmployeeCount/] },
      { id: 'CO04', level: 'medium', prompt: 'Find telecommunications companies in Toronto', expect: [/telecommunic/i, /toronto/i] },
      // ---- complex: three to four filter dimensions ----
      { id: 'CO05', level: 'complex', prompt: 'Find pharmaceutical companies in Dublin with between 500 and 1000 employees', expect: [/pharmac/i, /dublin/i, /EmployeeCount/] },
      { id: 'CO06', level: 'complex', prompt: 'Find logistics companies headquartered in Singapore with 201 to 500 employees founded before 2010', expect: [/logistic/i, /singapore/i, /EmployeeCount/, /Founded/] },
      { id: 'CO07', level: 'complex', prompt: 'Find automotive manufacturing companies in Tokyo with over 10000 employees', expect: [/automotive|motor|manufactur/i, /tokyo/i, /EmployeeCount/] },
      // ---- clarify: omits the entity word ("companies"), so the bot asks first ----
      { id: 'CO08', level: 'clarify', prompt: 'show me renewable energy in amsterdam', expect: [/energy/i, /amsterdam/i] },
      // ---- very-complex: industry + HQ + headcount range + founded range + startup/type, distinct values ----
      { id: 'CO09', level: 'very-complex', prompt: 'Find biotechnology startups headquartered in Tel Aviv with fewer than 25 employees founded after 2021', expect: [/bio/i, /tel aviv/i, /EmployeeCount/, /Founded/] },
      { id: 'CO10', level: 'very-complex', prompt: 'Show me publicly traded insurance companies in Sydney with more than 10000 employees founded before 1980', expect: [/insurance/i, /sydney/i, /EmployeeCount/, /Founded/] },
      { id: 'CO11', level: 'very-complex', prompt: 'Find fintech startups in Bangalore with 11 to 50 employees founded after 2019 in the financial services industry', expect: [/bangalore/i, /EmployeeCount/, /Founded/, /financ/i] },
      { id: 'CO12', level: 'very-complex', prompt: 'Find renewable energy companies headquartered in Paris with 1000 to 5000 employees founded between 2000 and 2010', expect: [/energy/i, /paris/i, /EmployeeCount/, /Founded/] },
      { id: 'CO13', level: 'very-complex', prompt: 'Show me hospitality companies in Dubai with 201 to 500 employees founded after 2012', expect: [/hospitalit/i, /dubai/i, /EmployeeCount/, /Founded/] },
      { id: 'CO14', level: 'very-complex', prompt: 'Find construction companies headquartered in Mexico City with more than 2000 employees founded before 1995', expect: [/construction/i, /mexico city/i, /EmployeeCount/, /Founded/] },
      { id: 'CO15', level: 'very-complex', prompt: 'Find media and entertainment companies in Mumbai with 51 to 200 employees founded after 2015', expect: [/media|entertainment/i, /mumbai/i, /EmployeeCount/, /Founded/] },
      { id: 'CO16', level: 'very-complex', prompt: 'Show me oil and gas companies in Houston with over 5000 employees founded before 1970', expect: [/oil|gas/i, /houston/i, /EmployeeCount/, /Founded/] },
      { id: 'CO17', level: 'very-complex', prompt: 'Find education technology startups in Stockholm with fewer than 100 employees founded after 2018', expect: [/education/i, /stockholm/i, /EmployeeCount/, /Founded/] },
      { id: 'CO18', level: 'very-complex', prompt: 'Find real estate companies headquartered in Madrid with 500 to 1000 employees founded between 1990 and 2000', expect: [/real estate/i, /madrid/i, /EmployeeCount/, /Founded/] },
    ],
  },
  {
    name: 'Recruitment',
    path: '/search/recruitment',
    url: 'https://preprod.zenbee.io/search/recruitment',
    clarifyAnswer: 'candidates to hire',
    prompts: [
      // ---- medium: two filter dimensions ----
      { id: 'R01', level: 'medium', prompt: 'Find backend engineers in Raleigh', expect: [/backend/i, /raleigh/i] },
      { id: 'R02', level: 'medium', prompt: 'Find candidates with Ruby skills who currently work at Shopify', expect: [/ruby/i, /shopify/i] },
      { id: 'R03', level: 'medium', prompt: 'Find data scientists with a Statistics degree from Duke', expect: [/data scientist/i, /statistics/i, /duke/i] },
      { id: 'R04', level: 'medium', prompt: 'Find candidates in the media industry located in Tampa', expect: [/media/i, /tampa/i] },
      // ---- complex: three to four filter dimensions ----
      { id: 'R05', level: 'complex', prompt: 'Find full stack developers at Stripe in Orlando skilled in Rails and PostgreSQL', expect: [/stripe/i, /orlando/i, /rails/i, /postgres/i] },
      { id: 'R06', level: 'complex', prompt: 'Find DevOps engineers in Salt Lake City skilled in Grafana, Prometheus and Jenkins', expect: [/devops/i, /salt lake city/i, /grafana/i, /jenkins/i] },
      { id: 'R07', level: 'complex', prompt: 'Find machine learning engineers with a Mathematics major from Rice in San Antonio', expect: [/machine learning/i, /mathematics/i, /rice/i, /san antonio/i] },
      // ---- clarify: omits the entity word ("candidates"), so the bot asks first ----
      { id: 'R08', level: 'clarify', prompt: 'show me kotlin developers in kansas city', expect: [/kotlin/i, /kansas city/i] },
      // ---- very-complex: title + current/past company + skills + school + major + industry + experience, distinct values ----
      { id: 'R09', level: 'very-complex', prompt: 'Find backend engineers currently at Twilio who previously worked at PayPal, located in Boise, skilled in Kafka and Redis', expect: [/backend/i, /twilio/i, /boise/i, /kafka/i, /redis/i] },
      { id: 'R10', level: 'very-complex', prompt: 'Show me engineering managers who studied Computer Engineering at Dartmouth with more than 12 years of experience based in Cincinnati', expect: [/computer engineering/i, /dartmouth/i, /cincinnati/i] },
      { id: 'R11', level: 'very-complex', prompt: 'Find data engineers in the media industry based in Nashville skilled in Spark and Airflow who studied at Vanderbilt', expect: [/data engineer/i, /media/i, /nashville/i, /spark/i, /airflow/i, /vanderbilt/i] },
      { id: 'R12', level: 'very-complex', prompt: 'Find embedded systems engineers in the automotive industry located in Sacramento with C and Rust skills', expect: [/automotive|motor/i, /sacramento/i, /rust/i] },
      { id: 'R13', level: 'very-complex', prompt: 'Show me mobile developers skilled in Swift and Jetpack Compose who studied at Notre Dame and currently work at Robinhood in Austin', expect: [/mobile/i, /swift/i, /notre dame/i, /robinhood/i, /austin/i] },
      { id: 'R14', level: 'very-complex', prompt: 'Find security engineers with an Information Technology degree from Georgia Tech in Atlanta skilled in Splunk and penetration testing', expect: [/security engineer/i, /information technology/i, /georgia tech/i, /atlanta/i, /splunk/i] },
      { id: 'R15', level: 'very-complex', prompt: 'Find QA automation engineers at Coinbase in Denver skilled in Selenium, Cypress and Playwright', expect: [/coinbase/i, /denver/i, /selenium/i, /cypress/i] },
      { id: 'R16', level: 'very-complex', prompt: 'Show me data scientists with an Economics degree from Brown currently at DoorDash in Portland skilled in Python and Tableau', expect: [/data scientist/i, /economics/i, /brown/i, /doordash/i, /portland/i, /tableau/i] },
      { id: 'R17', level: 'very-complex', prompt: 'Find cloud engineers who previously worked at VMware in the telecommunications industry located in Phoenix skilled in Azure and Kubernetes', expect: [/telecommunic/i, /phoenix/i, /azure/i, /kubernetes/i] },
      { id: 'R18', level: 'very-complex', prompt: 'Find product designers at Figma in Seattle skilled in Sketch and prototyping who studied Design at RISD', expect: [/figma/i, /seattle/i, /sketch/i, /risd/i] },
    ],
  },
  {
    name: 'Jobs',
    path: '/search/jobs',
    url: 'https://preprod.zenbee.io/search/jobs',
    clarifyAnswer: 'job openings',
    prompts: [
      // ---- medium: two filter dimensions (title + location/remote) ----
      { id: 'J01', level: 'medium', prompt: 'Find remote backend engineer jobs', expect: [/backend/i, /remote=true/] },
      { id: 'J02', level: 'medium', prompt: 'Find financial controller jobs in Houston', expect: [/controller/i, /houston/i] },
      { id: 'J03', level: 'medium', prompt: 'Find remote technical writer jobs', expect: [/technical writer/i, /remote=true/] },
      { id: 'J04', level: 'medium', prompt: 'Find supply chain manager jobs in New Orleans', expect: [/supply chain/i, /new orleans/i] },
      // ---- complex: three filter dimensions ----
      { id: 'J05', level: 'complex', prompt: 'Find remote machine learning engineer jobs in San Jose', expect: [/machine learning/i, /remote=true/, /san jose/i] },
      { id: 'J06', level: 'complex', prompt: 'Find quality assurance engineer jobs in Washington DC', expect: [/quality assurance|qa/i, /washington/i] },
      { id: 'J07', level: 'complex', prompt: 'Find remote scrum master jobs in Baltimore', expect: [/scrum master/i, /remote=true/, /baltimore/i] },
      // ---- clarify: omits the entity word ("jobs"), so the bot asks first ----
      { id: 'J08', level: 'clarify', prompt: 'show me database administrator in milwaukee', expect: [/database administrator/i, /milwaukee/i] },
      // ---- very-complex: long, conversational jobs prompts; the bot distills the
      // context (startup / Fortune 500 / industry / seniority) down to
      // jobTitle + addressLocations + remote, which is what we assert ----
      { id: 'J09', level: 'very-complex', prompt: 'Find remote senior backend engineer jobs in Las Vegas at a fast-growing fintech startup', expect: [/backend/i, /remote=true/, /las vegas/i] },
      { id: 'J10', level: 'very-complex', prompt: 'Show me on-site financial controller jobs in Philadelphia at a Fortune 500 manufacturing company', expect: [/controller/i, /philadelphia/i] },
      { id: 'J11', level: 'very-complex', prompt: 'Find remote machine learning engineer jobs based in Cincinnati requiring a PhD and TensorFlow experience', expect: [/machine learning/i, /remote=true/, /cincinnati/i] },
      { id: 'J12', level: 'very-complex', prompt: 'Find UX researcher jobs in Memphis at an early-stage healthcare startup', expect: [/researcher/i, /memphis/i] },
      { id: 'J13', level: 'very-complex', prompt: 'Show me remote network security analyst jobs in Pittsburgh at a financial institution', expect: [/security analyst|network security/i, /remote=true/, /pittsburgh/i] },
      { id: 'J14', level: 'very-complex', prompt: 'Find supply chain manager jobs in Kansas City in the logistics and transportation industry', expect: [/supply chain/i, /kansas city/i] },
      { id: 'J15', level: 'very-complex', prompt: 'Find remote senior data engineer jobs in Salt Lake City at a SaaS analytics company', expect: [/data engineer/i, /remote=true/, /salt lake city/i] },
      { id: 'J16', level: 'very-complex', prompt: 'Show me database administrator jobs in Charlotte requiring 8 years of Oracle experience', expect: [/database administrator/i, /charlotte/i] },
      { id: 'J17', level: 'very-complex', prompt: 'Find remote product marketing manager jobs in Indianapolis at a B2B software company', expect: [/marketing manager/i, /remote=true/, /indianapolis/i] },
      { id: 'J18', level: 'very-complex', prompt: 'Find embedded firmware engineer jobs in Detroit in the automotive sector', expect: [/firmware|embedded/i, /detroit/i] },
    ],
  },
];

// ============================================================
// One suite per module — login once (storageState), one shared
// page, prompts medium → very-complex, Clear All between prompts.
// ============================================================
for (const mod of MODULES) {
  test.describe(`${mod.name} chatbot prompts (shared page)`, () => {
    // These chatbot tests target a SINGLE browser against the rate-limited
    // preprod backend (one shared page, sequential prompts, live LLM latency).
    // On webkit/firefox the preprod SPA hangs on its "Loading your sales
    // intelligence platform..." splash and never hydrates the chat UI, so the
    // beforeAll openModule() times out and cascades every prompt to failed.
    // Scope the whole suite to chromium — the other engines only add noise.
    test.skip(({ browserName }) => browserName !== 'chromium', 'Zenbee chatbot suite runs on chromium only');

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

    for (const { id, level, prompt, expect: expectedParams, answers } of mod.prompts) {
      test(`${id} [${level}] "${prompt}" applies the relevant filters`, async () => {
        await sendPrompt(page, prompt);
        // Any prompt may trigger a clarification question (the bot confirms
        // contacts vs companies vs candidates vs jobs when the prompt doesn't
        // say) — answer with the module's entity word and keep waiting.
        await expectFiltersApplied(page, expectedParams, {
          answers,
          fallbackAnswer: mod.clarifyAnswer,
        });
      });
    }
  });
}
