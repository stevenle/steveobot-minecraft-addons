#!/usr/bin/env node
/**
 * Zips built add-ons into distributable `.mcaddon` files (and optionally one
 * `.mcpack` per pack). Opening a `.mcaddon` imports it into Minecraft.
 *
 * Usage:
 *   node tools/package.ts [slug...] [--mcpack] [--no-build]
 */
import fs from 'node:fs';
import path from 'node:path';

import AdmZip from 'adm-zip';

import { boolFlag, parseArgs, selectedSlugs } from './lib/args.ts';
import { buildAddon } from './build.ts';
import { loadAddons, versionString, type Addon } from './lib/addons.ts';
import { ensureDir, exists } from './lib/fsx.ts';
import { color, fail, log } from './lib/log.ts';
import { packagesDir, rel } from './lib/paths.ts';

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function writeZip(zip: AdmZip, outFile: string): number {
  ensureDir(path.dirname(outFile));
  zip.writeZip(outFile);
  return fs.statSync(outFile).size;
}

async function main(): Promise<void> {
  const args = parseArgs();
  const alsoMcpack = boolFlag(args, 'mcpack');

  let addons: Addon[];
  try {
    addons = loadAddons(selectedSlugs(args));
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }

  if (addons.length === 0) {
    log.warn('No add-ons found in addons/. Nothing to package.');
    return;
  }

  if (!boolFlag(args, 'no-build')) {
    for (const addon of addons) {
      await buildAddon(addon, { release: true });
    }
  }

  log.step(`Packaging ${addons.length} add-on(s) into ${rel(packagesDir)}`);

  for (const addon of addons) {
    const version = versionString(addon.version);

    for (const pack of addon.packs) {
      if (!exists(pack.outDir)) {
        fail(`${rel(pack.outDir)} does not exist. Build first, or drop --no-build.`);
      }
    }

    // A .mcaddon is a zip whose top-level folders are each a complete pack.
    const addonZip = new AdmZip();
    for (const pack of addon.packs) {
      addonZip.addLocalFolder(pack.outDir, pack.outName);
    }
    const addonFile = path.join(packagesDir, `${addon.slug}-v${version}.mcaddon`);
    const size = writeZip(addonZip, addonFile);
    log.done(`${color.bold(rel(addonFile))} ${color.dim(`(${humanSize(size)})`)}`);

    if (alsoMcpack) {
      // A .mcpack is a zip of a single pack, with the manifest at the root.
      for (const pack of addon.packs) {
        const packZip = new AdmZip();
        packZip.addLocalFolder(pack.outDir);
        const packFile = path.join(packagesDir, `${pack.outName}-v${version}.mcpack`);
        const packSize = writeZip(packZip, packFile);
        log.done(`${rel(packFile)} ${color.dim(`(${humanSize(packSize)})`)}`);
      }
    }
  }
}

main().catch((err: unknown) => fail(err instanceof Error ? (err.stack ?? err.message) : String(err)));
