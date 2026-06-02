# Built-in skills + bundled CLI tools — design

Status: **BUILT + verified in dev (2026-06-01)** on branch `builtin-skills-and-cli-tools`. See "Implementation as built" below for where the code diverged from the original design.

## Implementation as built (2026-06-01)

All four slices implemented and verified against the running dev app (CDP) including a real agent turn:

- **Slice 1 — skills scopes.** `skills.builtin` map added; `global-skills/` dir; `skillLibrary.listInstalled(userDataDir, builtinDir)` scans both, tags `source`; `computeEffectivePaths` is default-on for built-ins + global-wins cascade. Built-ins ship via `extraResources` from `resources/built-in-skills/`. Verified: `skills.list()` returns `firecrawl-cli:builtin`, `playwright-cli:builtin`, `content-strategy:global`.
- **Slice 2 — CLI runtime.** Self-contained `cli-tools/` (own `node_modules`, gitignored, populated by root `postinstall`); bundled via `files` + `asarUnpack`. `src/main/cliTools.ts` generates `firecrawl`/`playwright-cli` shims into `<userData>/pi-agent/bin` at launch and prepends to `process.env.PATH`. **Divergence:** the per-process `boot.js` loader was replaced by a `NODE_OPTIONS=--require cli-tools/preload.js` preload — because `playwright-cli open` spawns a background **daemon** by re-execing the binary, and only an *inherited* env var (NODE_OPTIONS) reaches that child; `boot.js` left the daemon broken with an argv mis-parse. Verified: real agent turn ran `playwright-cli --version` → `0.1.13` and `firecrawl --version` → `1.19.0`, **with the global Homebrew CLIs uninstalled** (so the bundled shim is genuinely exercised).
- **Slice 3 — secrets.** SKILL.md `required-secrets:` frontmatter → `skillLibrary` surfaces `requiredSecrets` → `ensureBuiltinSecretSlots()` (main, awaited before window open) provisions an empty slot per declared secret of each enabled built-in; re-adds if deleted, never overwrites a filled value. Bundled firecrawl skill auth section rewritten to use the agent secret (no `login`/`npm`). Verified: deleted `FIRECRAWL_API_KEY`, restarted → re-added empty, no duplicate.
- **Slice 4 — Playwright browser.** `PLAYWRIGHT_BROWSERS_PATH` → `<userData>/ms-playwright`; the skill instructs the agent to run `playwright-cli install-browser chromium --only-shell` on first use (lazy, no root). Verified: fresh install into the app cache + headless `open` works.
- **UI:** **Built-in Skills is its own Settings screen** (`BuiltinSkillsTab`, nav between Agent Chat and Global Skills) — not mixed into Global Skills. Workspace Skills keeps two sections (Built-in / Global) for per-workspace overrides.

The sections below are the original design narrative; where they say `boot.js`, the built code uses the `preload.js` + `NODE_OPTIONS` approach above.

---

Original status: design agreed (2026-06-01). First targets: `firecrawl-cli` and `playwright-cli` as built-in skills, with their CLI binaries bundled in the app.

## Goal

Ship a set of default ("built-in") skills with Shockwave, plus the CLI tools those skills drive, so a **non-technical user on macOS / Windows / Linux** gets them working with **no Node, no npm, no global install, and no root** — and can still disable a built-in or override it with their own upload.

---

## 1. Skills model — built-in vs global

Two **scopes**, one enable/disable machinery:

