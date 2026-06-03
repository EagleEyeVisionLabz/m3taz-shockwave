import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat';

// Needed for strict-parsing a basename back into a date (parseDailyNoteDate).
dayjs.extend(customParseFormat);

// Format presets shown in the Daily Note settings dropdown. The 4th entry is
// path-style — the "/" in the format becomes a folder separator on disk so
// you can bucket notes under year/month folders automatically.
export const DAILY_NOTE_FORMAT_PRESETS = [
  'YYYY-MM-DD',
  'YYYY.MM.DD',
  'YYYY/MM/DD',
  'YYYY/MM/YYYY-MM-DD',
];

export const DEFAULT_DAILY_NOTE_FORMAT = 'YYYY-MM-DD';
export const DAILY_NOTE_FORMAT_HELP_URL = 'https://day.js.org/docs/en/display/format';

// Format a JS Date using dayjs (moment-compatible tokens). Catches invalid
// formats — returns '' so the UI can show "Invalid format" rather than crash.
export function formatDailyNote(format: string, date: Date = new Date()): string {
  try {
    const out = dayjs(date).format(format || DEFAULT_DAILY_NOTE_FORMAT);
    return out;
  } catch (err) {
    if (typeof import.meta !== 'undefined' && import.meta.env?.DEV) {
      console.warn('[formatDailyNote] invalid format', { format, error: err });
    }
    return '';
  }
}

// Resolve the absolute on-disk path for a daily note. `folder` is workspace-
// relative ('' or '/' = root). `formatted` may contain "/"; the last segment
// is the basename, leading segments become subfolders.
//
// Returns { dir, name, absPath } where:
//   dir      — absolute folder the file should live in
//   name     — basename (no .md)
//   absPath  — `${dir}/${name}.md`
// Strict-parse a workspace-relative path (no `.md`, forward slashes) against the
// daily-note `format`. Returns the parsed Date if it matches cleanly, else null.
// Used to detect which files inside the daily-note folder are daily notes —
// slashes in the format are folder boundaries, so `relPathNoExt` includes any
// subdirs (e.g. '2026/06/02' against 'YYYY/MM/DD'). Strict mode rejects anything
// that isn't an exact format match, so non-daily files are filtered out.
export function parseDailyNoteDate(relPathNoExt: string, format: string): Date | null {
  if (!relPathNoExt || !format) return null;
  const m = dayjs(relPathNoExt, format, true);
  return m.isValid() ? m.toDate() : null;
}

export function resolveDailyNotePath(workspacePath: string, folder: string, formatted: string): { dir: string; name: string; absPath: string } {
  const cleanFolder = (folder ?? '').replace(/^\/+|\/+$/g, '');
  const segments = formatted.split('/').filter(Boolean);
  const name = segments.pop() || formatted;
  const subdirs = segments.join('/');

  const parts = [workspacePath];
  if (cleanFolder) parts.push(cleanFolder);
  if (subdirs) parts.push(subdirs);
  const dir = parts.join('/');
  const absPath = `${dir}/${name}.md`;
  return { dir, name, absPath };
}
