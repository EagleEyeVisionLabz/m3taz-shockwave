// Per-workspace sync engine.
//
// One instance at a time, bound to the active workspace. Lifecycle:
//   start(workspacePath)  — kicks off the tick interval
//   stop()                — clears interval, awaits any in-flight tick
//
// Each tick (sequential, never overlapping with itself):
//   1. ask renderer to flush dirty editor tabs (with a timeout)
//   2. git status --porcelain  → if dirty, git add -A && git commit
//   3. git pull --rebase
//      └─ if rebase paused (conflict markers in file): emit 'paused', return
//   4. if local ahead of origin: git push
//
// Status is pushed to the renderer via `sync:status` events whenever the
// engine state changes. The renderer's status icon consumes these.
//
// Conflicts: deferred. If pull --rebase pauses with conflict markers in
// files, we surface 'paused' and stop ticking. The user resolves (or asks
// the agent to) and we'll add a `rebase --continue` resume path later.

import path from 'node:path';
import fs from 'node:fs/promises';
import { BrowserWindow } from 'electron';
import { gitSpawn, workspaceStatus, parseGithubUrl } from './sync.js';

// ─── Engine state ──────────────────────────────────────────────────────────

let state: any = {
  running: false,           // is the tick interval armed?
  workspacePath: null,
  pat: null,
  intervalMs: 10_000,
  windowId: null,           // BrowserWindow target for status + flush events
  ticking: false,           // a tick is currently executing
  intervalHandle: null,
  pendingTickPromise: null, // resolves when current tick finishes (for stop())
};

// Status surfaced to the renderer. Status icon (task 6) maps these to icon
// states. The renderer reads `status` + `detail` + `lastSyncAt`.
const STATUS = Object.freeze({
  DISABLED: 'disabled',     // not configured (no origin in workspace)
  IDLE: 'idle',             // last tick ok, waiting for next
  SYNCING: 'syncing',       // a tick is in progress
  PAUSED: 'paused',         // rebase conflict, needs user resolution
  ERROR: 'error',           // last tick failed (auth/network/etc.)
});

let currentStatus = { status: STATUS.DISABLED, detail: '', lastSyncAt: null, repoUrl: null };

function emitStatus(patch) {
  currentStatus = { ...currentStatus, ...patch };
  const win = state.windowId ? BrowserWindow.fromId(state.windowId) : null;
  if (win && !win.isDestroyed()) {
    win.webContents.send('sync:status', currentStatus);
  }
}

export function getCurrentStatus() {
  return currentStatus;
}

// ─── Flush-renderer-dirty bridge ───────────────────────────────────────────
//
// Main asks the renderer "please flush dirty tabs and tell me when done" with
// a request token. Renderer's handler awaits its writeNow(), then invokes
// `sync:flushDone` with the token. We resolve the pending promise and
// continue. 1-second timeout so a hung renderer doesn't stall the engine.

const pendingFlushes = new Map(); // token → { resolve, timer }
let nextFlushToken = 1;

function requestFlush() {
  const win = state.windowId ? BrowserWindow.fromId(state.windowId) : null;
  if (!win || win.isDestroyed()) return Promise.resolve(undefined);
  const token = nextFlushToken++;
  return new Promise<any>((resolve) => {
    const timer = setTimeout(() => {
      pendingFlushes.delete(token);
      resolve(undefined);
    }, 1000);
    pendingFlushes.set(token, { resolve, timer });
    win.webContents.send('sync:flushRequest', token);
  });
}

export function handleFlushDone(token) {
  const entry = pendingFlushes.get(token);
  if (!entry) return;
  clearTimeout(entry.timer);
  pendingFlushes.delete(token);
  entry.resolve(undefined);
}

// ─── Tick ──────────────────────────────────────────────────────────────────

async function isRebasePaused(workspacePath) {
  try {
    await fs.access(path.join(workspacePath, '.git', 'rebase-merge'));
    return true;
  } catch { /* access throws = dir absent = not paused */ }
  try {
    await fs.access(path.join(workspacePath, '.git', 'rebase-apply'));
    return true;
  } catch { /* access throws = dir absent = not paused */ }
  return false;
}

// Treat a stderr blob as an auth failure. Same heuristic used in several places.
function isAuthError(stderr) {
  const s = stderr.toLowerCase();
  return s.includes('authentication') || s.includes('401') || s.includes('could not read username');
}

