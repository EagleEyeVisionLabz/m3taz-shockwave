// Node `--require` preload for running the bundled CLIs under ELECTRON_RUN_AS_NODE.
//
// The app ships no system Node; the CLIs run with the app's own Electron binary
// in Node mode. commander-based CLIs (firecrawl) auto-detect
// `process.versions.electron` (still set under run-as-node) and, with
// `process.defaultApp` undefined, mis-slice argv by one — turning the script
// path into a bogus subcommand ("too many arguments" / "unknown command").
// Hiding the electron version makes them use normal Node argv slicing.
//
// This is loaded via NODE_OPTIONS=--require (not a wrapper entry) ON PURPOSE:
// NODE_OPTIONS is inherited by child processes, so any process a CLI re-execs —
// e.g. playwright-cli's background browser *daemon*, which spawns the app binary
// again — also gets the fix. A wrapper-entry approach (boot.js) only covered the
// top-level invocation and left the daemon broken.
try {
  Object.defineProperty(process.versions, 'electron', { value: undefined, configurable: true });
} catch {
  try { process.versions.electron = undefined; } catch { /* frozen; best effort */ }
}
