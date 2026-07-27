#!/usr/bin/env node
/**
 * backfill-provenance.mjs — KANBAN-902 (merge-gating & provenance epic).
 *
 * One-time (but safely idempotent — rerun it whenever) reconcile of EXISTING
 * tasks onto the new `provenance` field, by parsing the `MERGED <repo>@<sha>
 * — <url>` marker convention (KANBAN-900) that's already sitting in task
 * comments from before `provenance` existed. Pure HTTP client — talks only
 * to the Kanban REST API, never touches the database or git directly.
 *
 * Requires Node 18+ (global fetch).
 *
 * Env vars:
 *   KANBAN_URL    e.g. http://localhost:4000/api
 *   KANBAN_TOKEN  agent bearer token (needs write on the project to --apply)
 *
 * Usage:
 *   node scripts/backfill-provenance.mjs --project <id> [--dry-run | --apply] [--set-merged] [--help]
 *
 * Examples:
 *   # Dry-run (default) — describe what would change, touch nothing:
 *   node scripts/backfill-provenance.mjs --project kanban
 *
 *   # Actually PATCH the board, and also flip merge_state to 'merged' where a
 *   # marker was found and it wasn't already:
 *   node scripts/backfill-provenance.mjs --project kanban --apply --set-merged
 *
 * Behaviour:
 *   For each task in the project:
 *     - Parse every first-line `MERGED <repo>@<sha> — <url>` marker out of
 *       task.comments[] (em-dash or plain hyphen separator; short or full sha).
 *     - Merge the parsed entries into the task's existing provenance[],
 *       deduplicated by (repo, sha). Already-recorded markers are skipped —
 *       that's what makes reruns idempotent/safe.
 *     - If nothing new was found, the task is skipped entirely (no PATCH).
 *     - In --apply mode: PATCH { provenance, merge_state?, _log }.
 *       merge_state is only included when --set-merged was passed AND the
 *       task's merge_state isn't already 'merged'.
 *
 * This script never writes to the board unless --apply is passed. One task
 * failing never aborts the run — every HTTP failure for a single task is
 * caught, logged, and the scan continues.
 */

// ── env ──────────────────────────────────────────────────────────────────
const BASE = (process.env.KANBAN_URL || '').replace(/\/$/, '');
const TOKEN = process.env.KANBAN_TOKEN || '';

// ── small helpers (matches kanban-import-tasks.mjs / kanban.mjs style) ───
function die(msg, code = 1) {
  process.stderr.write(`ERROR: ${msg}\n`);
  process.exit(code);
}

function requireEnv() {
  if (!BASE) die('KANBAN_URL is not set. Export it before running.');
  if (!TOKEN) die('KANBAN_TOKEN is not set. Export it before running.');
}

function authHeaders(extra = {}) {
  return { Authorization: `Bearer ${TOKEN}`, ...extra };
}

async function apiFetch(path, opts = {}) {
  const url = `${BASE}${path}`;
  let res;
  try {
    res = await fetch(url, opts);
  } catch (err) {
    die(`Network error reaching ${url}: ${err.message}`);
  }
  if (!res.ok) {
    let body = '';
    try { body = await res.text(); } catch (_) {}
    die(`HTTP ${res.status} ${res.statusText} — ${path}\n${body}`);
  }
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) return res.json();
  return res;
}

// ── arg parsing ────────────────────────────────────────────────────────────
function extractFlag(arr, flag) {
  const i = arr.indexOf(flag);
  if (i === -1) return [undefined, arr];
  const val = arr[i + 1];
  const rest = [...arr.slice(0, i), ...arr.slice(i + 2)];
  return [val, rest];
}

function extractBoolFlag(arr, flag) {
  const i = arr.indexOf(flag);
  if (i === -1) return [false, arr];
  const rest = [...arr.slice(0, i), ...arr.slice(i + 1)];
  return [true, rest];
}

function showHelp() {
  process.stdout.write(`\
backfill-provenance.mjs — parse existing MERGED markers out of task comments
and record them onto task.provenance (KANBAN-902). Idempotent — safe to rerun.

Env vars required: KANBAN_URL, KANBAN_TOKEN

Usage:
  node scripts/backfill-provenance.mjs --project <id> [--dry-run|--apply] [--set-merged]

Flags:
  --project <id>   Project whose tasks to backfill (required)
  --dry-run        Describe actions, change nothing (default behaviour)
  --apply          Actually PATCH the board
  --set-merged     Also set merge_state='merged' when a marker is found and
                    merge_state isn't already 'merged'
  --help           Show this message

Exit: 0 on a clean run (including dry-run). Non-zero on hard errors
(missing env, missing --project).
`);
}

// ── MERGED marker parsing (KANBAN-900) ─────────────────────────────────────
// "MERGED <repo>@<sha> — <url>"  — em-dash or plain hyphen separator, tolerant
// of short or full shas. Only the first line of a comment body is considered.
const MARKER_RE = /^MERGED\s+(\S+)@(\S+)\s+[—-]\s+(.+)$/;