// Commit any dirty changes in the working tree. Returns true if everything is
// clean by the end, false on a git error (status emitted by caller).
async function commitDirty(workspacePath) {
  const status = await gitSpawn(workspacePath, ['status', '--porcelain'], { timeoutMs: 10_000 });
  if (!status.ok) {
    emitStatus({ status: STATUS.ERROR, detail: `git status failed: ${status.stderr.trim()}` });
    return false;
  }
  if (status.stdout.trim().length === 0) return true;
  const add = await gitSpawn(workspacePath, ['add', '-A'], { timeoutMs: 30_000 });
  if (!add.ok) {
    emitStatus({ status: STATUS.ERROR, detail: `git add failed: ${add.stderr.trim()}` });
    return false;
  }
  const commit = await gitSpawn(workspacePath, ['commit', '-m', `Shockwave sync: ${new Date().toISOString()}`], { timeoutMs: 30_000 });
  if (!commit.ok) {
    emitStatus({ status: STATUS.ERROR, detail: `git commit failed: ${commit.stderr.trim()}` });
    return false;
  }
  return true;
}

async function runTick() {
  if (!state.running) return;
  if (state.ticking) return; // serial: never overlap a tick with itself
  state.ticking = true;
  let tickResolve;
  state.pendingTickPromise = new Promise<any>((res) => { tickResolve = res; });

  try {
    // If we're sitting in a paused rebase, don't try to do anything — the
    // user needs to resolve markers and call resume (resume path to come).
    if (await isRebasePaused(state.workspacePath)) {
      emitStatus({ status: STATUS.PAUSED, detail: 'Rebase paused — resolve conflicts' });
      return;
    }

    // 1. Flush dirty editor buffers to disk. Silent — no status emit. The
    // status icon should only light up for actual upload/download work, not
    // for the routine checks we run every tick.
    await requestFlush();

    // Resolve the current branch once. We pass it explicitly to fetch / rebase
    // / push so we don't depend on an upstream being configured (the first
    // tick on a freshly-init'd repo has no upstream yet).
    const branchRes = await gitSpawn(state.workspacePath, ['rev-parse', '--abbrev-ref', 'HEAD'], { timeoutMs: 5_000 });
    const branchName = branchRes.ok ? branchRes.stdout.trim() : 'main';

    // 2. Commit local changes if dirty. Silent.
    if (!(await commitDirty(state.workspacePath))) return;

    // 3. Fetch from origin so we can compare HEAD to origin/<branch>. Silent.
    // On a freshly-init'd repo with no remote branch yet, fetch fails with
    // "couldn't find remote ref"; we treat that as "no remote branch, skip
    // pull, fall through to push".
    let remoteBranchExists = true;
    const fetch = await gitSpawn(state.workspacePath, ['fetch', 'origin', branchName], {
      pat: state.pat,
      timeoutMs: 60_000,
    });
    if (!fetch.ok) {
      const stderr = fetch.stderr.toLowerCase();
      if (isAuthError(stderr)) {
        emitStatus({ status: STATUS.PAUSED, detail: 'Authentication failed — check your PAT' });
        return;
      }
      if (stderr.includes("couldn't find remote ref")) {
        remoteBranchExists = false;
      } else {
        emitStatus({ status: STATUS.ERROR, detail: `git fetch failed: ${fetch.stderr.trim()}` });
        return;
      }
    }

    // 4. If remote has new commits we don't have, rebase. Visible — this is
    // the "downloading from git" case the user actually wants to see.
    // Without --autostash, the working tree must be clean before rebase; the
    // user may have typed during the fetch network call, so re-flush + commit.
    if (remoteBranchExists) {
      const aheadRes = await gitSpawn(state.workspacePath, ['rev-list', '--count', `HEAD..origin/${branchName}`], { timeoutMs: 5_000 });
      const remoteAhead = aheadRes.ok && parseInt(aheadRes.stdout.trim(), 10) > 0;
      if (remoteAhead) {
        await requestFlush();
        if (!(await commitDirty(state.workspacePath))) return;
        emitStatus({ status: STATUS.SYNCING, detail: 'Pulling from origin' });
        const rebase = await gitSpawn(state.workspacePath, ['rebase', `origin/${branchName}`], { timeoutMs: 60_000 });
        if (!rebase.ok) {
          if (await isRebasePaused(state.workspacePath)) {
            emitStatus({ status: STATUS.PAUSED, detail: 'Rebase paused — resolve conflicts in editor' });
            return;
          }
          emitStatus({ status: STATUS.ERROR, detail: `git rebase failed: ${rebase.stderr.trim()}` });
          return;
        }
      }
    }

    // 5. Push if local is ahead of origin (or remote branch doesn't exist
    // yet — first push). Visible — "uploading to git".
    let needPush;
    if (!remoteBranchExists) {
      needPush = true;
    } else {
      const localAheadRes = await gitSpawn(state.workspacePath, ['rev-list', '--count', `origin/${branchName}..HEAD`], { timeoutMs: 5_000 });
      needPush = localAheadRes.ok && parseInt(localAheadRes.stdout.trim(), 10) > 0;
    }
    if (needPush) {
      emitStatus({ status: STATUS.SYNCING, detail: 'Pushing to origin' });
      const push = await gitSpawn(state.workspacePath, ['push', '--set-upstream', 'origin', branchName], {
        pat: state.pat,
        timeoutMs: 60_000,
      });
      if (!push.ok) {
        if (isAuthError(push.stderr)) {
          emitStatus({ status: STATUS.PAUSED, detail: 'Authentication failed — check your PAT' });
          return;
        }
        const stderr = push.stderr.toLowerCase();
        if (push.code !== 0 && !stderr.includes('up-to-date') && !stderr.includes('nothing to')) {
          emitStatus({ status: STATUS.ERROR, detail: `git push failed: ${push.stderr.trim()}` });
          return;
        }
      }
    }

    emitStatus({ status: STATUS.IDLE, detail: '', lastSyncAt: Date.now() });
  } finally {
    state.ticking = false;
    tickResolve();
    state.pendingTickPromise = null;
  }
}

