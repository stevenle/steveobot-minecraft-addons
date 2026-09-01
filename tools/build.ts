#!/usr/bin/env node
/**
 * Builds add-ons from `addons/<slug>` into `dist/<slug>/`.
 *
 * Every pack folder is copied verbatim, then the TypeScript entry point (if the
 * add-on has one) is bundled into the behavior pack with esbuild. The result is
 * a folder layout the game can load directly.
 *
 * Usage:
 *   node tools/build.ts [slug...] [--release]
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { boolFlag, parseArgs, selectedSlugs } from './lib/args.ts';
import { loadAddons, versionString, type Addon } from './lib/addons.ts';
import { copyDir, ensureDir, rmrf } from './lib/fsx.ts';
import { color, fail, log } from './lib/log.ts';
import { rel, sharedDir } from './lib/paths.ts';

/** Script modules the game provides at runtime; never bundle these. */
const EXTERNAL_MODULES = [
  '@minecraft/server',
  '@minecraft/server-ui',
  '@minecraft/server-gametest',
];

export interface BuildResult {
  /** Number of pack files copied. */
  files: number;
  /** Whether a script bundle was produced. */
  bundled: boolean;
}

/** Builds a single add-on and returns a short summary of what was produced. */
export async function buildAddon(addon: Addon, options: { release?: boolean } = {}): Promise<BuildResult> {
  const { release = false } = options;
  rmrf(addon.outDir);

  let files = 0;
  for (const pack of addon.packs) {
    files += copyDir(pack.dir, pack.outDir);
  }

  let bundled = false;
  if (addon.scriptEntry && addon.behaviorPack) {
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

async function main(): Promise<void> {
  const args = parseArgs();
  const release = boolFlag(args, 'release');

  let addons: Addon[];
  try {
    addons = loadAddons(selectedSlugs(args));
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }

  if (addons.length === 0) {
    log.warn('No add-ons found in addons/. Run `pnpm new <slug>` to create one.');
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

// Only run when invoked directly; other tools import buildAddon() from here.
const entry = process.argv[1];
if (entry !== undefined && path.resolve(entry) === fileURLToPath(import.meta.url)) {
  main().catch((err: unknown) => fail(err instanceof Error ? (err.stack ?? err.message) : String(err)));
}
