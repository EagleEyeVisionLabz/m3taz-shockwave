// Bundled CLI tools (firecrawl, playwright-cli) the coding agent shells out to.
//
// The app ships no system Node. We run each CLI with the app's own Electron
// binary in Node mode (ELECTRON_RUN_AS_NODE=1), exposed to the agent's bash as
// plain command names through small shim scripts on PATH. A NODE_OPTIONS
// `--require cli-tools/preload.js` normalizes argv for commander-based CLIs and
// — because NODE_OPTIONS is inherited — also fixes any child the CLI re-execs
// (e.g. playwright-cli's browser daemon). See cli-tools/preload.js.
//
// At launch (see main.ts) we generate the shims into <userData>/pi-agent/bin/ and
// prepend that dir to process.env.PATH. pi's bash tool spawns with `{ ...process.env }`,
// so the agent's shell inherits it. Regenerated every launch because the absolute
// paths (execPath, the unpacked cli-tools dir) change per install/version.

import path from 'node:path';
import fs from 'node:fs/promises';

// command name (what the skill's allowed-tools / the agent invokes) → npm package.
const CLIS = [
  { command: 'firecrawl', pkg: 'firecrawl-cli' },
  { command: 'playwright-cli', pkg: '@playwright/cli' },
];

// Resolve a package's bin entry file (absolute) from its package.json `bin`.
async function resolveEntry(cliToolsDir, pkg, command) {
  const pkgDir = path.join(cliToolsDir, 'node_modules', pkg);
  const manifest = JSON.parse(await fs.readFile(path.join(pkgDir, 'package.json'), 'utf8'));
  let rel;
  if (typeof manifest.bin === 'string') rel = manifest.bin;
  else if (manifest.bin && manifest.bin[command]) rel = manifest.bin[command];
  else if (manifest.bin) rel = Object.values(manifest.bin)[0];
  if (!rel) throw new Error(`No bin entry for ${pkg}`);
  return path.join(pkgDir, rel as string);
}

// Generate a shim per CLI into binDir. Returns binDir. CLIs whose package isn't
// present (e.g. a dev checkout that never ran `npm install` in cli-tools) are
// skipped rather than failing the whole boot.
export async function ensureCliShims({ cliToolsDir, binDir, execPath }) {
  await fs.mkdir(binDir, { recursive: true });
  const preload = path.join(cliToolsDir, 'preload.js');
  const isWin = process.platform === 'win32';
  const made: string[] = [];
  for (const { command, pkg } of CLIS) {
    let entry;
    try { entry = await resolveEntry(cliToolsDir, pkg, command); }
    catch { continue; }
    if (isWin) {
      const file = path.join(binDir, `${command}.cmd`);
      // %* forwards all args. NODE_OPTIONS path double-quoted so spaces survive.
      const body = `@echo off\r\nset "ELECTRON_RUN_AS_NODE=1"\r\nset NODE_OPTIONS=--require "${preload}"\r\n"${execPath}" "${entry}" %*\r\n`;
      await fs.writeFile(file, body, 'utf8');
      made.push(command);
    } else {
      const file = path.join(binDir, command);
      // NODE_OPTIONS value single-quoted with the path double-quoted inside, so
      // Node's own NODE_OPTIONS parser tolerates spaces in the app path.
      const body = `#!/bin/sh\nexec env ELECTRON_RUN_AS_NODE=1 NODE_OPTIONS='--require "${preload}"' "${execPath}" "${entry}" "$@"\n`;
      await fs.writeFile(file, body, 'utf8');
      await fs.chmod(file, 0o755);
      made.push(command);
    }
  }
  return { binDir, made };
}

// Prepend binDir to PATH (idempotent — won't stack on repeated calls).
export function prependPath(binDir) {
  const key = Object.keys(process.env).find((k) => k.toLowerCase() === 'path') ?? 'PATH';
  const cur = process.env[key] ?? '';
  const parts = cur.split(path.delimiter).filter(Boolean);
  if (!parts.includes(binDir)) {
    process.env[key] = [binDir, cur].filter(Boolean).join(path.delimiter);
  }
}
