import fs from 'node:fs';
import path from 'node:path';

/** Files that should never be copied into a built pack. */
const IGNORED_NAMES = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini']);

export function rmrf(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

export function exists(p: string): boolean {
  return fs.existsSync(p);
}

/**
 * Recursively copies `src` into `dest`, skipping editor/OS junk. Returns the
 * number of files copied.
 */
export function copyDir(src: string, dest: string): number {
  let count = 0;
  ensureDir(dest);
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (IGNORED_NAMES.has(entry.name)) continue;
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      count += copyDir(from, to);
    } else if (entry.isFile()) {
      fs.copyFileSync(from, to);
      count++;
    }
  }
  return count;
}
