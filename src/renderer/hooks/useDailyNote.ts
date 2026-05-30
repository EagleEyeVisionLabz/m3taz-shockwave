import { useState, useCallback } from 'react';
import type { MutableRefObject } from 'react';
import { formatDailyNote, resolveDailyNotePath } from '../dailyNote.js';

interface DailyNoteConfig {
  format: string;
  folder: string;
}

interface UseDailyNoteOpts {
  workspacePath: string | null;
  // Read via ref so openJournal always sees the latest format/folder without
  // being rebuilt when the setting changes.
  dailyNoteRef: MutableRefObject<DailyNoteConfig>;
  writeNow: () => Promise<unknown>;
  openInActiveTab: (path: string) => Promise<unknown> | unknown;
  linkIndex: {
    pageIndexRef: MutableRefObject<Map<string, string>>;
    updateFile: (path: string, text: string, mtime: number) => void;
  };
  fileOps: { treeAndIndexChanged: () => Promise<unknown> };
  showError: (msg: string) => void;
}

// Daily notes: the calendar date-picker anchor + openJournal, which opens (or
// creates) the daily note for a date using the user's configured format/folder.
export function useDailyNote({
  workspacePath,
  dailyNoteRef,
  writeNow,
  openInActiveTab,
  linkIndex,
  fileOps,
  showError,
}: UseDailyNoteOpts) {
  // Anchor for the JournalDatePicker popover ({x, y} on right-click, else null).
  const [journalPickerAnchor, setJournalPickerAnchor] = useState<{ x: number; y: number } | null>(null);

  // openJournal(date?) — opens (or creates) the daily note for `date` (default
  // today) using the user's configured format + folder. If the format contains
  // "/" the leading segments become subfolders. Existing notes are opened in
  // place regardless of where they live (basename uniqueness is workspace-wide).
  const openJournal = useCallback(async (date?: Date) => {
    if (!workspacePath) return;
    const d = date ?? new Date();
    const dn = dailyNoteRef.current;
    const formatted = formatDailyNote(dn.format, d);
    if (!formatted) {
      showError('Daily note format is invalid. Open Settings → Daily Note to fix it.');
      return;
    }
    const { dir, name } = resolveDailyNotePath(workspacePath, dn.folder, formatted);
    try {
      await writeNow();
      const existing = linkIndex.pageIndexRef.current.get(name.toLowerCase());
      if (existing) {
        await openInActiveTab(existing);
        return;
      }
      await window.api.ensureDir(dir);
      const { path: newPath, mtime } = await window.api.createFile(dir, `${name}.md`, '');
      linkIndex.updateFile(newPath, '', mtime);
      await fileOps.treeAndIndexChanged();
      await openInActiveTab(newPath);
    } catch (err: any) {
      showError(err.message ?? String(err));
    }
  }, [workspacePath, dailyNoteRef, writeNow, linkIndex, openInActiveTab, fileOps, showError]);

  return { journalPickerAnchor, setJournalPickerAnchor, openJournal };
}
