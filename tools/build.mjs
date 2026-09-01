#!/usr/bin/env node
/**
 * Builds add-ons from `addons/<slug>` into `dist/<slug>/`.
 *
 * Every pack folder is copied verbatim, then the TypeScript entry point (if
 * the add-on has one) is bundled into the behavior pack with esbuild. The
 * result is a folder layout the game can load directly.
 *
 * Usage:
 *   node tools/build.mjs [slug...] [--release]
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseArgs, selectedSlugs } from './lib/args.mjs';
import { loadAddons, versionString } from './lib/addons.mjs';
import { copyDir, ensureDir, rmrf } from './lib/fsx.mjs';
import { color, fail, log } from './lib/log.mjs';
import { rel, sharedDir } from './lib/paths.mjs';

/** Script modules the game provides at runtime; never bundle these. */
const EXTERNAL_MODULES = ['@minecraft/server', '@minecraft/server-ui', '@minecraft/server-gametest'];

/** Builds a single add-on and returns a short summary of what was produced. */
export async function buildAddon(addon, { release = false } = {}) {
  rmrf(addon.outDir);

  let files = 0;
  for (const pack of addon.packs) {
    files += copyDir(pack.dir, pack.outDir);
  }

  let bundled = false;
  if (addon.scriptEntry) {
    const esbuild = await import('esbuild');
    const outfile = path.join(addon.behaviorPack.outDir, addon.scriptOut);
    ensureDir(path.dirname(outfile));
    await esbuild.build({
      entryPoints: [addon.scriptEntry],
      outfile,
      bundle: true,
      format: 'esm',
      target: 'es2020',
      platform: 'neutral',
      external: EXTERNAL_MODULES,
      alias: { '@shared': sharedDir },
      minify: release,
      legalComments: 'none',
      logLevel: 'warning',
    });
    bundled = true;
  }

  return { files, bundled };
}

async function main() {
  const args = parseArgs();
  const release = Boolean(args.flags.release);

  let addons;
  try {
    addons = loadAddons(selectedSlugs(args));
  } catch (err) {
    fail(err.message);
  }

  if (addons.length === 0) {
    log.warn('No add-ons found in addons/. Run `npm run new -- <slug>` to create one.');
    return;
  }

  log.step(`Building ${addons.length} add-on(s) in ${release ? 'release' : 'development'} mode`);

  for (const addon of addons) {
    const { files, bundled } = await buildAddon(addon, { release });
    const packs = addon.packs.map((p) => p.kind).join(' + ');
    const scripts = bundled ? ', scripts bundled' : '';
    log.done(
      `${color.bold(addon.slug)} v${versionString(addon.version)} ` +
        color.dim(`(${packs}, ${files} file(s)${scripts}) -> ${rel(addon.outDir)}`),
    );
  }
}

// Only run when invoked directly; watch.mjs imports buildAddon() from here.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => fail(err.stack ?? String(err)));
}
