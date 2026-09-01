#!/usr/bin/env node
/**
 * Rebuilds (and optionally redeploys) add-ons whenever their sources change.
 *
 * Usage:
 *   node tools/watch.ts [slug...] [--deploy] [--target stable|preview]
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';

import chokidar from 'chokidar';

import { boolFlag, parseArgs, selectedSlugs, stringFlag } from './lib/args.ts';
import { buildAddon } from './build.ts';
import { loadAddon, loadAddons, type Addon } from './lib/addons.ts';
import { color, fail, log } from './lib/log.ts';
import { addonsDir, repoRoot, sharedDir } from './lib/paths.ts';

const DEBOUNCE_MS = 150;

/** Maps a changed file back to the add-on slug it belongs to, if any. */
function slugForPath(file: string): string | null {
  const relPath = path.relative(addonsDir, file);
  if (relPath.startsWith('..') || path.isAbsolute(relPath)) return null;
  return relPath.split(path.sep)[0] ?? null;
}

function deploy(slugs: string[], target: string | undefined): void {
  const argv = ['tools/deploy.ts', ...slugs, '--no-build'];
  if (target !== undefined) argv.push('--target', target);
  const result = spawnSync(process.execPath, argv, { cwd: repoRoot, stdio: 'inherit' });
  if (result.status !== 0) log.error('Deploy failed');
}

function main(): void {
  const args = parseArgs();
  const shouldDeploy = boolFlag(args, 'deploy');
  const target = stringFlag(args, 'target');

  let addons: Addon[];
  try {
    addons = loadAddons(selectedSlugs(args));
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }
  const watchedSlugs = new Set(addons.map((a) => a.slug));

  const pending = new Set<string>();
  let timer: NodeJS.Timeout | null = null;

  async function flush(): Promise<void> {
    timer = null;
    const slugs = [...pending];
    pending.clear();

    for (const slug of slugs) {
      try {
        // Reload from disk each time: manifests and addon.json can change too.
        await buildAddon(loadAddon(slug));
        log.done(`rebuilt ${color.bold(slug)}`);
      } catch (err) {
        log.error(`${slug}: ${err instanceof Error ? err.message : String(err)}`);
        return;
      }
    }
    if (shouldDeploy && slugs.length > 0) deploy(slugs, target);
  }

  function queue(slug: string): void {
    pending.add(slug);
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void flush(), DEBOUNCE_MS);
  }

  const watcher = chokidar.watch([addonsDir, sharedDir], {
    ignoreInitial: true,
    ignored: (p: string) => p.includes(`${path.sep}node_modules${path.sep}`),
  });

  watcher.on('all', (_event, file) => {
    const slug = slugForPath(file);
    if (slug !== null) {
      if (watchedSlugs.has(slug)) queue(slug);
      return;
    }
    // A shared/ change affects every add-on being watched.
    for (const s of watchedSlugs) queue(s);
  });

  log.step(`Watching ${[...watchedSlugs].join(', ')} ${color.dim('(Ctrl+C to stop)')}`);
  // Build once up front so the watch session starts from a known-good state.
  for (const slug of watchedSlugs) queue(slug);
}

main();
