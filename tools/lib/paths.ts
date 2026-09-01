import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Absolute path to the repository root. */
export const repoRoot = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

export const addonsDir = path.join(repoRoot, 'addons');
export const sharedDir = path.join(repoRoot, 'shared');
export const distDir = path.join(repoRoot, 'dist');
export const packagesDir = path.join(distDir, '_packages');
export const realmDir = path.join(distDir, '_realm');
export const templateDir = path.join(repoRoot, 'tools', 'template');

/**
 * Formats a path relative to the repo root for tidy log output, falling back to
 * the absolute path when the target sits outside the repo -- a wall of `../../`
 * is harder to read than the real path.
 */
export function rel(p: string): string {
  const r = path.relative(repoRoot, p);
  if (r === '') return '.';
  if (r.startsWith('..') || path.isAbsolute(r)) return p;
  return r;
}
