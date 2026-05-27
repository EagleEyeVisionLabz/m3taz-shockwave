---
name: electron-dev
description: Use this to test, debug, or verify the running Electron app from the command line — ready-to-paste CDP scripts to query renderer state on :9222, read main and renderer logs, drive end-to-end smoke tests without opening DevTools, and decide when (rarely) to restart the dev server vs. instrument.
---

# Driving the running Electron app

`npm run dev` exposes Chrome DevTools Protocol on `http://localhost:9222`. You can query the renderer, evaluate JS in it, and read its console — all from Bash, no GUI needed. This is how to verify a change actually works in the running app without watching it by hand.

For architecture and IPC discipline, read the root `CLAUDE.md`, `src/main/CLAUDE.md`, and `src/renderer/CLAUDE.md`. This skill is only about operating the running app.

## Where logs land

- **Main-process** `console.log` → stdout of `npm run dev`. If the dev script runs as a background task, read the task's output file (`tail -n 100 /tmp/.../<task-id>.output`).
- **Renderer** `console.log` → DevTools console (Cmd+Opt+I; this app auto-opens detached DevTools in dev). Or programmatically over CDP — see below.

## Querying the renderer via CDP

**List pages:**

```bash
curl -s http://localhost:9222/json | python3 -c "import json,sys; print(json.dumps([{'title':p['title'],'url':p['url'][:80]} for p in json.load(sys.stdin)], indent=2))"
```

**Evaluate JS in the renderer** — inspect React state, check `window.api`, query the DOM:

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

**Read renderer console output**: subscribe to `Runtime.consoleAPICalled` events after `Runtime.enable`. Use this when you suspect the renderer is logging something useful but you can't see DevTools.

## End-to-end smoke test pattern

Trigger a side effect from your test process (write a file in the workspace, send an IPC, drop something into the active window), poll the renderer DOM via CDP eval, assert. This is how we proved the file-watcher fix without touching the UI.

## When to actually restart Electron

`npm run dev` rebuilds and reloads on edits to `src/main/**`, `src/preload/**`, and `src/renderer/**` automatically. **You should almost never need to manually restart.** Legitimate reasons:

- You changed `package.json` `dependencies` (electron-vite watches code, not installed packages).
- You changed `electron.vite.config.js` itself.
- You changed `package.json` `main` field.

In those cases: stop the dev task and `npm run dev` again. Otherwise, edit and watch the rebuild happen.

## Debugging philosophy

**Instrument before guessing.** When something doesn't work:

1. Add a one-line log at each boundary the event crosses: chokidar callback → main flush → IPC send → renderer listener → state-update → DOM. Find which boundary it dies at.
2. Use CDP to inspect renderer state and the DOM without restarting anything.
3. Once you have the answer, remove the logs.

**Anti-pattern: "restart and see if it goes away."** If a restart fixes a bug, the bug is still there — you've just moved it. Find the actual cause. The original file-watcher bug looked like "stale state cured by restart" but was a real synchronous-cleanup race in a `useEffect` (see "Renderer-side `fs:changed` listener discipline" in `src/renderer/CLAUDE.md`). Restarting *masked* it; finding it required CDP-driven instrumentation.

**Anti-pattern: speculating from the symptom.** When external file changes weren't showing up in the sidebar, the first three hypotheses (chokidar broken / IPC dropping / react-arborist not re-rendering) were all wrong. The answer came only after watching events at every boundary.

## Path / layout reference

| Source | Built to | Loaded by |
|---|---|---|
| `src/main/main.js` | `out/main/index.js` | Electron entry (`package.json` `main`) |
| `src/preload/preload.cjs` | `out/preload/index.cjs` | `webPreferences.preload` in `main.js` |
| `src/renderer/index.html` + JS | `out/renderer/` | dev: Vite at :5173; prod: `loadFile(out/renderer/index.html)` |

`__dirname` in main at runtime is `<project>/out/main/` in dev and `<app.asar>/out/main/` in prod. Asset paths in `main.js` (e.g. icon) must be two levels up: `path.join(__dirname, '..', '..', 'build', 'icon.png')`.

## Anti-patterns to refuse

- **`--no-sandbox`** or **disabling `contextIsolation`/`nodeIntegration`** — security regression, never required for this app.
- **Reaching for `nodemon`** — electron-vite handles main-process watching natively. Don't layer extra tooling.
- **Polling the filesystem from the renderer** — the watcher already pushes events; if they're not arriving, fix the watcher, don't bypass it.
- **`pkill -f electron` blindly** — kills VS Code, other Electron apps. Use the dev script's stop mechanism (or `TaskStop` if launched as a background task).
