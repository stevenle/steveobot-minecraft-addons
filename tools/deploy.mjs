#!/usr/bin/env node
/**
 * Copies built add-ons into Minecraft's `development_behavior_packs` and
 * `development_resource_packs` folders. Packs placed there are reloaded by the
 * game every time a world is (re)entered, which is the fastest iteration loop
 * available for Bedrock.
 *
 * Usage:
 *   node tools/deploy.mjs [slug...] [--target stable|preview|education]
 *                                   [--dir <com.mojang path>] [--no-build]
 */
import path from 'node:path';

import { parseArgs, selectedSlugs } from './lib/args.mjs';
import { buildAddon } from './build.mjs';
import { loadAddons } from './lib/addons.mjs';
import { copyDir, ensureDir, exists, rmrf } from './lib/fsx.mjs';
import { DEPLOY_TARGETS, resolveMojangDir } from './lib/mojang.mjs';
import { color, fail, log } from './lib/log.mjs';
import { rel } from './lib/paths.mjs';

async function main() {
  const args = parseArgs();
  const target = typeof args.flags.target === 'string' ? args.flags.target : 'stable';
  if (!DEPLOY_TARGETS.includes(target)) {
    fail(`Unknown --target "${target}". Expected one of: ${DEPLOY_TARGETS.join(', ')}`);
  }

  const { dir: mojangDir, source, checked } = resolveMojangDir({
    target,
    dir: typeof args.flags.dir === 'string' ? args.flags.dir : null,
  });

  if (!mojangDir) {
    log.error(`Could not find a com.mojang folder for the "${target}" install.`);
    log.info('Checked:');
    for (const candidate of checked) log.info(`  ${candidate}`);
    fail('Set MINECRAFT_COM_MOJANG=<path to com.mojang> or pass --dir <path>.');
  }
  if (!exists(mojangDir)) {
    fail(`com.mojang folder does not exist: ${mojangDir}`);
  }

  let addons;
  try {
    addons = loadAddons(selectedSlugs(args));
  } catch (err) {
    fail(err.message);
  }

  if (args.flags['no-build'] !== true) {
    for (const addon of addons) {
      await buildAddon(addon);
    }
  }

  log.step(`Deploying to ${mojangDir} ${color.dim(`(from ${source})`)}`);

  let deployed = 0;
  for (const addon of addons) {
    for (const pack of addon.packs) {
      if (!exists(pack.outDir)) {
        fail(`${rel(pack.outDir)} does not exist. Build first, or drop --no-build.`);
      }
      const dest = path.join(mojangDir, pack.deployDir, pack.outName);
      ensureDir(path.dirname(dest));
      // Replace rather than merge, so files deleted from the source do not
      // linger in the game's copy.
      rmrf(dest);
      copyDir(pack.outDir, dest);
      log.done(`${addon.slug} ${pack.kind} ${color.dim(`-> ${path.join(pack.deployDir, pack.outName)}`)}`);
      deployed++;
    }
  }

  log.info('');
  log.info(`Deployed ${deployed} pack(s). In Minecraft, open your world's settings and enable them`);
  log.info('under Behavior Packs / Resource Packs, then re-enter the world to pick up changes.');
}

main().catch((err) => fail(err.stack ?? String(err)));
