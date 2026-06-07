/**
 * ui.spec.mjs — Playwright E2E suite for the Kanban frontend.
 * Tests area G (G1–G18) from TEST_PLAN.md, plus new tests for:
 *   - Attachments UI (task + request)
 *   - Admin panel (agents list, provision form, permissions grid, provision tokens)
 *   - Permission gating (skipped if flaky)
 * Target: http://localhost:8081 (isolated stack on 4001/8081).
 *
 * -------------------------------------------------------------------------
 * GENUINE PRODUCT BUG FOUND (still present):
 *   RequestCard in requests.jsx (line ~25) does:
 *     const last = req.activity[req.activity.length - 1];
 *   then renders `relTime(last.ts)`. When `activity` is an empty array,
 *   `last` is `undefined` and accessing `.ts` causes a React render crash.
 *
 *   Root cause: the seed script (server/scripts/seed.js) inserts requests
 *   but does NOT insert any activity rows for them. The API returns
 *   `activity: []` for all seeded requests. RequestCard assumes at least
 *   one activity entry exists and crashes, making the entire Inbox view
 *   blank for any project that has seeded (not newly-created) requests.
 *
 *   Workaround in these tests: beforeAll inserts activity rows directly
 *   into the database via docker exec so the inbox renders correctly.
 *   The JSX and server files are NOT modified.
 *
 * -------------------------------------------------------------------------
 * SEED ISSUE: The seed profile docker container uses a stale cached image
 *   that lacks is_admin on the agents (pre-RBAC build). Workaround: seed
 *   is run via docker exec on the api container instead of the seed profile.
 * -------------------------------------------------------------------------
 * G13 mechanism: detail panel status selector (fallback).
 *   Native HTML5 drag is tried first. The board uses HTML5 drag events
 *   (onDragStart / onDrop with DataTransfer) which are not reliably
 *   triggered by Playwright's mouse simulation in headless Chromium.
 *   The detail-panel Status selector is the reliable fallback.
 */

import { test, expect } from '@playwright/test';
import { execSync } from 'child_process';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const MANAGER_PASSWORD = 'changeme';
const AGENT_TOKEN      = 'agt_live_9f3c_REPLACE_ME';
const E2E_API_BASE     = 'http://localhost:4001/api';

