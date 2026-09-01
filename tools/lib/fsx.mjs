import fs from 'node:fs';
import path from 'node:path';

/** Files that should never be copied into a built pack. */
const IGNORED_NAMES = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini']);

export function rmrf(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

export function exists(p) {
  return fs.existsSync(p);
}

/**
 * Recursively copies `src` into `dest`, skipping editor/OS junk. Returns the
 * number of files copied.
 */
export function copyDir(src, dest) {
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

/** Lists every file under `dir` as a path relative to `dir`. */
export function listFiles(dir, prefix = '') {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (IGNORED_NAMES.has(entry.name)) continue;
    const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      out.push(...listFiles(path.join(dir, entry.name), relPath));
    } else if (entry.isFile()) {
      out.push(relPath);
    }
  }
  return out;
}
