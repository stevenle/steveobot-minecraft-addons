#!/usr/bin/env node
/**
 * Zips built add-ons into distributable `.mcaddon` files (and optionally one
 * `.mcpack` per pack). Double-clicking a `.mcaddon` imports it into Minecraft
 * on any platform.
 *
 * Usage:
 *   node tools/package.mjs [slug...] [--mcpack] [--no-build]
 */
import fs from 'node:fs';
import path from 'node:path';

import AdmZip from 'adm-zip';

import { parseArgs, selectedSlugs } from './lib/args.mjs';
import { buildAddon } from './build.mjs';
import { loadAddons, versionString } from './lib/addons.mjs';
import { ensureDir, exists } from './lib/fsx.mjs';
import { color, fail, log } from './lib/log.mjs';
import { packagesDir, rel } from './lib/paths.mjs';

function humanSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function writeZip(zip, outFile) {
  ensureDir(path.dirname(outFile));
  zip.writeZip(outFile);
  return fs.statSync(outFile).size;
}

async function main() {
  const args = parseArgs();
  const alsoMcpack = Boolean(args.flags.mcpack);

  let addons;
  try {
    addons = loadAddons(selectedSlugs(args));
  } catch (err) {
    fail(err.message);
  }

  if (addons.length === 0) {
    log.warn('No add-ons found in addons/. Nothing to package.');
    return;
  }

  if (args.flags['no-build'] !== true) {
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

main().catch((err) => fail(err.stack ?? String(err)));
