#!/usr/bin/env node
/**
 * Bakes add-ons into a Bedrock world and writes an upload-ready `.mcworld`.
 *
 * Realms has no public API for installing packs, so a Realm cannot be deployed
 * to directly. The supported route is the client's "Replace World" flow: you
 * upload a world that already has the packs applied. This script produces
 * exactly that file, so the manual part is reduced to one upload.
 *
 * Usage:
 *   node tools/realm.ts <slug...> --world <path> [--out <file>] [--in-place]
 *   node tools/realm.ts --world <path> --list
 *
 * `--world` accepts a `.mcworld` file (what "Download World" gives you) or an
 * unpacked world folder (what lives in com.mojang/minecraftWorlds/<id>).
 */
import fs from 'node:fs';
import path from 'node:path';

import AdmZip from 'adm-zip';

import { boolFlag, parseArgs, selectedSlugs, stringFlag } from './lib/args.ts';
import { buildAddon } from './build.ts';
import { loadAddons, versionString, type Addon, type Pack } from './lib/addons.ts';
import { copyDir, ensureDir, exists, rmrf } from './lib/fsx.ts';
import { color, fail, log } from './lib/log.ts';
import { realmDir, rel } from './lib/paths.ts';
import {
  findWorldRoot,
  packFolder,
  packListFile,
  readPackList,
  readWorldName,
  upsertPackEntry,
  writePackList,
  type WorldPackEntry,
} from './lib/world.ts';

interface StagedWorld {
  /** Folder containing level.dat that we are about to modify. */
  root: string;
  /** Staging directory to clean up afterwards, or null when working in place. */
  cleanup: string | null;
  /** Directory to zip when producing a .mcworld. */
  zipRoot: string;
}

/** Human-readable summary of one pack applied to a world. */
function describeEntry(entry: WorldPackEntry): string {
  return `${entry.pack_id} v${versionString(entry.version)}`;
}

/**
 * Puts the source world somewhere we can safely modify it: extracted from a
 * .mcworld, copied out of a folder, or used directly when --in-place is set.
 */
function stageWorld(source: string, inPlace: boolean): StagedWorld {
  if (!exists(source)) {
    fail(`No such world: ${source}`);
  }
  const stats = fs.statSync(source);

  if (stats.isFile()) {
    if (inPlace) {
      fail('--in-place needs an unpacked world folder, not a .mcworld file.');
    }
    const staging = path.join(realmDir, '.staging');
    rmrf(staging);
    ensureDir(staging);
    new AdmZip(source).extractAllTo(staging, true);
    const root = findWorldRoot(staging);
    if (root === null) {
      rmrf(staging);
      fail(`${source} does not contain a level.dat, so it is not a Bedrock world export.`);
    }
    // Zip from the folder that actually holds level.dat, so the output is a
    // well-formed .mcworld even if the input was wrapped in a subfolder.
    return { root, cleanup: staging, zipRoot: root };
  }

  if (inPlace) {
    const root = findWorldRoot(source);
    if (root === null) {
      fail(`${source} has no level.dat, so it is not a Bedrock world folder.`);
    }
    return { root, cleanup: null, zipRoot: root };
  }

  const staging = path.join(realmDir, '.staging');
  rmrf(staging);
  ensureDir(staging);
  copyDir(source, staging);
  const root = findWorldRoot(staging);
  if (root === null) {
    rmrf(staging);
    fail(`${source} has no level.dat, so it is not a Bedrock world folder.`);
  }
  return { root, cleanup: staging, zipRoot: root };
}

/** Copies one built pack into the world and registers it in the pack list. */
function applyPack(worldRoot: string, pack: Pack): { replaced: boolean } {
  const uuid = pack.manifest.header?.uuid;
  const version = pack.manifest.header?.version;
  if (uuid === undefined || version === undefined) {
    fail(`${rel(pack.manifestPath)} is missing header.uuid or header.version.`);
  }

  const dest = path.join(worldRoot, packFolder(pack.kind), pack.outName);
  rmrf(dest);
  copyDir(pack.outDir, dest);

  const current = readPackList(worldRoot, pack.kind);
  const { entries, replaced } = upsertPackEntry(current, { pack_id: uuid, version });
  writePackList(worldRoot, pack.kind, entries);

  return { replaced };
}