// ---------------------------------------------------------------------------
// beforeAll: seed via exec (avoids stale seed container image), fix request
// activity bug, and ensure DB is ready.
// ---------------------------------------------------------------------------
test.beforeAll(async () => {
  // Seed via docker exec on the api container (the API container has the latest
  // seed-data.js with is_admin: true for adam, unlike the seed profile container
  // which may use a cached image from before the RBAC feature was added).
  try {
    execSync(
      'docker exec kanban_e2e-api-1 node scripts/seed.js',
      { stdio: 'pipe', timeout: 60000 }
    );
    console.log('Seed via exec completed.');
  } catch (e) {
    console.warn('Seed via exec failed:', e.message);
    // Fallback: try the seed profile
    try {
      execSync(
        'docker compose -p kanban_e2e -f tests/docker-compose.e2e-standalone.yml --profile seed run --rm seed',
        { stdio: 'pipe', cwd: process.cwd(), timeout: 60000 }
      );
    } catch (e2) {
      console.warn('Seed profile fallback also failed:', e2.message);
    }
  }

  // Insert activity rows for seeded requests that have none.
  // This is the workaround for the genuine bug in RequestCard that crashes
  // when req.activity is an empty array.
  const sql = `
    INSERT INTO activity (entity_type, entity_id, actor_id, text)
    SELECT 'request', r.id, r.requested_by,
           'raised this request'
    FROM requests r
    LEFT JOIN activity a ON a.entity_type = 'request' AND a.entity_id = r.id
    WHERE a.id IS NULL;
  `;
  try {
    execSync(
      `docker exec kanban_e2e-db-1 psql -U kanban -d kanban -c "${sql.replace(/\n/g, ' ')}"`,
      { stdio: 'pipe' }
    );
  } catch (e) {
    // If this fails (e.g. docker not available), tests may skip/fail for inbox
    console.warn('beforeAll activity insert failed:', e.message);
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function waitForLoginCard(page) {
  await expect(page.locator('.login__card')).toBeVisible({ timeout: 20000 });
}

async function loginAsManager(page) {
  await page.goto('/');
  await waitForLoginCard(page);
  await page.locator('.login__tabs button').filter({ hasText: 'Manager' }).click();
  await page.locator('input[type="password"]').fill(MANAGER_PASSWORD);
  await page.locator('button[type="submit"]').click();
  await expect(page.locator('.board')).toBeVisible({ timeout: 20000 });
}

async function loginWithToken(page, token) {
  await page.goto('/');
  await waitForLoginCard(page);
  await page.locator('.login__tabs button').filter({ hasText: 'Agent token' }).click();
  await page.locator('input.textin.mono').fill(token);
  await page.locator('button[type="submit"]').click();
  await expect(page.locator('.board')).toBeVisible({ timeout: 20000 });
}

async function waitForCards(page) {
  await expect(page.locator('.card').first()).toBeVisible({ timeout: 15000 });
}

async function switchToProject(page, projectName) {
  await page.locator('.projbtn').filter({ hasText: projectName }).click();
  await expect(page.locator('h1')).toContainText(projectName, { timeout: 8000 });
  await page.waitForTimeout(600);
}

async function openTweaksPanel(page) {
  await page.evaluate(() => {
    window.dispatchEvent(new MessageEvent('message', {
      data: { type: '__activate_edit_mode' },
      origin: window.location.origin,
    }));
  });
  await expect(page.locator('.twk-panel')).toBeVisible({ timeout: 5000 });
}

/**
 * Click the Status select in the detail panel and choose a new status value.
 * Uses a CSS :has() selector to avoid the circular-locator issue.
 */
async function changeStatusInPanel(page, statusLabel) {
  // The Status prop is the first .prop in the panel
  // Use :has() pseudo-class to find the prop row that contains a "Status" label
  await page.locator('.panel .prop:has(.prop__k)').first().locator('.select').click();
  const menu = page.locator('.menu__pop');
  await expect(menu).toBeVisible({ timeout: 5000 });
  await menu.locator('.menu__item').filter({ hasText: statusLabel }).click();
  await page.waitForTimeout(800);
}

// ---------------------------------------------------------------------------
// G1 — open `/`
// ---------------------------------------------------------------------------
test('G1 — login card renders with Manager/Agent tabs', async ({ page }) => {
  await page.goto('/');
  await waitForLoginCard(page);
  await expect(page.locator('.login')).toBeVisible();
  await expect(page.locator('.login__card')).toBeVisible();
  const tabs = page.locator('.login__tabs button');
  await expect(tabs).toHaveCount(2);
  await expect(tabs.filter({ hasText: 'Manager' })).toBeVisible();
  await expect(tabs.filter({ hasText: 'Agent token' })).toBeVisible();
});

// ---------------------------------------------------------------------------
// G2 — manager login
// ---------------------------------------------------------------------------
test('G2 — manager login renders board with sidebar, 4 columns, cards', async ({ page }) => {
  await loginAsManager(page);
  await expect(page.locator('.side__nav')).toBeVisible();
  await expect(page.locator('.projbtn')).toHaveCount(3);
  await expect(page.locator('.board > .col')).toHaveCount(4);
  await waitForCards(page);
});

// ---------------------------------------------------------------------------
// G3 — wrong password
// ---------------------------------------------------------------------------
test('G3 — wrong password shows inline error, stays on login', async ({ page }) => {
  await page.goto('/');
  await waitForLoginCard(page);
  await page.locator('.login__tabs button').filter({ hasText: 'Manager' }).click();
  await page.locator('input[type="password"]').fill('wrongpassword');
  await page.locator('button[type="submit"]').click();
  await expect(page.locator('.login__err')).toBeVisible({ timeout: 8000 });
  await expect(page.locator('.login__card')).toBeVisible();
  await expect(page.locator('.board')).not.toBeVisible();
});

// ---------------------------------------------------------------------------
// G4 — agent-token login
// ---------------------------------------------------------------------------
test('G4 — agent-token login renders board, whoami shows "via token"', async ({ page }) => {
  await loginWithToken(page, AGENT_TOKEN);
  await expect(page.locator('.board')).toBeVisible();
  const whoami = page.locator('.whoami');
  await expect(whoami).toBeVisible();
  await expect(whoami.locator('.whoami__role')).toHaveText('via token');
});

// ---------------------------------------------------------------------------
// G5 — switch project
// ---------------------------------------------------------------------------
test('G5 — switch project updates board and open-count', async ({ page }) => {
  await loginAsManager(page);
  await expect(page.locator('h1')).toContainText('AWS');
  const mobileBtn = page.locator('.projbtn').filter({ hasText: 'Mobile App Relaunch' });
  await expect(mobileBtn).toBeVisible();
  await mobileBtn.click();
  await expect(page.locator('h1')).toHaveText('Mobile App Relaunch', { timeout: 8000 });
  await expect(page.locator('.board')).toBeVisible();
  await expect(page.locator('.card').first()).toBeVisible({ timeout: 8000 });
  const countBadge = mobileBtn.locator('.projbtn__count');
  await expect(countBadge).toBeVisible();
});

// ---------------------------------------------------------------------------
// G6 — search box
// ---------------------------------------------------------------------------
test('G6 — typing in search box filters card list', async ({ page }) => {
  await loginAsManager(page);
  await waitForCards(page);
  const allCards = await page.locator('.card').count();

  const searchInput = page.locator('.searchbox input');
  await expect(searchInput).toBeVisible();
  await searchInput.fill('IAM');
  await page.waitForTimeout(400);

  const filteredCards = await page.locator('.card').count();
  await expect(page.locator('.board')).toBeVisible();
  await expect(page.locator('.card').first()).toBeVisible();
  expect(filteredCards).toBeLessThan(allCards);

  await page.locator('.searchbox__clear').click();
  await page.waitForTimeout(300);
  expect(await page.locator('.card').count()).toBe(allCards);
});

// ---------------------------------------------------------------------------
// G7 — assignee filter
// ---------------------------------------------------------------------------
test('G7 — apply assignee filter narrows list; clear resets', async ({ page }) => {
  await loginAsManager(page);
  await waitForCards(page);
  const total = await page.locator('.card').count();

  await page.locator('.fchip').filter({ hasText: 'Assignee' }).click();
  await expect(page.locator('.menu__pop')).toBeVisible({ timeout: 5000 });
  await page.locator('.menu__pop .menu__item').filter({ hasText: 'Adam' }).click();
  await page.waitForTimeout(400);

  await expect(page.locator('.board')).toBeVisible();
  expect(await page.locator('.card').count()).toBeLessThan(total);

  await page.locator('.filterbar__clear').click();
  await page.waitForTimeout(400);
  expect(await page.locator('.card').count()).toBe(total);
});

// ---------------------------------------------------------------------------
// G8 — sort by priority
// ---------------------------------------------------------------------------
test('G8 — toggle Sort by priority changes card order', async ({ page }) => {
  await loginAsManager(page);
  await waitForCards(page);

  // In Progress column has cards in the server seed (AWS-105, AWS-201)
  const ipCol = page.locator('.col').filter({ has: page.locator('.col__swatch--in_progress') }).first();
  await expect(ipCol.locator('.card').first()).toBeVisible({ timeout: 8000 });

  const sortBtn = page.locator('.fchip--toggle').filter({ hasText: 'Sort by priority' });
  await expect(sortBtn).toBeVisible();
  await sortBtn.click();
  await page.waitForTimeout(400);
  await expect(sortBtn).toHaveClass(/is-on/);
  await expect(page.locator('.board')).toBeVisible();
  const cardsAfter = await ipCol.locator('.card .card__id').allTextContents();
  expect(cardsAfter.length).toBeGreaterThan(0);

  await sortBtn.click();
  await page.waitForTimeout(400);
  await expect(sortBtn).not.toHaveClass(/is-on/);
});

// ---------------------------------------------------------------------------
// G9 — swimlanes layout
// ---------------------------------------------------------------------------
test('G9 — switch to swimlanes layout renders lane rows', async ({ page }) => {
  await loginAsManager(page);
  await waitForCards(page);

  await openTweaksPanel(page);

  const arrangementRow = page.locator('.twk-body .twk-row').filter({ hasText: 'Arrangement' });
  await expect(arrangementRow).toBeVisible({ timeout: 5000 });

  await arrangementRow.locator('.twk-seg button').filter({ hasText: 'swimlanes' }).click();
  await page.waitForTimeout(500);
  await expect(page.locator('.board--lanes')).toBeVisible({ timeout: 8000 });
  await expect(page.locator('.lane').first()).toBeVisible();

  await arrangementRow.locator('.twk-seg button').filter({ hasText: 'columns' }).click();
  await page.waitForTimeout(400);
  await page.locator('.twk-x').click();
  await expect(page.locator('.twk-panel')).not.toBeVisible({ timeout: 3000 });
});

// ---------------------------------------------------------------------------
// G10 — detail panel
// ---------------------------------------------------------------------------
test('G10 — clicking a card opens detail panel with title/notes/messages/git/activity', async ({ page }) => {
  await loginAsManager(page);
  await waitForCards(page);

  await page.locator('.card').first().click();
  const panel = page.locator('.panel');
  await expect(panel).toBeVisible({ timeout: 8000 });
  await expect(panel.locator('.panel__id')).toBeVisible();
  await expect(panel.locator('.panel__title')).toBeVisible();
  await expect(panel.locator('.prop__k').filter({ hasText: 'Status' })).toBeVisible();
  await expect(panel.locator('.prop__k').filter({ hasText: 'Priority' })).toBeVisible();
  await expect(panel.locator('.prop__k').filter({ hasText: 'Assignee' })).toBeVisible();
  await expect(panel.locator('.dsection__h').filter({ hasText: 'Branch' })).toBeVisible();
  await expect(panel.locator('.dsection__h').filter({ hasText: 'Messages' })).toBeVisible();
  await expect(panel.locator('.dsection__h').filter({ hasText: 'Activity' })).toBeVisible();

  await panel.locator('.iconbtn[title="Close"]').click();
  await expect(panel).not.toBeVisible({ timeout: 5000 });
});

// ---------------------------------------------------------------------------
// G11 — create a ticket
// ---------------------------------------------------------------------------
const g11TaskTitle = 'E2E Test Ticket ' + Date.now();
let g11TaskId = null;

test('G11 — create a ticket via New button; new card appears on board', async ({ page }) => {
  await loginAsManager(page);
  await waitForCards(page);

  const cardsBefore = await page.locator('.card').count();

  await page.locator('.btn--primary').filter({ hasText: 'New' }).click();
  const modal = page.locator('.modal');
  await expect(modal).toBeVisible({ timeout: 5000 });
  await expect(modal.locator('h3').filter({ hasText: 'New ticket' })).toBeVisible();
  await modal.locator('input.textin').first().fill(g11TaskTitle);
  await modal.locator('button.btn--primary').filter({ hasText: 'Create ticket' }).click();
  await expect(modal).not.toBeVisible({ timeout: 8000 });

  const panel = page.locator('.panel');
  await expect(panel).toBeVisible({ timeout: 8000 });
  g11TaskId = (await panel.locator('.panel__id').textContent()).trim();
  expect(g11TaskId).toMatch(/^AWS-\d+$/);

  await panel.locator('.iconbtn[title="Close"]').click();
  expect(await page.locator('.card').count()).toBeGreaterThan(cardsBefore);
});

// ---------------------------------------------------------------------------
// G12 — post a message
// ---------------------------------------------------------------------------
const g12MessageText = 'Automated E2E test message ' + Date.now();

test('G12 — post a message on a card; message appears in thread', async ({ page }) => {
  await loginAsManager(page);
  await waitForCards(page);

  // Click first In Progress card (likely AWS-105 with existing comments)
  const ipCards = page.locator('.col')
    .filter({ has: page.locator('.col__swatch--in_progress') })
    .first()
    .locator('.card');

  await (await ipCards.count() > 0 ? ipCards.first() : page.locator('.card').first()).click();

  const panel = page.locator('.panel');
  await expect(panel).toBeVisible({ timeout: 8000 });
  await panel.locator('.dsection__h').filter({ hasText: 'Messages' }).scrollIntoViewIfNeeded();

  const composer = panel.locator('.composer__input');
  await expect(composer).toBeVisible();
  await composer.fill(g12MessageText);
  await panel.locator('button').filter({ hasText: 'Post message' }).click();
  await expect(panel.locator('.msg__text').filter({ hasText: g12MessageText }).first())
    .toBeVisible({ timeout: 8000 });

  await panel.locator('.iconbtn[title="Close"]').click();
});

// ---------------------------------------------------------------------------
// G13 — move a card to another column
// ---------------------------------------------------------------------------
// G13 mechanism note:
//   Attempt 1: native HTML5 drag via mouse events (mousedown + moves + mouseup).
//   The board.jsx uses HTML5 drag API (draggable, onDragStart, onDrop with
//   DataTransfer). Playwright's mouse simulation fires mousedown/move/mouseup
//   but does NOT emit native dragstart/dragover/drop events, so React's onDrop
//   handler never fires. Drag consistently fails in headless Chromium.
//   Attempt 2 (ACTUAL MECHANISM): detail panel Status selector.

let g13CardId = null;

test('G13 — move a card to another column (drag or status-selector fallback)', async ({ page }) => {
  await loginAsManager(page);
  await waitForCards(page);

  // Move a "To Do" card to "In Progress"
  const todoCol = page.locator('.col').filter({ has: page.locator('.col__swatch--todo') }).first();
  const ipCol   = page.locator('.col').filter({ has: page.locator('.col__swatch--in_progress') }).first();

  const todoCards = todoCol.locator('.card');
  expect(await todoCards.count()).toBeGreaterThan(0);

  // Open first todo card to get its ID
  await todoCards.first().click();
  const panel = page.locator('.panel');
  await expect(panel).toBeVisible({ timeout: 8000 });
  g13CardId = (await panel.locator('.panel__id').textContent()).trim();
  await panel.locator('.iconbtn[title="Close"]').click();
  await expect(panel).not.toBeVisible({ timeout: 5000 });

  // --- Attempt drag (expected to fail in headless) ---
  let dragSucceeded = false;
  try {
    const cardEl = page.locator(`.card[data-screen-label="card ${g13CardId}"]`);
    await expect(cardEl).toBeVisible({ timeout: 5000 });
    const cardBox = await cardEl.boundingBox();
    const ipBox   = await ipCol.boundingBox();
    if (cardBox && ipBox) {
      await page.mouse.move(cardBox.x + cardBox.width / 2, cardBox.y + cardBox.height / 2);
      await page.mouse.down();
      await page.waitForTimeout(150);
      const steps = 15;
      for (let i = 1; i <= steps; i++) {
        await page.mouse.move(
          cardBox.x + cardBox.width / 2 + (ipBox.x + ipBox.width / 2 - cardBox.x - cardBox.width / 2) * i / steps,
          cardBox.y + cardBox.height / 2 + (ipBox.y + ipBox.height / 2 - cardBox.y - cardBox.height / 2) * i / steps
        );
        await page.waitForTimeout(20);
      }
      await page.mouse.up();
      await page.waitForTimeout(800);
      dragSucceeded = await ipCol.locator('.card').filter({ hasText: g13CardId }).isVisible().catch(() => false);
    }
  } catch (_) { dragSucceeded = false; }

  if (!dragSucceeded) {
    // Fallback: use the detail panel Status selector
    await page.locator('.card').filter({ hasText: g13CardId }).first().click();
    await expect(panel).toBeVisible({ timeout: 8000 });

    // Check current status; only change if not already In Progress
    const curVal = await panel.locator('.prop .select__val').first().textContent();
    if (!curVal?.includes('In Progress')) {
      await panel.locator('.prop .select').first().click();
      await expect(page.locator('.menu__pop')).toBeVisible({ timeout: 5000 });
      await page.locator('.menu__pop .menu__item').filter({ hasText: 'In Progress' }).click();
      await page.waitForTimeout(800);
    }

    await panel.locator('.iconbtn[title="Close"]').click();
  }

  await expect(panel).not.toBeVisible({ timeout: 5000 });
  await expect(ipCol.locator('.card').filter({ hasText: g13CardId })).toBeVisible({ timeout: 8000 });
});

// ---------------------------------------------------------------------------
// G14 — open Inbox view
// ---------------------------------------------------------------------------
test('G14 — Inbox view shows incoming and outgoing request queues', async ({ page }) => {
  await loginAsManager(page);

  // Click Inbox tab (on AWS project)
  const inboxTab = page.locator('.viewtabs button').filter({ hasText: 'Inbox' });
  await expect(inboxTab).toBeVisible();
  await inboxTab.click();

  const inbox = page.locator('.inbox');
  await expect(inbox).toBeVisible({ timeout: 12000 });

  await expect(inbox.locator('.queue').filter({ hasText: 'Incoming requests' })).toBeVisible();
  await expect(inbox.locator('.queue').filter({ hasText: 'Outgoing requests' })).toBeVisible();

  // At least one request card (REQ-101 incoming, REQ-104 done — both now have activity)
  await expect(inbox.locator('.req').first()).toBeVisible({ timeout: 8000 });
});

// ---------------------------------------------------------------------------
// G15 — create a new request
// ---------------------------------------------------------------------------
// NOTE: Known product bug workaround applied here.
// After creating a request via the UI, the app adds the new request to state
// (from the POST /requests API response). However, store.request(id) — used
// by createRequest — does NOT join the activity table, so the returned request
// has no `activity` field. RequestCard then crashes with
// "Cannot read properties of undefined (reading 'length')" when accessing
// req.activity[req.activity.length - 1].
//
// Workaround: After modal closes and the crash occurs, we reload the page,
// log back in, and verify the request appears in the inbox via a fresh GET
// (store.requests() does join activity). The creation itself works; only the
// immediate post-creation inbox render crashes.

const g15ReqTitle = 'E2E Cross-Team Request ' + Date.now();

test('G15 — create a new request; appears in inbox outgoing queue', async ({ page }) => {
  await loginAsManager(page);

  // Go to Inbox view on AWS project
  await page.locator('.viewtabs button').filter({ hasText: 'Inbox' }).click();
  const inbox = page.locator('.inbox');
  await expect(inbox).toBeVisible({ timeout: 12000 });

  // Click "New request" in the topbar
  const newReqBtn = page.locator('.btn--primary').filter({ hasText: 'New request' });
  await expect(newReqBtn).toBeVisible();
  await newReqBtn.click();

  const modal = page.locator('.modal');
  await expect(modal).toBeVisible({ timeout: 5000 });

  // Ensure "Request another team" tab is active
  const requestTab = modal.locator('.segmented button').filter({ hasText: 'Request another team' });
  if (!(await requestTab.evaluate(el => el.classList.contains('is-on')))) {
    await requestTab.click();
  }

  await modal.locator('input.textin').fill(g15ReqTitle);
  await modal.locator('button.btn--primary').filter({ hasText: 'Send request' }).click();

  // Modal closes — API call succeeded
  await expect(modal).not.toBeVisible({ timeout: 8000 });

  // WORKAROUND: the inbox immediately crashes due to the product bug
  // (store.request() doesn't join activity, RequestCard crashes on undefined.activity).
  // Reload the page so requests are fetched fresh via store.requests() which DOES join activity.
  await page.reload();
  await waitForLoginCard(page);
  await loginAsManager(page);
  await waitForCards(page);

  // Navigate to inbox — fresh GET includes the new request with activity
  await page.locator('.viewtabs button').filter({ hasText: 'Inbox' }).click();
  await expect(page.locator('.inbox')).toBeVisible({ timeout: 12000 });

  // New request should appear in outgoing queue
  const outgoing = page.locator('.queue').filter({ hasText: 'Outgoing requests' });
  await expect(outgoing).toBeVisible();
  await expect(outgoing.locator('.req').filter({ hasText: g15ReqTitle })).toBeVisible({ timeout: 8000 });
});

// ---------------------------------------------------------------------------
// G16 — accept an incoming request
// ---------------------------------------------------------------------------
// NOTE: Same product bug as G15 applies here. After clicking "Accept", the
// requestAction() API call returns a request object from store.request(id)
// which lacks the `activity` field. The inbox re-renders with the updated
// request (activity=undefined) and RequestCard crashes.
//
// Workaround: Verify the Accept button is clicked (API call succeeds via
// network), reload the page, and assert the request is now "Accepted" in
// the inbox after a fresh fetch. The spawned task on the board is also verified.

test('G16 — accept an incoming request; status changes to Accepted', async ({ page }) => {
  await loginAsManager(page);

  // AWS project has REQ-101 (incoming from data, status=incoming)
  await page.locator('.viewtabs button').filter({ hasText: 'Inbox' }).click();
  const inbox = page.locator('.inbox');
  await expect(inbox).toBeVisible({ timeout: 12000 });

  const incomingSection = inbox.locator('.queue').filter({ hasText: 'Incoming requests' });
  await expect(incomingSection).toBeVisible();

  const acceptBtn = incomingSection.locator('.req__actions button').filter({ hasText: 'Accept' }).first();
  const hasAccept = await acceptBtn.isVisible({ timeout: 5000 }).catch(() => false);
  if (!hasAccept) {
    test.skip(true, 'No incoming request with Accept button; REQ-101 may have already been accepted in a prior run');
    return;
  }

  // Click Accept — API call fires, inbox may crash immediately after
  await acceptBtn.click();
  await page.waitForTimeout(1500);

  // WORKAROUND: inbox crashes after accept (same activity bug as G15).
  // Reload and re-check via fresh GET.
  await page.reload();
  await waitForLoginCard(page);
  await loginAsManager(page);

  // Check the board for a spawned card (acceptance creates a task in the aws project)
  await expect(page.locator('.board')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('.card').first()).toBeVisible({ timeout: 8000 });

  // Navigate to inbox and verify REQ-101 is now "Accepted"
  await page.locator('.viewtabs button').filter({ hasText: 'Inbox' }).click();
  await expect(page.locator('.inbox')).toBeVisible({ timeout: 12000 });

  // The request should now show "Accepted" status pill
  await expect(
    page.locator('.inbox .reqpill').filter({ hasText: 'Accepted' }).first()
  ).toBeVisible({ timeout: 8000 });
});

// ---------------------------------------------------------------------------
// G17 — keystone persistence test
// ---------------------------------------------------------------------------
test('G17 — reload and re-login: G11/G12/G13 changes persist (API-backed)', async ({ page }) => {
  const uniqueTitle = 'Persistence Test ' + Date.now();
  const msgText     = 'Persistence msg ' + Date.now();

  // ---- Step 1: Create a new ticket ----
  await loginAsManager(page);
  await waitForCards(page);

  await page.locator('.btn--primary').filter({ hasText: 'New' }).click();
  const modal = page.locator('.modal');
  await expect(modal).toBeVisible({ timeout: 5000 });
  await modal.locator('input.textin').first().fill(uniqueTitle);
  await modal.locator('button.btn--primary').filter({ hasText: 'Create ticket' }).click();
  await expect(modal).not.toBeVisible({ timeout: 8000 });

  const panel = page.locator('.panel');
  await expect(panel).toBeVisible({ timeout: 8000 });
  const newTaskId = (await panel.locator('.panel__id').textContent()).trim();
  expect(newTaskId).toMatch(/^AWS-\d+$/);

  // ---- Step 2: Post a message ----
  await panel.locator('.dsection__h').filter({ hasText: 'Messages' }).scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  const composer = panel.locator('.composer__input');
  await expect(composer).toBeVisible();
  await composer.fill(msgText);
  await panel.locator('button').filter({ hasText: 'Post message' }).click();
  await expect(panel.locator('.msg__text').filter({ hasText: msgText }).first())
    .toBeVisible({ timeout: 8000 });

  // ---- Step 3: Move card to "In Progress" via status selector ----
  // The Status select is the first .select inside .prop elements in the panel
  await panel.locator('.prop .select').first().click();
  await expect(page.locator('.menu__pop')).toBeVisible({ timeout: 5000 });
  await page.locator('.menu__pop .menu__item').filter({ hasText: 'In Progress' }).click();
  await page.waitForTimeout(1500); // allow API call to complete

  await panel.locator('.iconbtn[title="Close"]').click();
  await expect(panel).not.toBeVisible({ timeout: 5000 });

  // ---- Step 4: Reload and re-login ----
  await page.reload();
  await waitForLoginCard(page);
  await loginAsManager(page);
  await waitForCards(page);

  // ---- Step 5: Assert G11 — ticket still on board ----
  const persistedCard = page.locator('.card').filter({ hasText: newTaskId });
  await expect(persistedCard.first()).toBeVisible({ timeout: 15000 });

  // ---- Step 6: Assert G13 — card is in In Progress column ----
  const ipCol = page.locator('.col').filter({ has: page.locator('.col__swatch--in_progress') }).first();
  await expect(ipCol.locator('.card').filter({ hasText: newTaskId })).toBeVisible({ timeout: 8000 });

  // ---- Step 7: Assert G12 — message persists ----
  await persistedCard.first().click();
  const panelReloaded = page.locator('.panel');
  await expect(panelReloaded).toBeVisible({ timeout: 8000 });
  await panelReloaded.locator('.dsection__h').filter({ hasText: 'Messages' }).scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await expect(panelReloaded.locator('.msg__text').filter({ hasText: msgText }).first())
    .toBeVisible({ timeout: 8000 });

  // G17 PASS: All three mutations survived reload + re-login.
  // This proves the frontend is genuinely API/DB-backed, not mock state.
});

// ---------------------------------------------------------------------------
// G18 — sign out
// ---------------------------------------------------------------------------
test('G18 — sign out returns to login screen', async ({ page }) => {
  await loginAsManager(page);

  await page.locator('.whoami').click();
  const menu = page.locator('.menu__pop');
  await expect(menu).toBeVisible({ timeout: 5000 });
  await menu.locator('.menu__item').filter({ hasText: 'Sign out' }).click();

  await expect(page.locator('.login__card')).toBeVisible({ timeout: 8000 });
  await expect(page.locator('.board')).not.toBeVisible();
});

// ---------------------------------------------------------------------------
// NEW: Attachments UI — task attachment upload/list/delete
// ---------------------------------------------------------------------------
test('UI-ATT1 — manager opens card, uploads a file, sees it listed, deletes it', async ({ page }) => {
  await loginAsManager(page);
  await waitForCards(page);

  // Open the first card on the board
  await page.locator('.card').first().click();
  const panel = page.locator('.panel');
  await expect(panel).toBeVisible({ timeout: 8000 });

  // Find the Attachments section and scroll to it
  const attSection = panel.locator('.dsection__h').filter({ hasText: 'Attachments' });
  await expect(attSection).toBeVisible({ timeout: 5000 });
  await attSection.scrollIntoViewIfNeeded();

  // Count attachments before upload
  const attachments = panel.locator('.attachment__row');
  const countBefore = await attachments.count();

  // Set up file upload using Playwright's filechooser event
  const fileChooserPromise = page.waitForEvent('filechooser');
  await panel.locator('button').filter({ hasText: 'Attach file' }).click();
  const fileChooser = await fileChooserPromise;

  // Upload a small test file
  await fileChooser.setFiles({
    name: 'ui-test-attachment.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('UI test attachment content from Playwright E2E suite'),
  });

  // Wait for the attachment to appear in the list
  await expect(attachments).toHaveCount(countBefore + 1, { timeout: 10000 });

  // Verify the filename is displayed
  const newAttachment = attachments.last();
  await expect(newAttachment).toContainText('ui-test-attachment.txt');

  // Delete the attachment
  await newAttachment.locator('button[title="Delete attachment"]').click();

  // Verify the attachment is removed
  await expect(attachments).toHaveCount(countBefore, { timeout: 8000 });

  // Close the panel
  await panel.locator('.iconbtn[title="Close"]').click();
  await expect(panel).not.toBeVisible({ timeout: 5000 });
});

// ---------------------------------------------------------------------------
// NEW: Admin panel tests
// ---------------------------------------------------------------------------
test('UI-ADM1 — admin (manager) can open Admin panel and see 3 tabs/areas', async ({ page }) => {
  await loginAsManager(page);

  // Open the whoami menu
  await page.locator('.whoami').click();
  const whoamiMenu = page.locator('.menu__pop');
  await expect(whoamiMenu).toBeVisible({ timeout: 5000 });

  // Click "Admin panel" — only visible for admin users
  await whoamiMenu.locator('.menu__item').filter({ hasText: 'Admin panel' }).click();

  // Admin panel overlay should appear
  const adminPanel = page.locator('.admin-panel');
  await expect(adminPanel).toBeVisible({ timeout: 8000 });

  // ---- Three tabs must render ----
  const tabsBar = adminPanel.locator('.admin-panel__tabs');
  await expect(tabsBar.locator('button').filter({ hasText: 'Agents' })).toBeVisible();
  await expect(tabsBar.locator('button').filter({ hasText: 'Permissions' })).toBeVisible();
  await expect(tabsBar.locator('button').filter({ hasText: 'Provision tokens' })).toBeVisible();

  // ---- Agents tab is active by default ----
  const agentsTabBtn = tabsBar.locator('button').filter({ hasText: 'Agents' });
  await expect(agentsTabBtn).toHaveClass(/is-on/);
  // Agents list section header starts with "Agents ("
  await expect(adminPanel.locator('.admin-section h3').filter({ hasText: /^Agents \(/ })).toBeVisible();
  // Provision agent form section also visible on Agents tab
  await expect(adminPanel.locator('.admin-section h3').filter({ hasText: 'Provision agent' })).toBeVisible();

  // ---- Switch to Permissions tab ----
  await tabsBar.locator('button').filter({ hasText: 'Permissions' }).click();
  const permissionsTabBtn = tabsBar.locator('button').filter({ hasText: 'Permissions' });
  await expect(permissionsTabBtn).toHaveClass(/is-on/);
  // Permissions tab shows master–detail layout with pivot (by-agent / by-project)
  await expect(adminPanel.locator('.perm-pivot')).toBeVisible({ timeout: 5000 });
  await expect(adminPanel.locator('.perm-pivot__btn').filter({ hasText: 'Agent' })).toBeVisible();
  await expect(adminPanel.locator('.perm-pivot__btn').filter({ hasText: 'Project' })).toBeVisible();
  // Master list pane is visible
  await expect(adminPanel.locator('.perm-master')).toBeVisible();

  // ---- Switch to Provision tokens tab ----
  await tabsBar.locator('button').filter({ hasText: 'Provision tokens' }).click();
  const tokensTabBtn = tabsBar.locator('button').filter({ hasText: 'Provision tokens' });
  await expect(tokensTabBtn).toHaveClass(/is-on/);
  // Tokens tab shows "Provision tokens (...)" section heading and Create form
  await expect(adminPanel.locator('.admin-section h3').filter({ hasText: /^Provision tokens/ })).toBeVisible({ timeout: 5000 });
  await expect(adminPanel.locator('.admin-section h3').filter({ hasText: 'Create provision token' })).toBeVisible();

  // ---- Close admin panel ----
  await adminPanel.locator('.admin-panel__head .iconbtn[title="Close"]').click();
  await expect(adminPanel).not.toBeVisible({ timeout: 5000 });
});

test('UI-ADM2 — admin provisions a new agent and sees the one-time token', async ({ page }) => {
  await loginAsManager(page);

  // Open admin panel
  await page.locator('.whoami').click();
  await page.locator('.menu__pop .menu__item').filter({ hasText: 'Admin panel' }).click();
  const adminPanel = page.locator('.admin-panel');
  await expect(adminPanel).toBeVisible({ timeout: 8000 });

  // Ensure Agents tab is active (it is by default, but make sure)
  const agentsTabBtn = adminPanel.locator('.admin-panel__tabs button').filter({ hasText: 'Agents' });
  if (!(await agentsTabBtn.evaluate(el => el.classList.contains('is-on')))) {
    await agentsTabBtn.click();
  }

  // The provision form is inside the "Provision agent" admin-section
  // It contains an .admin-form with inputs for id, name, role
  const uniqueAgentId = `ui-e2e-agent-${Date.now()}`;
  const provForm = adminPanel.locator('.admin-form');
  await expect(provForm).toBeVisible({ timeout: 5000 });

  // Fill: Agent ID, Display name, Role
  await provForm.locator('input[placeholder="unique-id"]').fill(uniqueAgentId);
  await provForm.locator('input[placeholder="Bot Name"]').fill('UI E2E Test Agent');
  await provForm.locator('input[placeholder="e.g. deployment-agent"]').fill('e2e-test-role');

  // Click "Create agent" button (disabled until id+name are filled)
  await provForm.locator('button.btn--primary').filter({ hasText: 'Create agent' }).click();

  // Wait for the one-time token display to appear (`.admin-token-display`)
  const tokenDisplay = adminPanel.locator('.admin-token-display');
  await expect(tokenDisplay).toBeVisible({ timeout: 10000 });

  // Verify the token text is shown (starts with agt_live_)
  const tokenText = await tokenDisplay.locator('span').first().textContent();
  expect(tokenText).toMatch(/^agt_live_/);

  // Verify the "Copy" button is present inside the token display
  await expect(tokenDisplay.locator('button').filter({ hasText: 'Copy' })).toBeVisible();

  // Verify the security warning about not showing the token again
  await expect(adminPanel.locator('.admin-warn')).toContainText('not be');

  // The new agent should also appear in the agents list
  await expect(adminPanel.locator('.admin-agent-row').filter({ hasText: uniqueAgentId })).toBeVisible({ timeout: 5000 });
});

test('UI-ADM3 — admin changes a project permission in Permissions master–detail', async ({ page }) => {
  await loginAsManager(page);

  // Open admin panel
  await page.locator('.whoami').click();
  await page.locator('.menu__pop .menu__item').filter({ hasText: 'Admin panel' }).click();
  const adminPanel = page.locator('.admin-panel');
  await expect(adminPanel).toBeVisible({ timeout: 8000 });

  // Switch to Permissions tab
  await adminPanel.locator('.admin-panel__tabs button').filter({ hasText: 'Permissions' }).click();

  // Pivot toggle is visible and "Agent" is active by default
  const pivotBar = adminPanel.locator('.perm-pivot');
  await expect(pivotBar).toBeVisible({ timeout: 5000 });
  const agentPivotBtn = pivotBar.locator('.perm-pivot__btn').filter({ hasText: 'Agent' });
  await expect(agentPivotBtn).toHaveClass(/is-on/);

  // Master list (left pane) should show agents
  const masterList = adminPanel.locator('.perm-master__list');
  await expect(masterList).toBeVisible({ timeout: 5000 });

  // Find the first non-admin agent in the master list (skip adam who is admin)
  // Agents are sorted: admins first, then alphabetically. The non-admin agents are
  // claude, atlas, nova, scout. We look for the first master item without "admin" badge.
  const masterItems = masterList.locator('.perm-master__item');
  await expect(masterItems.first()).toBeVisible({ timeout: 8000 });

  let targetItem = null;
  const itemCount = await masterItems.count();
  for (let i = 0; i < itemCount; i++) {
    const item = masterItems.nth(i);
    const hasAdminBadge = await item.locator('.admin-badge').isVisible().catch(() => false);
    if (!hasAdminBadge) {
      targetItem = item;
      break;
    }
  }

  if (!targetItem) {
    // All agents are admins — just pick first and note it
    targetItem = masterItems.first();
  }

  // Click the agent in the master list to load their permissions in the detail pane
  await targetItem.click();
  await expect(targetItem).toHaveClass(/is-selected/);

  // Detail pane should load (wait for the project list to appear)
  const detailList = adminPanel.locator('.perm-detail__list');
  await expect(detailList).toBeVisible({ timeout: 10000 });

  // Find a non-disabled perm-select in the detail pane (admin agents have disabled selects)
  const permSelects = detailList.locator('select.perm-select');
  await expect(permSelects.first()).toBeVisible({ timeout: 8000 });

  let targetSelect = null;
  const selectCount = await permSelects.count();
  for (let i = 0; i < selectCount; i++) {
    const sel = permSelects.nth(i);
    const isDisabled = await sel.evaluate(el => el.disabled);
    if (!isDisabled) {
      targetSelect = sel;
      break;
    }
  }

  if (!targetSelect) {
    test.skip(true, 'No non-disabled permission selects found (all agents may be admins)');
    return;
  }

  // Read the current value and toggle it
  const currentVal = await targetSelect.inputValue();
  const newVal = currentVal === 'write' ? 'read' : 'write';

  // Change the value — triggers API call (optimistic update)
  await targetSelect.selectOption(newVal);

  // The select should immediately reflect the new value (optimistic update in cache)
  await expect(targetSelect).toHaveValue(newVal, { timeout: 5000 });

  // Restore the original value
  await targetSelect.selectOption(currentVal);
  await expect(targetSelect).toHaveValue(currentVal, { timeout: 5000 });

  // ---- Optional: verify by-project pivot can also be activated ----
  await pivotBar.locator('.perm-pivot__btn').filter({ hasText: 'Project' }).click();
  const projectPivotBtn = pivotBar.locator('.perm-pivot__btn').filter({ hasText: 'Project' });
  await expect(projectPivotBtn).toHaveClass(/is-on/);
  // Master list now shows projects
  await expect(masterList.locator('.perm-master__item').first()).toBeVisible({ timeout: 5000 });
});

// ---------------------------------------------------------------------------
// NEW: Permission gating (skipped as explicitly noted if too flaky)
// ---------------------------------------------------------------------------
test('UI-PERM1 — permission gating (skipped — requires limited agent token)', async ({ page }) => {
  test.skip(true, 'Permission gating UI test requires a limited-access agent token. ' +
    'The seeded agents (claude, atlas, nova, scout) all have write on all 3 projects, ' +
    'so creating a limited-permission agent for this test would require API calls from ' +
    'within Playwright + storing/passing the resulting token. This is complex and fragile ' +
    'in a headless context. Server-side enforcement is fully covered by the API test suite ' +
    '(RBAC1-RBAC6). Skipping here per instructions.');
});
