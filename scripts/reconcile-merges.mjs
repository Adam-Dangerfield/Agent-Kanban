#!/usr/bin/env node
/**
 * reconcile-merges.mjs — KANBAN-903 (merge-gating & provenance epic).
 *
 * Verifies, WITHOUT any inbound network call, which tasks in a project are
 * actually merged — by inspecting LOCAL git checkouts you already have on
 * disk — and reflects the true state back onto the Kanban board over the
 * REST API. This is the "trust but verify" companion to the `MERGED
 * <repo>@<sha> — <url>` marker convention (KANBAN-900): markers/branch/
 * provenance tell us what a task *claims*; this script confirms it against
 * git history.
 *
 * Requires Node 18+ (global fetch) and a `git` binary on PATH.
 *
 * Env vars:
 *   KANBAN_URL    e.g. http://localhost:4000/api
 *   KANBAN_TOKEN  agent bearer token (needs write on the project to --apply)
 *
 * Usage:
 *   node scripts/reconcile-merges.mjs --project <id> \
 *     [--repo <name>=<localGitPath> ...] [--dry-run | --apply] [--help]
 *
 * Examples:
 *   # Dry-run (default) — describe what would change, touch nothing:
 *   node scripts/reconcile-merges.mjs --project kanban \
 *     --repo adam/kanban=/path/to/Kanban
 *
 *   # Actually PATCH the board:
 *   node scripts/reconcile-merges.mjs --project kanban \
 *     --repo adam/kanban=../Kanban --repo adam/other=../other --apply
 *
 * How a candidate (repo, ref) is checked as "merged":
 *   For each mapped local repo:
 *     1. `git -C <path> fetch --quiet`               (best-effort; offline-safe)
 *     2. resolve the default branch: origin/HEAD, else main, else master
 *     3. `git -C <path> merge-base --is-ancestor <ref> <defaultBranch>`
 *        exit 0 => the ref IS an ancestor of the default branch => merged.
 *   Candidate (repo, ref) pairs come from, per task:
 *     - task.provenance[]  entries { repo, sha }
 *     - `MERGED <repo>@<sha> — <url>` markers parsed from task.comments[]
 *       (first line of the comment body; "—" or a plain "-" separator; sha
 *       may be short or full)
 *     - task.branch, checked against EVERY mapped repo, but only when no
 *       repo could otherwise be determined for the task (no provenance, no
 *       markers) — we don't know which repo an ambiguous branch belongs to.
 *
 * REVERT transition (KANBAN-906):
 *   A task can be marked merge_state='merged' today and then have that
 *   commit vanish from the default branch's history tomorrow — a squash-
 *   merge got reverted, a branch was force-pushed, a PR got un-merged. We
 *   detect this when: the task's CURRENT merge_state is 'merged', we have at
 *   least one checkable candidate for it (a mapped repo + resolvable ref),
 *   and NONE of the checkable candidates are still an ancestor of the
 *   default branch. In that case (--apply only):
 *     PATCH { merge_state: 'none', _log: 'reconcile: merge reverted — reopening' }
 *   and if the task's status was 'done' we also reopen it:
 *     PATCH { ..., status: 'in_progress' }
 *   We do NOT touch provenance on revert (the historical record of what was
 *   once merged stays; only the live merge_state/status reflect reality).
 *   If a task is 'merged' but we simply have no way to check it (no repo
 *   mapping, git error), we leave it alone and log a note — silence, not a
 *   false revert.
 *
 * This script never writes to the board unless --apply is passed. One
 * task/repo failing never aborts the run — every git/HTTP failure is caught,
 * logged, and the scan continues.
 */

import { spawnSync } from 'node:child_process';

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

function extractFlagAll(arr, flag) {
  const vals = [];
  let remaining = [...arr];
  let i;
  while ((i = remaining.indexOf(flag)) !== -1) {
    vals.push(remaining[i + 1]);
    remaining = [...remaining.slice(0, i), ...remaining.slice(i + 2)];
  }
  return [vals, remaining];
}

