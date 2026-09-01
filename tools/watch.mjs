#!/usr/bin/env node
/**
 * Rebuilds (and optionally redeploys) add-ons whenever their sources change.
 *
 * Usage:
 *   node tools/watch.mjs [slug...] [--deploy] [--target stable|preview]
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

import chokidar from 'chokidar';

import { parseArgs, selectedSlugs } from './lib/args.mjs';
import { buildAddon } from './build.mjs';
import { loadAddon, loadAddons } from './lib/addons.mjs';
import { color, fail, log } from './lib/log.mjs';
import { addonsDir, repoRoot, sharedDir } from './lib/paths.mjs';

const DEBOUNCE_MS = 150;

/** Maps a changed file back to the add-on slug it belongs to, if any. */
function slugForPath(file) {
  const relPath = path.relative(addonsDir, file);
  if (relPath.startsWith('..') || path.isAbsolute(relPath)) return null;
  const [slug] = relPath.split(path.sep);
  return slug || null;
}

function deploy(slugs, target) {
  const args = ['tools/deploy.mjs', ...slugs];
  if (target) args.push('--target', target);
  const result = spawnSync(process.execPath, args, { cwd: repoRoot, stdio: 'inherit' });
  if (result.status !== 0) log.error('Deploy failed');
}

function main() {
  const args = parseArgs();
  const requested = selectedSlugs(args);
  const shouldDeploy = Boolean(args.flags.deploy);
  const target = typeof args.flags.target === 'string' ? args.flags.target : undefined;

  let addons;
  try {
    addons = loadAddons(requested);
  } catch (err) {
    fail(err.message);
  }
  const watchedSlugs = new Set(addons.map((a) => a.slug));

  const pending = new Set();
  let timer = null;

  async function flush() {
    timer = null;
    const slugs = [...pending];
    pending.clear();

    for (const slug of slugs) {
      try {
        // Reload from disk each time: manifests and addon.json can change too.
        const addon = loadAddon(slug);
        await buildAddon(addon);
        log.done(`rebuilt ${color.bold(slug)}`);
      } catch (err) {
        log.error(`${slug}: ${err.message}`);
        return;
      }
    }
    if (shouldDeploy && slugs.length > 0) deploy(slugs, target);
  }

  function queue(slug) {
    pending.add(slug);
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void flush(), DEBOUNCE_MS);
  }

  const watcher = chokidar.watch([addonsDir, sharedDir], {
    ignoreInitial: true,
    ignored: (p) => p.includes(`${path.sep}node_modules${path.sep}`),
  });

  watcher.on('all', (_event, file) => {
    const slug = slugForPath(file);
    if (slug) {
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
