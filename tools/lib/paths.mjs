import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Absolute path to the repository root. */
export const repoRoot = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

export const addonsDir = path.join(repoRoot, 'addons');
export const sharedDir = path.join(repoRoot, 'shared');
export const distDir = path.join(repoRoot, 'dist');
export const packagesDir = path.join(distDir, '_packages');
export const templateDir = path.join(repoRoot, 'tools', 'template');

/** Formats an absolute path relative to the repo root, for tidy log output. */
export function rel(p) {
  const r = path.relative(repoRoot, p);
  return r === '' ? '.' : r;
}