function extractBoolFlag(arr, flag) {
  const i = arr.indexOf(flag);
  if (i === -1) return [false, arr];
  const rest = [...arr.slice(0, i), ...arr.slice(i + 1)];
  return [true, rest];
}

function showHelp() {
  process.stdout.write(`\
reconcile-merges.mjs — verify real merge status from local git checkouts and
reflect it on the Kanban board (KANBAN-903).

Env vars required: KANBAN_URL, KANBAN_TOKEN

Usage:
  node scripts/reconcile-merges.mjs --project <id> [--repo <name>=<path> ...] [--dry-run|--apply]

Flags:
  --project <id>            Project whose tasks to reconcile (required)
  --repo <name>=<path>      Map a repo name (as seen in provenance/markers/branch)
                            to a local git clone. Repeatable.
  --dry-run                 Describe actions, change nothing (default behaviour)
  --apply                   Actually PATCH the board
  --help                    Show this message

Exit: 0 on a clean run (including dry-run). Non-zero on hard errors
(missing env, missing --project, bad --repo syntax).
`);
}

// ── git helpers ────────────────────────────────────────────────────────────
// GIT_TERMINAL_PROMPT=0 stops git from blocking forever on a credential
// prompt for a private remote; a hard timeout is a second safety net for
// anything that still hangs (slow/unreachable network, askpass GUI, etc).
const GIT_ENV = { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' };
const GIT_TIMEOUT_MS = 15000;

function runGit(path, args) {
  return spawnSync('git', ['-C', path, ...args], {
    encoding: 'utf8',
    env: GIT_ENV,
    timeout: GIT_TIMEOUT_MS,
    killSignal: 'SIGKILL',
  });
}

function fetchRepoBestEffort(path) {
  // Best-effort: ignore failures (including a timeout) entirely so this
  // works offline and never blocks the whole run on one unreachable remote.
  try { runGit(path, ['fetch', '--quiet']); } catch (_) {}
}

function resolveDefaultBranch(path) {
  const sym = runGit(path, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']);
  if (sym.status === 0 && sym.stdout.trim()) {
    return sym.stdout.trim().replace(/^origin\//, '');
  }
  for (const cand of ['main', 'master']) {
    if (runGit(path, ['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${cand}`]).status === 0) return cand;
    if (runGit(path, ['rev-parse', '--verify', '--quiet', cand]).status === 0) return cand;
  }
  return null;
}

// Prefer the remote-tracking ref if it exists (more likely to be up to date).
function branchRefFor(path, branch) {
  if (runGit(path, ['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${branch}`]).status === 0) {
    return `origin/${branch}`;
  }
  return branch;
}

// Returns { checked: bool, merged: bool, error?: string }
function checkAncestor(path, ref, branchRef) {
  const res = runGit(path, ['merge-base', '--is-ancestor', ref, branchRef]);
  if (res.status === 0) return { checked: true, merged: true };
  if (res.status === 1) return { checked: true, merged: false };
  // status null (spawn failure) or >1 (bad/unknown revision, dubious ownership, etc.)
  return { checked: false, merged: false, error: (res.error && res.error.message) || (res.stderr || '').trim() || `git exited ${res.status}` };
}

function resolveSha(path, ref) {
  const res = runGit(path, ['rev-parse', ref]);
  return res.status === 0 ? res.stdout.trim() : null;
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

// ── candidate collection ────────────────────────────────────────────────────
function collectCandidates(task, repoMap) {
  const candidates = [];
  const seen = new Set();
  const add = (repo, ref, source, url) => {
    if (!repo || !ref) return;
    const key = `${repo}::${ref}`;
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push({ repo, ref, source, url: url || '' });
  };

  for (const p of Array.isArray(task.provenance) ? task.provenance : []) {
    if (p && p.repo && p.sha) add(p.repo, p.sha, 'provenance', p.url);
  }
  for (const m of parseMarkers(task.comments)) {
    add(m.repo, m.sha, 'marker', m.url);
  }

  const knownRepos = new Set(candidates.map((c) => c.repo));
  if (knownRepos.size === 0 && task.branch) {
    for (const repo of Object.keys(repoMap)) {
      add(repo, task.branch, 'branch', '');
    }
  }
  return candidates;
}

// ── per-task reconciliation ────────────────────────────────────────────────
function reconcileTask(task, repoMap) {
  const candidates = collectCandidates(task, repoMap);
  if (candidates.length === 0) {
    return { task, status: 'no-signal', checks: [], note: 'no provenance, markers, or branch to check' };
  }

  const checks = [];
  for (const cand of candidates) {
    const localPath = repoMap[cand.repo];
    if (!localPath) {
      checks.push({ ...cand, checked: false, note: `no local clone mapped for repo "${cand.repo}" (use --repo ${cand.repo}=<path>)` });
      continue;
    }
    fetchRepoBestEffort(localPath);
    const defaultBranch = resolveDefaultBranch(localPath);
    if (!defaultBranch) {
      checks.push({ ...cand, checked: false, note: `could not resolve a default branch in ${localPath}` });
      continue;
    }
    const branchRef = branchRefFor(localPath, defaultBranch);
    const anc = checkAncestor(localPath, cand.ref, branchRef);
    if (!anc.checked) {
      checks.push({ ...cand, checked: false, note: `could not resolve "${cand.ref}" in ${localPath}: ${anc.error}` });
      continue;
    }
    const sha = resolveSha(localPath, cand.ref) || cand.ref;
    checks.push({ ...cand, checked: true, merged: anc.merged, defaultBranch, branchRef, sha, localPath });
  }

  const checkedResults = checks.filter((c) => c.checked);
  const confirmedMerged = checkedResults.find((c) => c.merged);
  const wasMerged = task.merge_state === 'merged';

  // Newly confirmed merged.
  if (!wasMerged && confirmedMerged) {
    const existingProv = Array.isArray(task.provenance) ? task.provenance : [];
    const newEntry = { repo: confirmedMerged.repo, sha: confirmedMerged.sha, url: confirmedMerged.url || '' };
    const provenance = dedupeProvenance([...existingProv, newEntry]);
    return {
      task,
      status: 'confirm-merged',
      checks,
      patch: {
        merge_state: 'merged',
        provenance,
        _log: `reconcile: confirmed merged into ${confirmedMerged.defaultBranch}`,
      },
      via: confirmedMerged,
    };
  }

  // Already merged and still confirmably an ancestor — nothing to do.
  if (wasMerged && confirmedMerged) {
    return { task, status: 'still-merged', checks, via: confirmedMerged };
  }

  // REVERT: was merged, we could check at least one candidate, none are
  // still ancestors of the default branch => the merge no longer holds.
  if (wasMerged && checkedResults.length > 0 && !confirmedMerged) {
    const patch = { merge_state: 'none', _log: 'reconcile: merge reverted — reopening' };
    if (task.status === 'done') patch.status = 'in_progress';
    return { task, status: 'reverted', checks, patch };
  }

  // Not merged, and not confirmable either way.
  return {
    task,
    status: 'unconfirmed',
    checks,
    note: checkedResults.length === 0
      ? 'no checkable candidates (missing repo mapping or git could not resolve refs)'
      : 'checked but not (yet) an ancestor of the default branch',
  };
}

// ── main ────────────────────────────────────────────────────────────────────
async function main() {
  const rawArgs = process.argv.slice(2);
  if (rawArgs.includes('--help') || rawArgs.includes('-h')) {
    showHelp();
    process.exit(0);
  }

  const [projectVal, a1] = extractFlag(rawArgs, '--project');
  const [repoVals, a2] = extractFlagAll(a1, '--repo');
  const [, a3] = extractBoolFlag(a2, '--dry-run'); // accepted for readability; dry-run is the default regardless
  const [applyFlag] = extractBoolFlag(a3, '--apply');

  requireEnv();
  if (!projectVal) die('Usage: reconcile-merges.mjs --project <id> [--repo name=path ...] [--dry-run|--apply]  (--project is required)');

  const repoMap = {};
  for (const kv of repoVals) {
    const idx = (kv || '').indexOf('=');
    if (!kv || idx === -1) die(`Invalid --repo mapping "${kv}". Expected name=localPath (e.g. --repo adam/kanban=../Kanban)`);
    repoMap[kv.slice(0, idx)] = kv.slice(idx + 1);
  }
  if (Object.keys(repoMap).length === 0) {
    process.stderr.write('WARNING: no --repo mappings given — every task will be reported as unconfirmed/no-signal.\n');
  }

  const apply = applyFlag === true;
  const prefix = apply ? '' : '[dry-run] ';

  const tasks = await apiFetch(`/projects/${projectVal}/tasks`, { headers: authHeaders() });

  let confirmed = 0;
  let reverted = 0;
  const outLines = [];

  for (const task of tasks) {
    let result;
    try {
      result = reconcileTask(task, repoMap);
    } catch (err) {
      outLines.push(`[${task.id}] ERROR during reconciliation: ${err.message}`);
      continue;
    }

    if (result.status === 'confirm-merged') {
      confirmed++;
      if (apply) {
        try {
          await apiFetch(`/tasks/${task.id}`, {
            method: 'PATCH',
            headers: authHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify(result.patch),
          });
          outLines.push(`[${task.id}] confirmed merged into ${result.via.defaultBranch} (${result.via.repo}@${result.via.sha.slice(0, 12)}) → applied`);
        } catch (err) {
          outLines.push(`[${task.id}] ERROR applying merge confirmation: ${err.message}`);
        }
      } else {
        outLines.push(`${prefix}[${task.id}] would confirm merged into ${result.via.defaultBranch} (${result.via.repo}@${result.via.sha.slice(0, 12)})`);
      }
    } else if (result.status === 'reverted') {
      reverted++;
      if (apply) {
        try {
          await apiFetch(`/tasks/${task.id}`, {
            method: 'PATCH',
            headers: authHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify(result.patch),
          });
          const reopened = result.patch.status ? ', status → in_progress' : '';
          outLines.push(`[${task.id}] merge reverted — reopening (merge_state → none${reopened}) → applied`);
        } catch (err) {
          outLines.push(`[${task.id}] ERROR applying revert: ${err.message}`);
        }
      } else {
        const reopened = task.status === 'done' ? ' and status → in_progress' : '';
        outLines.push(`${prefix}[${task.id}] would revert merge_state → none${reopened} (no longer an ancestor of default branch)`);
      }
    } else if (result.status === 'still-merged') {
      outLines.push(`[${task.id}] already merged — still confirmed (${result.via.repo}@${result.via.sha.slice(0, 12)} in ${result.via.defaultBranch})`);
    } else {
      outLines.push(`[${task.id}] ${result.status}${result.note ? ' — ' + result.note : ''}`);
    }

    for (const c of result.checks || []) {
      if (!c.checked && c.note) outLines.push(`    note: ${c.note}`);
    }
  }

  process.stdout.write(outLines.join('\n') + (outLines.length ? '\n' : ''));
  process.stdout.write(
    `\n${apply ? 'Applied' : '[dry-run] Scanned'}: ${tasks.length} tasks scanned, ` +
    `${confirmed} confirmed-merged, ${reverted} reverted/reopened.\n`
  );
}

main().catch((err) => {
  process.stderr.write(`Unhandled error: ${err.message}\n`);
  process.exit(1);
});