- **built-in** — bundled with the app, read directly from the app bundle (NOT copied to disk). Fixed set per app version. Default **on**. Can be disabled; cannot be deleted. On-disk: `resources/built-in-skills/` (repo) → `process.resourcesPath/built-in-skills` (packaged).
- **global** — the userData `global-skills/` dir. User adds/removes their own. Enabled on import (today's behavior).

### Naming

| Concept | Location |
|---|---|
| built-in skills (bundled) | `resources/built-in-skills/` (dev) / `process.resourcesPath/built-in-skills` (packaged) |
| global skills (user) | `<userData>/pi-agent/global-skills/` — **renamed from `skill-library/`** |

The userData dir is renamed `skill-library` → `global-skills` to mirror `built-in-skills`. **No migration** (per decision): code points at the new name; any existing dev data under the old name is orphaned and re-added by hand. Touches `skillLibrary.ts` (`libraryDirFor`), the main `CLAUDE.md` references, and the `skills:libraryDir` IPC consumers.

**Cascade:** when we compile the final list of enabled skill paths for the agent, if the same name exists in both scopes, **global wins** (a user upload shadows the built-in of the same name).

### Why no copy

Reading built-ins straight from the bundle means **upgrades are free** — a new app version ships new skill text, nothing on disk to migrate or clobber, no "resurrect after delete" problem. (The earlier "copy into the library on first run" idea was rejected for exactly these reasons.)

### Settings schema

Scoping already exists today:

```ts
codingAgent.skills = {
  global:     Record<string /*folderName*/, 'enabled' | 'disabled'>,
  workspaces: Record<string /*wsId*/, Record<string /*folderName*/, 'inherit' | 'enabled' | 'disabled'>>,
}
```

Add a sibling map for built-ins (keyed by folder name):

```ts
codingAgent.skills.builtin = Record<string, 'enabled' | 'disabled'>   // absent => enabled (default-on)
```

`workspaces` overrides already generalize to any key, so they cover built-ins with no change. Update `DEFAULT_SETTINGS`, the `readSettings` deep-merge in `main.ts`, and the `useSettings` slice.

### Code touch points

- `skillLibrary.ts`
  - `libraryDirFor()` — renamed target: `<userData>/pi-agent/global-skills/` (was `skill-library/`).
  - `builtinSkillsDir()` — returns `process.resourcesPath/built-in-skills` when packaged, `resources/built-in-skills/` in dev. (`app.isPackaged` switch.)
  - `listInstalled()` — scan **both** the built-in dir and the global-skills dir; tag each result `source: 'builtin' | 'global'`.
  - `computeEffectivePaths()` — include enabled built-ins (default-on); dedupe by name with **global winning**.
- Renderer
  - A **Built-in** section/tab: lists built-ins, toggle on/off, **no delete**.
  - Global tab stays the "add / manage your own" surface.
  - Workspace Skills tab gets **two sections** (Built-in, Global), each with the existing `inherit/enabled/disabled` override.

### Source of truth

The two skill folders must live **in the repo** at `resources/built-in-skills/{firecrawl-cli,playwright-cli}/` and be bundled via electron-builder `extraResources` → `built-in-skills`. They currently exist only in runtime userData; step one of building is committing them to the repo. We maintain **our own lightly-patched copies** (see §4 — auth section rewritten for the Shockwave context).

---

## 2. CLI tools — bundle + Electron-as-node + PATH shims

Users won't have Node. **The app already ships a Node runtime: the Electron binary itself.** Running it with `ELECTRON_RUN_AS_NODE=1` turns it into a normal Node process.

**Verified on macOS arm64:** `ELECTRON_RUN_AS_NODE=1 <Electron> <cli-entry.js> --version` ran both `@playwright/cli` (0.1.13) and `firecrawl-cli` (1.19.0) cleanly using the project's bundled Electron (embeds Node v24.15.0). Both CLIs are pure-JS at the package level (firecrawl deps: `firecrawl`, `commander`, `inquirer` — no native addons; playwright's heavy part is the browser, handled in §3).

