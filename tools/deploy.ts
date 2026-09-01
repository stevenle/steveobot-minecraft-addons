#!/usr/bin/env node
/**
 * Copies built add-ons into Minecraft's `development_behavior_packs` and
 * `development_resource_packs` folders. Packs placed there are reloaded by the
 * game every time a world is (re)entered, which is the fastest iteration loop
 * available for Bedrock.
 *
 * Usage:
 *   node tools/deploy.ts [slug...] [--target stable|preview|education]
 *                                  [--dir <com.mojang path>] [--no-build]
 */
import path from 'node:path';

import { boolFlag, parseArgs, selectedSlugs, stringFlag } from './lib/args.ts';
import { buildAddon } from './build.ts';
import { loadAddons, type Addon } from './lib/addons.ts';
import { copyDir, ensureDir, exists, rmrf } from './lib/fsx.ts';
import { DEPLOY_TARGETS, isDeployTarget, resolveMojangDir } from './lib/mojang.ts';
import { color, fail, log } from './lib/log.ts';
import { rel } from './lib/paths.ts';

async function main(): Promise<void> {
  const args = parseArgs();
  const target = stringFlag(args, 'target') ?? 'stable';
  if (!isDeployTarget(target)) {
    fail(`Unknown --target "${target}". Expected one of: ${DEPLOY_TARGETS.join(', ')}`);
  }

  const { dir: mojangDir, source, checked } = resolveMojangDir({
    target,
    dir: stringFlag(args, 'dir'),
  });

  if (mojangDir === null) {
    log.error(`Could not find a com.mojang folder for the "${target}" install.`);
    log.info('Checked:');
    for (const candidate of checked) log.info(`  ${candidate}`);
    fail('Set MINECRAFT_COM_MOJANG=<path to com.mojang> or pass --dir <path>.');
  }
  if (!exists(mojangDir)) {
    fail(`com.mojang folder does not exist: ${mojangDir}`);
  }

  let addons: Addon[];
  try {
    addons = loadAddons(selectedSlugs(args));
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }

  if (!boolFlag(args, 'no-build')) {
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
      log.done(
        `${addon.slug} ${pack.kind} ${color.dim(`-> ${path.join(pack.deployDir, pack.outName)}`)}`,
      );
      deployed++;
    }
  }

  log.info('');
  log.info(`Deployed ${deployed} pack(s). In Minecraft, open your world's settings and enable them`);
  log.info('under Behavior Packs / Resource Packs, then re-enter the world to pick up changes.');
}

main().catch((err: unknown) => fail(err instanceof Error ? (err.stack ?? err.message) : String(err)));