function parseMarkers(comments) {
  const out = [];
  for (const c of comments || []) {
    const firstLine = String(c.body || '').split('\n')[0].trim();
    const m = MARKER_RE.exec(firstLine);
    if (m) out.push({ repo: m[1], sha: m[2], url: m[3].trim() });
  }
  return out;
}

function dedupeProvenance(list) {
  const map = new Map();
  for (const p of list) {
    if (!p || !p.repo || !p.sha) continue;
    const key = `${p.repo}::${p.sha}`;
    if (!map.has(key)) {
      map.set(key, { repo: p.repo, sha: p.sha, url: p.url || '' });
    } else if (p.url && !map.get(key).url) {
      map.get(key).url = p.url;
    }
  }
  return Array.from(map.values());
}

// ── per-task backfill ──────────────────────────────────────────────────────
function backfillTask(task, setMerged) {
  const markers = parseMarkers(task.comments);
  if (markers.length === 0) {
    return { task, status: 'skip', note: 'no MERGED markers in comments' };
  }

  const existing = Array.isArray(task.provenance) ? task.provenance : [];
  const existingKeys = new Set(existing.map((p) => `${p.repo}::${p.sha}`));
  const newEntries = [];
  for (const m of markers) {
    const key = `${m.repo}::${m.sha}`;
    if (existingKeys.has(key)) continue;
    existingKeys.add(key);
    newEntries.push({ repo: m.repo, sha: m.sha, url: m.url || '' });
  }

  if (newEntries.length === 0) {
    return { task, status: 'skip', note: `${markers.length} marker(s) found, all already recorded in provenance` };
  }

  const provenance = dedupeProvenance([...existing, ...newEntries]);
  const patch = {
    provenance,
    _log: `backfill: recorded provenance from ${newEntries.length} marker(s)`,
  };
  if (setMerged && task.merge_state !== 'merged') {
    patch.merge_state = 'merged';
  }

  return { task, status: 'update', newEntries, patch };
}

// ── main ────────────────────────────────────────────────────────────────────
async function main() {
  const rawArgs = process.argv.slice(2);
  if (rawArgs.includes('--help') || rawArgs.includes('-h')) {
    showHelp();
    process.exit(0);
  }

  const [projectVal, a1] = extractFlag(rawArgs, '--project');
  const [, a2] = extractBoolFlag(a1, '--dry-run'); // accepted for readability; dry-run is the default regardless
  const [applyFlag, a3] = extractBoolFlag(a2, '--apply');
  const [setMergedFlag] = extractBoolFlag(a3, '--set-merged');

  requireEnv();
  if (!projectVal) die('Usage: backfill-provenance.mjs --project <id> [--dry-run|--apply] [--set-merged]  (--project is required)');

  const apply = applyFlag === true;
  const setMerged = setMergedFlag === true;
  const prefix = apply ? '' : '[dry-run] ';

  const tasks = await apiFetch(`/projects/${projectVal}/tasks`, { headers: authHeaders() });

  let updated = 0;
  let entriesAdded = 0;
  const outLines = [];

  for (const task of tasks) {
    let result;
    try {
      result = backfillTask(task, setMerged);
    } catch (err) {
      outLines.push(`[${task.id}] ERROR during backfill: ${err.message}`);
      continue;
    }

    if (result.status === 'skip') {
      outLines.push(`[${task.id}] skip — ${result.note}`);
      continue;
    }

    updated++;
    entriesAdded += result.newEntries.length;
    const entryDesc = result.newEntries.map((e) => `${e.repo}@${e.sha.slice(0, 12)}`).join(', ');
    const mergeNote = result.patch.merge_state ? `, merge_state → merged` : '';

    if (apply) {
      try {
        await apiFetch(`/tasks/${task.id}`, {
          method: 'PATCH',
          headers: authHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify(result.patch),
        });
        outLines.push(`[${task.id}] recorded ${result.newEntries.length} entr${result.newEntries.length === 1 ? 'y' : 'ies'} (${entryDesc})${mergeNote} → applied`);
      } catch (err) {
        outLines.push(`[${task.id}] ERROR applying backfill: ${err.message}`);
      }
    } else {
      outLines.push(`${prefix}[${task.id}] would record ${result.newEntries.length} entr${result.newEntries.length === 1 ? 'y' : 'ies'} (${entryDesc})${mergeNote}`);
    }
  }

  process.stdout.write(outLines.join('\n') + (outLines.length ? '\n' : ''));
  process.stdout.write(
    `\n${apply ? 'Applied' : '[dry-run] Scanned'}: ${tasks.length} tasks scanned, ` +
    `${updated} task(s) updated, ${entriesAdded} provenance entr${entriesAdded === 1 ? 'y' : 'ies'} added.\n`
  );
}

main().catch((err) => {
  process.stderr.write(`Unhandled error: ${err.message}\n`);
  process.exit(1);
});