// ─── Lifecycle ─────────────────────────────────────────────────────────────

export async function start({ workspacePath, pat, intervalSeconds, windowId }) {
  // Stop any previous engine instance first.
  await stop();
  if (!workspacePath || !pat) {
    state.windowId = windowId ?? state.windowId;
    emitStatus({ status: STATUS.DISABLED, detail: pat ? 'No workspace' : 'No PAT set', lastSyncAt: null, repoUrl: null });
    return;
  }
  // Verify the workspace actually has an origin — without one, sync is a
  // no-op. Surface 'disabled' so the icon hides itself.
  const ws = await workspaceStatus(workspacePath);
  if (!ws.hasOrigin) {
    state.windowId = windowId ?? state.windowId;
    emitStatus({ status: STATUS.DISABLED, detail: 'Workspace has no remote', lastSyncAt: null, repoUrl: null });
    return;
  }
  state.running = true;
  state.workspacePath = workspacePath;
  state.pat = pat;
  state.intervalMs = Math.max(5_000, Math.min(600_000, (intervalSeconds ?? 10) * 1000));
  state.windowId = windowId ?? state.windowId;
  // Derive the GitHub web URL from the origin so the status-bar icon can
  // open the repo in a browser. Non-GitHub remotes parse to null and the
  // status payload carries null (renderer just renders the icon static).
  const parsed = parseGithubUrl(ws.originUrl);
  const repoUrl = parsed ? `https://github.com/${parsed.owner}/${parsed.repo}` : null;
  emitStatus({ status: STATUS.IDLE, detail: '', lastSyncAt: null, repoUrl });
  // First tick fires immediately (so workspace switch picks up remote
  // changes without waiting up to 10s), then on the interval.
  state.intervalHandle = setInterval(runTick, state.intervalMs);
  // Don't await — let it run in the background and update status events.
  runTick().catch((err) => {
    emitStatus({ status: STATUS.ERROR, detail: `Tick failed: ${err.message}` });
  });
}

export async function stop() {
  if (state.intervalHandle) {
    clearInterval(state.intervalHandle);
    state.intervalHandle = null;
  }
  state.running = false;
  // Let any in-flight tick finish so we don't leave a partial commit/push.
  if (state.pendingTickPromise) {
    await state.pendingTickPromise.catch(() => {});
  }
  state.workspacePath = null;
  state.pat = null;
  emitStatus({ status: STATUS.DISABLED, detail: '', lastSyncAt: currentStatus.lastSyncAt, repoUrl: null });
}

/** Called from `before-quit` to drain any in-flight tick before app exits. */
export async function drainBeforeQuit() {
  if (state.intervalHandle) {
    clearInterval(state.intervalHandle);
    state.intervalHandle = null;
  }
  state.running = false;
  if (state.pendingTickPromise) {
    await state.pendingTickPromise.catch(() => {});
  }
}
