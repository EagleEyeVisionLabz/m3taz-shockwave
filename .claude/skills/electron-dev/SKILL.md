---
name: electron-dev
description: Use whenever working on this Electron + Vite app. Covers the two-process model, running the dev script, when (rarely) to restart Electron, where main vs renderer logs land, attaching to the renderer via Chrome DevTools Protocol on :9222 for headless debugging, and the IPC discipline that prevents the file-watcher gotcha that bit us once.
---

# Electron development workflow

This app uses **electron-vite** (community-standard tooling for Vite + Electron). Three processes; one config (`electron.vite.config.js`); one dev command. Read this before touching anything in `electron/` or any IPC code.

## Process model (1-line recap)

- **Main** (Node.js): `electron/main.js` — owns filesystem, dialogs, windows, IPC handlers, the chokidar file watcher, the pi coding agent, AI streaming.
- **Preload** (Node, contextIsolated): `electron/preload.cjs` — exposes a `window.api` surface to the renderer via `contextBridge`. The ONLY allowed bridge between renderer and Node.
- **Renderer** (Chromium + React): `src/` — UI. No direct Node access.

## Running

```bash
npm run dev   # electron-vite dev --watch --remoteDebuggingPort=9222
```

This single command:
- Builds main → `out/main/index.js` and watches `electron/main.js` (+imports).
- Builds preload → `out/preload/index.cjs` and watches `electron/preload.cjs`.
- Serves the renderer from Vite at `http://localhost:5173/` with Fast Refresh.
- Launches Electron with `--remote-debugging-port=9222` (CDP open for you to attach to the renderer — see below).
- On `electron/**` edits: rebuilds the affected bundle and **automatically restarts Electron** (main) or **reloads the renderer** (preload).

**You should almost never need to manually restart `npm run dev`.** If you find yourself tempted to, the right question is *why is the auto-reload not picking it up?* — not *let me kill and relaunch.* "Restart and try again" is not a debugging strategy here (see "Anti-patterns" below).

## Where logs land

- **Main-process** `console.log` → stdout of `npm run dev`. If the dev script is running in a background task, read the task's output file (`tail -n 100 /tmp/.../<task-id>.output`).
- **Renderer** `console.log` → DevTools console in the Electron window (Cmd+Opt+I; this app auto-opens detached DevTools in dev). You can also read it programmatically over CDP — see next section.

## Reading and driving the renderer via CDP (no GUI needed)

`npm run dev` exposes Chrome DevTools Protocol on `http://localhost:9222`. You can query it from Bash. The renderer page lives alongside the DevTools page in `/json`.

**List pages:**

```bash
curl -s http://localhost:9222/json | python3 -c "import json,sys; print(json.dumps([{'title':p['title'],'url':p['url'][:80]} for p in json.load(sys.stdin)], indent=2))"
```

**Evaluate JS in the renderer** (e.g. inspect React-visible state, check `window.api`, query DOM):

```bash
node --input-type=module -e "
const r = await fetch('http://localhost:9222/json');
const app = (await r.json()).find(p => p.url.includes('localhost:5173'));
const ws = new WebSocket(app.webSocketDebuggerUrl);
let id = 0; const pending = new Map();
ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const eval_ = (expr) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method: 'Runtime.evaluate', params: { expression: expr, returnByValue: true, awaitPromise: true } })); });
await new Promise(r => ws.addEventListener('open', r, { once: true }));
const out = await eval_('JSON.stringify({title: document.title, fileCount: document.querySelectorAll(\".tree-name\").length})');
console.log(out.result.result.value);
ws.close(); process.exit(0);
"
```

**Read renderer console output** by subscribing to `Runtime.consoleAPICalled` events after `Runtime.enable`. Use this when you suspect the renderer is logging something useful but you can't see DevTools.

**Pattern for end-to-end smoke tests**: trigger a side effect from the test process (e.g. write a file in the workspace), poll the renderer DOM via CDP eval, assert. This is how we proved the file-watcher fix without touching the UI.

## IPC discipline

Subscribe-once-per-scope. Use refs for dynamic state. The watcher listener in `App.jsx:651` is the canonical example — its `useEffect` depends ONLY on `workspacePath`. All callbacks it needs (`linkIndex`, `refreshTree`, `renameTabsPath`, `showError`) are accessed via refs that are kept current by separate effects.

**Why this matters (real bug we hit):** if you put `linkIndex` in the listener's `useEffect` deps and `linkIndex` is a fresh object each render, the listener tears down on every state change. If the listener mutates state synchronously (e.g. `linkIndex.bump()`) it can kill its own follow-up timers via the very cleanup the dep change triggers. External `.md` adds will silently never refresh the sidebar. This is a textbook IPC-in-React mistake; the fix is refs.

Subscribe like this:

```js
const fooRef = useRef(foo);
useEffect(() => { fooRef.current = foo; }, [foo]);

useEffect(() => {
  if (!scopeKey) return;
  const unsub = window.api.someEvent.subscribe(evt => {
    const foo = fooRef.current;  // always current
    // ... handle
  });
  return () => unsub();
}, [scopeKey]);  // listener lifetime = scope lifetime, NOT render lifetime
```

## Debugging philosophy

**Instrument before guessing.** When something doesn't work:

1. Add a one-line log at each boundary the event crosses: chokidar callback → main flush → IPC send → renderer listener → state-update → DOM. Find which boundary it dies at.
2. Use CDP to inspect renderer state and the DOM without restarting anything.
3. Once you have the answer, remove the logs.

**Anti-pattern: "restart and see if it goes away."** If a restart fixes a bug, the bug is still there — you've just moved it. Find the actual cause. Today's file-watcher bug looked like "stale state cured by restart" but was a real synchronous-cleanup race in a `useEffect`. Restarting *masked* it; finding it required CDP-driven instrumentation.

**Anti-pattern: speculating from the symptom.** When pi's writes weren't showing up, the first three hypotheses (chokidar broken / IPC dropping / react-arborist not re-rendering) were all wrong. The actual answer came only after watching events at every boundary.

## Path / layout reference

| Source | Built to | Loaded by |
|---|---|---|
| `electron/main.js` | `out/main/index.js` | Electron entry (`package.json` `main`) |
| `electron/preload.cjs` | `out/preload/index.cjs` | `webPreferences.preload` in `main.js` (`__dirname/../preload/index.cjs`) |
| `src/index.html` + JS | `out/renderer/` | dev: Vite at :5173; prod: `loadFile(__dirname/../renderer/index.html)` |

`__dirname` in main at runtime is `<project>/out/main/` in dev and `<app.asar>/out/main/` in prod. Asset paths in `main.js` (e.g. icon) must be two levels up: `path.join(__dirname, '..', '..', 'build', 'icon.png')`.

## When to actually restart Electron

The only legitimate reasons:
- You changed `package.json` `dependencies` (electron-vite watches code, not installed packages).
- You changed `electron.vite.config.js` itself.
- You changed `package.json` `main` field.

In those cases: stop the dev task and `npm run dev` again. Otherwise, edit and watch the rebuild happen.

## Anti-patterns to refuse

- **`--no-sandbox`** or **disabling `contextIsolation`/`nodeIntegration`** — security regression, never required for this app.
- **Reaching for `nodemon`** — electron-vite handles main-process watching natively. Don't layer extra tooling.
- **Polling the filesystem from the renderer** — the watcher already pushes events; if they're not arriving, fix the watcher, don't bypass it.
- **`pkill -f electron` blindly** — kills VS Code, other Electron apps. Use the dev script's stop mechanism (or `TaskStop` if launched as a background task).
