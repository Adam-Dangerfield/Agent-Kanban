# Kanban — Test Plan

Confirms all functionality of the dockerised stack (web → API → Postgres).
Two suites:

- **API suite** (`tests/api.mjs`) — Node, zero-dep (`node:test` + `fetch`), runs
  against the live stack at `http://localhost:4000`. Re-seeds to a known
  baseline at start.
- **UI E2E suite** (`tests/ui.spec.mjs`) — Playwright (chromium, headless), runs
  against an **isolated** stack at `http://localhost:8081` (see
  `tests/docker-compose.e2e.yml`) so it never collides with the API suite.

Each test case below has an ID, the action, and the expected result. A suite
PASSES only if every case passes; the runner exits non-zero otherwise.

---

## A. Auth (API)
| ID | Case | Expected |
|----|------|----------|
| A1 | `POST /auth/login {password:"changeme"}` | 200, `{ok:true, actor:{id:"adam"...}, token}` (JWT, 3 dot-segments) |
| A2 | login wrong password | 401 |
| A3 | login missing password | 400 |
| A4 | `POST /auth/token {token:"agt_live_9f3c_REPLACE_ME"}` | 200, `actor.id==="claude"` |
| A5 | token invalid | 401 |
| A6 | token missing | 400 |
| A7 | `PATCH /tasks/:id` with **no** Authorization | 401 |
| A8 | mutation with malformed `Authorization: Bearer xxx` | 401 |
| A9 | mutation with valid **JWT** | 2xx |
| A10 | mutation with valid **agent token** | 2xx, activity actor === that agent |
| A11 | reference GETs (agents/projects/tasks) work **without** auth | 200 |

## B. Reference data (API)
| ID | Case | Expected |
|----|------|----------|
| B1 | `GET /agents` | 200, array of 5, **no** `token_hash`/`password_hash`/`token` fields present |
| B2 | `GET /projects` | 200, 3 projects, snake_case (`description`, not `desc`) |
| B3 | `GET /projects/aws/epics` | 200, includes `FOUND`, `NET`, `SEC` |
| B4 | `GET /epics/FOUND/stories` | 200, includes `FOUND-S01` |
| B5 | `GET /projects/nope/epics` | 200, `[]` |

## C. Tasks (API)
| ID | Case | Expected |
|----|------|----------|
| C1 | `GET /projects/aws/tasks` | 200, hydrated items carry `deps`, `comments`, `activity` arrays |
| C2 | `GET /tasks/AWS-101` | 200, single hydrated task |
| C3 | `GET /tasks/NOPE-1` | 404 |
| C4 | create task (minimal) | 201, server-generated id, defaults (`status:backlog`,`priority:medium`,`merge_state:none`) |
| C5 | create task with `deps:["AWS-101"]` | 201, GET shows `deps` contains `AWS-101` |
| C6 | `PATCH` single field (`priority`) | 200, field updated |
| C7 | `PATCH {status, _log}` | 200, activity feed gains an entry with that text + correct actor; `_log` not stored as a column |
| C8 | `PATCH {branch, merge_state}` | 200, both updated |
| C9 | `PATCH /tasks/NOPE` | 404 |
| C10 | `PATCH {deps:[...]}` | 200, task_deps synced (old removed, new present) |
| C11 | `DELETE` task then GET | 204, then 404 |
| C12 | delete a task that had comments | comments/activity/deps for it gone (FK cascade), no orphan errors |
| C13 | `POST /tasks/:id/comments {body:""}` | 400; non-empty | 201, attributed to actor |
| C14 | create two tasks in same project | ids increment, unique |

## D. Cross-team requests (API)
| ID | Case | Expected |
|----|------|----------|
| D1 | `GET /projects/aws/requests` | 200, includes both incoming (to_project=aws) and outgoing |
| D2 | `POST /requests` | 201, `status:"incoming"`, activity logged, `requested_by` = actor |
| D3 | action `accept` | 200, `{request:{status:"accepted", spawned_task_id:X}, spawnedTask:{id:X, project_id:to_project, from_request_id:reqId, status:"todo"}}` |
| D4 | spawned card visible | `GET /projects/<to_project>/tasks` includes the spawned id |
| D5 | action `decline` | request.status `declined` |
| D6 | action `start` | `in_progress` |
| D7 | action `done` | `done` |
| D8 | action `cancel` | `declined` |
| D9 | invalid action | returns `{request}` unchanged (no crash) |
| D10 | action on unknown request | 404 |

## E. Persistence & integrity
| ID | Case | Expected |
|----|------|----------|
| E1 | restart api+db (`compose restart`/down+up, volume kept), re-GET a previously-created task | still present, fields intact |
| E2 | create task with invalid enum (`status:"bogus"`) | rejected (500/error), not silently stored |
| E3 | create task with unknown `project_id` | rejected (FK), not stored |
| E4 | re-seed twice | idempotent — project/agent counts identical both times |

## F. Store parity (API, in-memory mode) — optional/secondary
| ID | Case | Expected |
|----|------|----------|
| F1 | boot API with **no** `DATABASE_URL` (`node src/index.js`) on port 4002; run a subset of A–D | behaves equivalently (login `changeme`, token works, CRUD works) — proves the MemoryStore dev path |

## G. Frontend E2E (Playwright, isolated stack :8081)
| ID | Case | Expected |
|----|------|----------|
| G1 | open `/` | login card renders (Manager/Agent tabs) |
| G2 | manager login (`changeme`) | board renders: sidebar projects, 4 columns, cards visible |
| G3 | manager login wrong password | inline error shown, stays on login |
| G4 | agent-token login (`agt_live_9f3c_REPLACE_ME`) | board renders, whoami shows "via token" |
| G5 | switch project in sidebar | board + open-count update |
| G6 | type in search box | card list filters |
| G7 | apply assignee/priority/epic filter | list narrows; clear resets |
| G8 | toggle "Sort by priority" | order changes |
| G9 | switch layout to swimlanes (tweaks) | lanes render |
| G10 | click a card | detail panel opens with title/notes/messages/git/activity |
| G11 | create a ticket (New) | new card appears on the board |
| G12 | post a message on a card | message appears in the thread |
| G13 | move a card to another column | status changes (drag, or via detail status control if drag is flaky) |
| G14 | open Inbox view | incoming/outgoing requests listed |
| G15 | create a new request | appears in inbox |
| G16 | accept an incoming request | spawns a card on the target board |
| G17 | **reload the page, log back in** | G11/G12/G13 changes are still there — proves API-backed, not mock state |
| G18 | sign out | returns to login |

> G17 is the keystone test: it proves the frontend is genuinely wired to the
> API + DB and not running on the old in-memory mock.

---

## Running

```bash
# API suite (live stack must be up on :4000)
node --test tests/api.mjs

# UI E2E (brings up its own isolated stack on :8081)
docker compose -p kanban_e2e -f docker-compose.yml -f tests/docker-compose.e2e.yml up --build -d
docker compose -p kanban_e2e -f docker-compose.yml -f tests/docker-compose.e2e.yml --profile seed run --rm seed
npx playwright test tests/ui.spec.mjs
docker compose -p kanban_e2e -f docker-compose.yml -f tests/docker-compose.e2e.yml down -v
```