function listWorld(source: string): void {
  const staged = stageWorld(source, false);
  try {
    log.step(`${color.bold(readWorldName(staged.root))} ${color.dim(`(${source})`)}`);
    for (const kind of ['behavior', 'resource'] as const) {
      const entries = readPackList(staged.root, kind);
      log.info('');
      log.info(`${packListFile(kind)}: ${entries.length} pack(s)`);
      for (const entry of entries) {
        const folder = path.join(staged.root, packFolder(kind));
        // A listed pack whose folder is absent is the classic reason an add-on
        // "does not work" after a world upload.
        const present = exists(folder)
          ? fs
              .readdirSync(folder, { withFileTypes: true })
              .some((e) => e.isDirectory() && hasUuid(path.join(folder, e.name), entry.pack_id))
          : false;
        const status = present ? color.green('present') : color.red('MISSING from the world folder');
        log.info(`  ${describeEntry(entry)} - ${status}`);
      }
    }
  } finally {
    if (staged.cleanup) rmrf(staged.cleanup);
  }
}

/** True when the pack folder's manifest declares the given header uuid. */
function hasUuid(packDir: string, uuid: string): boolean {
  const manifestPath = path.join(packDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) return false;
  try {
    const text = fs.readFileSync(manifestPath, 'utf8');
    return text.toLowerCase().includes(uuid.toLowerCase());
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const args = parseArgs();
  const source = stringFlag(args, 'world');
  if (source === undefined) {
    fail(
      'Missing --world. Pass a .mcworld file (from the Realm\'s "Download World") ' +
        'or an unpacked world folder.',
    );
  }

  if (boolFlag(args, 'list')) {
    listWorld(source);
    return;
  }

  const inPlace = boolFlag(args, 'in-place');

  let addons: Addon[];
  try {
    addons = loadAddons(selectedSlugs(args));
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }
  if (addons.length === 0) {
    fail('No add-ons found in addons/. Nothing to apply.');
  }

  if (!boolFlag(args, 'no-build')) {
    for (const addon of addons) {
      await buildAddon(addon, { release: true });
    }
  }

  const staged = stageWorld(source, inPlace);
  const worldName = readWorldName(staged.root);

  try {
    log.step(`Applying ${addons.length} add-on(s) to ${color.bold(worldName)}`);

    for (const addon of addons) {
      for (const pack of addon.packs) {
        if (!exists(pack.outDir)) {
          fail(`${rel(pack.outDir)} does not exist. Build first, or drop --no-build.`);
        }
        const { replaced } = applyPack(staged.root, pack);
        log.done(
          `${addon.slug} ${pack.kind} ${color.dim(replaced ? '(updated existing entry)' : '(added)')}`,
        );
      }
    }

    if (inPlace) {
      log.info('');
      log.info(`Updated ${staged.root} in place.`);
      log.info('Open the world in Minecraft, confirm the packs are active, then use');
      log.info('Realm settings -> Replace World to upload it.');
      return;
    }

    const outFile = stringFlag(args, 'out') ?? path.join(realmDir, `${slugifyName(worldName)}.mcworld`);
    ensureDir(path.dirname(outFile));
    const zip = new AdmZip();
    zip.addLocalFolder(staged.zipRoot);
    zip.writeZip(outFile);

    const size = fs.statSync(outFile).size;
    log.info('');
    log.done(`${color.bold(rel(outFile))} ${color.dim(`(${(size / 1024 / 1024).toFixed(1)} MB)`)}`);
    log.info('');
    log.info('To put this on your Realm:');
    log.info('  1. Back up first: Realm settings -> Download World.');
    log.info('  2. Import this file into Minecraft (open it, or copy it to your device).');
    log.info('  3. Realm settings -> Replace World, and pick the imported world.');
    log.info('  4. Rejoin and check the packs are active under the Realm\'s world settings.');
  } finally {
    if (staged.cleanup) rmrf(staged.cleanup);
  }
}

/** Makes a world name safe to use as a filename. */
function slugifyName(name: string): string {
  const cleaned = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned === '' ? 'world' : cleaned;
}

main().catch((err: unknown) => fail(err instanceof Error ? (err.stack ?? err.message) : String(err)));