`ELECTRON_RUN_AS_NODE` is documented cross-platform (no platform tag in Electron's env-vars doc, unlike the Windows/Linux-only vars) and is the **same mechanism Electron's own `child_process.fork` uses internally** on all three OSes — so it's battle-tested, not a fringe feature.

### Wiring

1. **Bundle** each CLI **as a normal `dependency` — exactly how `@earendil-works/pi-coding-agent` is already bundled and run as Node today.** Add `@playwright/cli` + `firecrawl-cli` to `dependencies`; electron-builder bundles them into the app's `node_modules` (inside `app.asar`) automatically. Then mark those two package trees (and their transitive deps) **`asarUnpack`** so they land as real files in `app.asar.unpacked/` — required because the CLIs do real filesystem work / spawn child processes, which the virtual asar fs can't fully serve (pi works *in-asar* only because it's pure in-process JS). Shims point at the unpacked entry.

   **Verified (Stage B, executed — not reasoned):** built a packaged `.app` with a self-contained `cli-tools/` dir in `files` + `asarUnpack: ["cli-tools/**"]`. The complete tree (incl. hoisted `playwright-core`) landed in `app.asar.unpacked/cli-tools/node_modules/`, and run-as-node from the **packaged binary** executed both CLIs from there — `firecrawl --version`, the commander subcommand `firecrawl search` (via `boot.js`), `playwright-cli snapshot --help` — including through generated shims under a minimal-env bash. The **self-contained `cli-tools/` dir** (isolated `npm install`, its own `node_modules`) is the recommended packaging shape: it sidesteps having to enumerate every hoisted transitive dep in the `asarUnpack` glob. (Bundling as top-level `dependencies` also works since run-as-node reads from `app.asar`, but then the `asarUnpack` glob must cover the full hoisted closure.)

   **Rejected approach (don't do this):** shipping the CLI `node_modules` as a separate `extraResources` dir — electron-builder **strips `node_modules` out of `extraResources`** (Stage B: only `boot.js` + manifests shipped). That dead-end briefly led to a tarball-extract-to-userData workaround; the dependency + `asarUnpack` path above is the correct, standard mechanism and needs no tarball, no first-run extraction.
2. **At launch (main process), generate a shim per CLI** into a user-writable dir (`<userData>/pi-agent/bin/`), named exactly `firecrawl` and `playwright-cli` (the skill frontmatter expects those command names). The shim execs `process.execPath` with `ELECTRON_RUN_AS_NODE=1` pointed at a small bundled **bootstrap loader** (`boot.js`), passing the real CLI entry via env.
   - POSIX (`firecrawl`): `#!/bin/sh` + `exec env ELECTRON_RUN_AS_NODE=1 __SW_ENTRY="<entry.js>" "<electron>" "<boot.js>" "$@"`, `chmod +x`.
   - Windows (`firecrawl.cmd`): `set ELECTRON_RUN_AS_NODE=1` + `set __SW_ENTRY=<entry.js>` + `"<electron>" "<boot.js>" %*`.
   - Resolve the entry from each package's `package.json` `bin`, not a hardcoded path. Regenerate every launch (absolute paths change per install/version). Quote everything (spaces in install paths).

   **Why the bootstrap loader (verified in the Stage A spike, 2026-06-01):** raw argv under `ELECTRON_RUN_AS_NODE` is normal Node layout `[execPath, scriptPath, ...args]`, so plain `slice(2)` CLIs (`@playwright/cli`) work with no fix. But `commander`-based CLIs (`firecrawl-cli`) auto-detect `process.versions.electron` (still set under run-as-node) and, with `process.defaultApp` undefined, mis-slice argv by 1 → the script path becomes a bogus subcommand (`unknown command '.../index.js'`). The loader hides that:
   ```js
   // boot.js — make a commander CLI treat run-as-node like plain Node
   try { Object.defineProperty(process.versions, 'electron', { value: undefined, configurable: true }); }
   catch { try { process.versions.electron = undefined; } catch {} }
   require(process.env.__SW_ENTRY);
   ```
   One loader covers both current CLIs and any future commander-based one.
3. **Prepend the shim dir to `process.env.PATH`** at startup. Verified: pi's bash tool spawns with `env: { ...process.env, … }` (`pi-coding-agent/.../bash.js` + `getShellEnv()`), so the agent's shell children inherit our PATH. Nothing in our code touches `process.env` today.

### Cross-OS / permissions / signing

- **No system Node, no npm, no global install, no root** for the CLIs themselves.
- **Code signing:** we run our *own already-signed* Electron binary — nothing new to notarize. (A separately-bundled `node`/`pkg` binary would need its own signing/notarization; this avoids that.)
- Keep the `runAsNode` Electron **fuse enabled** (default on) — if disabled, `ELECTRON_RUN_AS_NODE` is silently ignored and the whole approach breaks.
- **Failure mode to avoid:** spawning `process.execPath` *without* `ELECTRON_RUN_AS_NODE=1` launches a whole new copy of the app (the "recursive launch" bug). The shim sets it explicitly.

---

## 3. Playwright browser — Plan A: lazy headless-shell

Playwright drives a browser; the default `playwright-cli open` uses Playwright's **own bundled Chromium**, which is a separate download (not in the npm package). Sizes (mac arm64): full Chromium ≈ 122 MB, **headless-shell ≈ 77 MB**.

**Plan A (chosen):** provision the **headless-shell**, **lazily** — only the first time the Playwright skill is actually used:

- Run the bundled installer via Electron-as-node: `playwright-cli install-browser chromium --only-shell` with `PLAYWRIGHT_BROWSERS_PATH=<userData>/ms-playwright`.
- **No root, all platforms** — verified the browser cache is user-owned and `--with-deps` (the root-requiring step) is opt-in and we don't run it.
- **Linux caveat:** the headless-shell needs a few system shared libs (libnss3, etc.) to *launch*. Present on typical desktop Linux (which has a browser); on a bare system, launch can fail with a missing-lib error and the fix (`--with-deps`) needs root. The *download* is always root-free; only Linux *launch* on a lib-less box is at risk. Detect and surface a clear message there.
- **macOS:** test that the downloaded Chromium isn't Gatekeeper-quarantined when our process launches it (files we write programmatically generally aren't quarantined, but confirm on a real build).

**Plan B (deferred optimization): "use installed Chrome if present, else headless-shell."** `playwright-cli open --browser chrome` drives the user's installed Google Chrome with **zero download**. But the *default* `open` won't auto-prefer system Chrome — something must pass `--browser chrome`. Cleanest would be writing a default into the `.playwright/cli.config.json` that `open` reads — **only if that config supports a default browser/channel (schema unverified).** If it doesn't, Plan B means relying on the agent to pass the flag (fragile). Revisit after confirming the config schema.

---

## 4. Secrets — built-in skills declare what they need

**Verified:** firecrawl authenticates from the `FIRECRAWL_API_KEY` **environment variable alone** — `FIRECRAWL_API_KEY=… firecrawl --status` prints `● Authenticated via FIRECRAWL_API_KEY` (no `login`, no OAuth, no config file needed).

End-to-end key flow (reuses the existing agent-secrets + `get_agent_secret` machinery):

1. The built-in skill **declares the secret(s) it needs** (`FIRECRAWL_API_KEY`).
2. When that built-in is **enabled**, Shockwave **ensures the declared secret slot exists** in Settings → Agent Secrets, labeled with which skill needs it. **Always re-add the slot when the built-in is enabled** (on launch and on toggle-to-enabled) — if the user previously deleted it, it comes back empty. **Never overwrite a value the user already filled** (re-add only when missing). Disabling the built-in does not delete an existing slot (the key may be shared / the user may want to keep it).
3. **User pastes their key** into the slot — the one irreducibly-manual step.
4. The agent reads it via `get_agent_secret("FIRECRAWL_API_KEY")` and runs `FIRECRAWL_API_KEY=<key> firecrawl …`, passing it to **that one subprocess** (not the global env). The system prompt already instructs "pass the token via env vars to the subprocess that needs it."

This is the **bridge between the skills feature and the secrets feature**: built-in skills declare required secrets; Shockwave provisions the (empty) slots.

**Patch to our bundled firecrawl skill:** upstream `rules/install.md` tells the agent to `firecrawl login --browser` (OAuth) and `npm install -g` — both wrong for the packaged context. Our bundled copy rewrites the auth section to: *"the key is provided as agent secret `FIRECRAWL_API_KEY`; read it with `get_agent_secret` and pass it as an env var; do not run `firecrawl login` or `npm install`."* This is static text (same for everyone), so it's compatible with the no-per-machine-templating constraint of read-only built-ins.

Alternative considered: Shockwave globally injecting `FIRECRAWL_API_KEY` into the agent's environment. Simpler for the tool, but exposes the key to every command the agent runs and breaks the `get_agent_secret` discipline. Rejected in favor of the agent-mediated, per-subprocess approach above.

---

## 5. First-run / lifecycle

Follow the existing **materialize-on-boot** pattern (`agentTokensExtension.ts` already writes its file into userData every launch):

- **Shims** regenerated into `<userData>/pi-agent/bin/` on every launch, with absolute paths re-resolved to: the unpacked CLI entry under `app.asar.unpacked/node_modules/...`, `process.execPath` (the app's own signed binary), and the bundled `boot.js`. PATH prepended. (No CLI extraction step — the CLIs ship as unpacked app dependencies, not as a userData payload.)
- **Built-in skills** read from the bundle at the path `builtinSkillsDir()` returns — never copied, so always current with the app version.
- **Browser** provisioned lazily on first Playwright use (§3).
- **Secret slots** for declared-but-missing secrets ensured on launch / when a built-in is enabled.

No installer-time hooks (none exist cross-platform for dmg/AppImage); everything happens at app launch.

---

## Code signing & notarization — cross-platform verdict

The central fear was: does `ELECTRON_RUN_AS_NODE` (running the app's own signed binary as Node) **silently break once the app is signed/notarized for distribution** — a catastrophic late discovery? Researched answer (2026-06-01, sources below): **No. It works on all three platforms, and cannot silently fail post-signing.**

**Why it can't fail-after-signing:** the `runAsNode` Electron **fuse** is **enabled by default**, and fuses are **flipped at package time *before* code-signing**, after which the OS enforces the sealed state (Gatekeeper / AppLocker). So a signed build that works once works for every user. The only way to break it is to *deliberately* set `runAsNode: false` — so the guardrail is simply: **never disable `runAsNode`**, and run the feature in a signed/notarized CI build to confirm.

**Clinching precedent:** **VS Code ships this exact pattern in production** — its extension host is the signed Electron binary re-invoked as Node — notarized on macOS, Authenticode-signed on Windows.

| Platform | Verdict | Required config |
|---|---|---|
| **macOS** (notarized, hardened runtime) | **Works** | `hardenedRuntime: true` + electron-builder's **default** entitlements: `com.apple.security.cs.allow-jit`, `…allow-unsigned-executable-memory`, `…disable-library-validation` (as both `entitlements` and `entitlementsInherit`). Leave `runAsNode` ON. `com.apple.security.inherit` is **NOT** needed (App-Store-sandbox only). The run-as-node child is the *same signed binary* re-invoked, so there's no second artifact to sign. |
| **Windows** (Authenticode NSIS) | **Works** | None beyond normal signing — no interference. |
| **Linux** (AppImage) | **Works** | Use the live `process.execPath` (mount path is ephemeral — never cache it across runs); pass `ELECTRON_RUN_AS_NODE=1` explicitly in the child env; don't escalate privileges (pkexec/sudo) across the spawn (breaks mount visibility). |

**Security tradeoff (accepted):** keeping `runAsNode` enabled means a local attacker *who already has code execution on the machine* can re-launch the signed app as Node and inherit its TCC/permissions ("living off the land"). Not a remote vector; the same tradeoff VS Code accepts. Electron's hardening alternative (`utilityProcess.fork`) gives a Node child without the fuse, but **not a named command on PATH**, so it doesn't fit our shell-out-by-name requirement — we stay with run-as-node shims.

**Sources:** Electron fuses (default-on, package-time seal) https://www.electronjs.org/docs/latest/tutorial/fuses · run-as-node CVE statement https://www.electronjs.org/blog/statement-run-as-node-cves · electron-builder default entitlements https://github.com/electron-userland/electron-builder/blob/master/packages/app-builder-lib/templates/entitlements.mac.plist · electron-builder Mac config (entitlementsInherit/hardenedRuntime) https://www.electron.build/electron-builder.Interface.MacConfiguration.html · osx-sign entitlement templates (inherit = MAS-only) https://github.com/electron/osx-sign/tree/main/entitlements · VS Code extension host process model https://code.visualstudio.com/api/advanced-topics/extension-host · AppImage run behavior https://docs.appimage.org/user-guide/run-appimages.html · Electron child-process deep-dive https://www.matthewslipper.com/2019/09/22/everything-you-wanted-electron-child-process.html

## Open items to verify on a real build

- ~~argv handling under run-as-node~~ **resolved (Stage A)** via the `boot.js` loader; confirmed from the packaged binary (Stage B).
- **Confirm on real signed builds** (low risk per the verdict above, but not yet exercised here): a **notarized** macOS `.dmg`, an Authenticode-signed Windows NSIS, and a Linux AppImage — each running a bundled CLI through the shim. Needs signing certs / CI; the `--dir` build used here is ad-hoc signed only.
- **`asarUnpack` globs** must cover each CLI's full transitive dep closure (deps hoist to top-level `node_modules`); verify nothing the CLI requires stays packed.
- Whether `.playwright/cli.config.json` supports a default browser/channel (gates Plan B).
- Linux system-lib presence for headless-shell launch.
- macOS Gatekeeper/quarantine on the downloaded Chromium.

## Stage B build test (2026-06-01, macOS arm64, `electron-builder --dir`, ad-hoc signed)

- ✅ **run-as-node works from the packaged binary** — real subcommands for `firecrawl` (commander, via `boot.js`) and `playwright-cli`.
- ✅ **shim + minimal-env child bash** (Finder-launch sim) runs the CLI by command name.
- ✅ **`asarUnpack` execution path tested end to end** — self-contained `cli-tools/` + `asarUnpack: ["cli-tools/**"]` → complete tree in `app.asar.unpacked/`; run-as-node from the packaged binary ran both CLIs (incl. commander subcommands via `boot.js`) through generated shims under minimal-env bash.
- ✅ **run-as-node can `require` from inside `app.asar`** (loaded the bundled pi module) → confirms the bundle path; no tarball.
- ❌ **`extraResources` of a raw dir drops `node_modules`** → don't use it for the CLI tree (the tarball detour this caused is rejected; bundle-as-dependency instead).
- ⏳ Not covered by `--dir` (ad-hoc signed): a real **notarized** macOS build + Windows/Linux builds. Risk now **low** — see the signing verdict below (researched: works on all three).

## Decisions log

- **Skills:** built-in (read from bundle, no copy) + global; cascade **global wins**; built-ins **default-on**, disable-able, not deletable.
- **CLI binaries:** bundle as normal **`dependencies`** (like pi) + **`asarUnpack`** → run via Electron-as-node (`boot.js` loader) → PATH shims; no Node/npm/root; reuse app code-signing. (Tarball/extraResources approach rejected.)
- **Signing/notarization:** works on macOS (notarized, default entitlements, `runAsNode` left on), Windows, Linux (AppImage); cannot fail-after-signing (fuse sealed pre-sign); VS Code is the production precedent.
- **Browser:** Plan A — lazy headless-shell download into userData; Plan B (system Chrome) deferred pending config-schema check.
- **Secrets:** built-in skills declare required secrets → Shockwave auto-provisions empty slots → agent reads via `get_agent_secret`, passes per-subprocess.
