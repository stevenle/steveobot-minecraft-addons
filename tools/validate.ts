#!/usr/bin/env node
/**
 * Static checks over every add-on's manifests. These are the mistakes that
 * cause a pack to silently not show up in-game, which is much harder to debug
 * from inside Minecraft than it is from here.
 *
 * Usage:
 *   node tools/validate.ts [slug...]
 */
import fs from 'node:fs';
import path from 'node:path';

import { parseArgs, selectedSlugs } from './lib/args.ts';
import {
  DEFAULT_SCRIPT_ENTRY,
  loadAddons,
  versionString,
  type Addon,
  type Pack,
} from './lib/addons.ts';
import { color, fail, log } from './lib/log.ts';
import { rel } from './lib/paths.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Context {
  errors: string[];
  warnings: string[];
  /** Every UUID seen so far, mapped to where it was first declared. */
  uuids: Map<string, string>;
}

function isVersionTriple(value: unknown): value is number[] {
  return (
    Array.isArray(value) && value.length === 3 && value.every((n) => Number.isInteger(n) && n >= 0)
  );
}

function checkPack(addon: Addon, pack: Pack, ctx: Context): void {
  const where = rel(pack.manifestPath);
  const { manifest } = pack;
  const { errors, warnings, uuids } = ctx;

  if (manifest.format_version !== 2) {
    errors.push(
      `${where}: format_version should be 2 (found ${JSON.stringify(manifest.format_version)})`,
    );
  }

  const header = manifest.header ?? {};
  if (!UUID_RE.test(header.uuid ?? '')) {
    errors.push(`${where}: header.uuid is missing or not a UUID`);
  }
  if (!isVersionTriple(header.version)) {
    errors.push(`${where}: header.version must be an array of three integers, e.g. [1, 0, 0]`);
  }
  if (!isVersionTriple(header.min_engine_version)) {
    errors.push(`${where}: header.min_engine_version must be an array of three integers`);
  }
  if (!header.name) {
    warnings.push(`${where}: header.name is empty`);
  }

  const modules = manifest.modules ?? [];
  if (modules.length === 0) {
    errors.push(`${where}: manifest declares no modules`);
  }

  const expectedType = pack.kind === 'behavior' ? 'data' : 'resources';
  if (!modules.some((m) => m.type === expectedType)) {
    errors.push(`${where}: expected a module of type "${expectedType}"`);
  }

  for (const [i, mod] of modules.entries()) {
    if (!UUID_RE.test(mod.uuid ?? '')) {
      errors.push(`${where}: modules[${i}].uuid is missing or not a UUID`);
    }
    if (!isVersionTriple(mod.version)) {
      errors.push(`${where}: modules[${i}].version must be an array of three integers`);
    }
  }

  // Every UUID in the repo must be unique; a collision makes Minecraft load
  // only one of the two packs, seemingly at random.
  const declared: Array<[string, string | undefined]> = [
    ['header', header.uuid],
    ...modules.map((m, i): [string, string | undefined] => [`modules[${i}]`, m.uuid]),
  ];
  for (const [label, uuid] of declared) {
    if (uuid === undefined) continue;
    const key = uuid.toLowerCase();
    const seen = uuids.get(key);
    if (seen !== undefined) {
      errors.push(`${where} ${label}: UUID ${uuid} is already used by ${seen}`);
    } else {
      uuids.set(key, `${where} ${label}`);
    }
  }

  const scriptModule = modules.find((m) => m.type === 'script');
  if (scriptModule) {
    if (pack.kind !== 'behavior') {
      errors.push(`${where}: only behavior packs may declare a script module`);
    }
    if (scriptModule.entry !== addon.scriptOut) {
      errors.push(
        `${where}: script module entry is "${scriptModule.entry}" but the build writes "${addon.scriptOut}"`,
      );
    }
    if (addon.scriptEntry === null) {
      const expected = rel(path.join(addon.dir, addon.config.scriptEntry ?? DEFAULT_SCRIPT_ENTRY));
      errors.push(
        `${where}: manifest declares a script module but no TypeScript entry point was found ` +
          `(expected ${expected})`,
      );
    }
    const deps = manifest.dependencies ?? [];
    if (!deps.some((d) => d.module_name === '@minecraft/server')) {
      warnings.push(`${where}: script module without an "@minecraft/server" dependency`);
    }
  } else if (addon.scriptEntry !== null && pack.kind === 'behavior') {
    errors.push(`${where}: found ${rel(addon.scriptEntry)} but the manifest declares no script module`);
  }

  if (!fs.existsSync(path.join(pack.dir, 'pack_icon.png'))) {
    warnings.push(`${rel(pack.dir)}: no pack_icon.png (the pack shows a placeholder icon in-game)`);
  }
}

/** Cross-checks that a behavior pack's dependency on its resource pack lines up. */
function checkPackDependencies(addon: Addon, ctx: Context): void {
  const bp = addon.behaviorPack;
  const rp = addon.resourcePack;
  if (!bp || !rp) return;

  const deps = bp.manifest.dependencies ?? [];
  const link = deps.find((d) => typeof d.uuid === 'string');
  if (!link?.uuid) {
    ctx.warnings.push(
      `${rel(bp.manifestPath)}: no dependency on the resource pack, so players can enable one without the other`,
    );
    return;
  }
  const rpUuid = rp.manifest.header?.uuid;
  if (link.uuid.toLowerCase() !== rpUuid?.toLowerCase()) {
    ctx.errors.push(
      `${rel(bp.manifestPath)}: dependency uuid ${link.uuid} does not match the resource pack header uuid ${rpUuid}`,
    );
    return;
  }
  const rpVersion = rp.manifest.header?.version;
  if (versionString(link.version) !== versionString(rpVersion)) {
    ctx.errors.push(
      `${rel(bp.manifestPath)}: dependency version ${versionString(link.version)} does not match the ` +
        `resource pack version ${versionString(rpVersion)}`,
    );
  }
}

function main(): void {
  const args = parseArgs();

  let addons: Addon[];
  try {
    addons = loadAddons(selectedSlugs(args));
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }

  if (addons.length === 0) {
    log.warn('No add-ons found in addons/. Nothing to validate.');
    return;
  }

  const ctx: Context = { errors: [], warnings: [], uuids: new Map() };
  for (const addon of addons) {
    for (const pack of addon.packs) {
      checkPack(addon, pack, ctx);
    }
    checkPackDependencies(addon, ctx);
  }

  for (const warning of ctx.warnings) log.warn(warning);
  for (const error of ctx.errors) log.error(error);

  if (ctx.errors.length > 0) {
    fail(`${ctx.errors.length} problem(s) found across ${addons.length} add-on(s)`);
  }
  log.done(
    `Validated ${addons.length} add-on(s)` +
      (ctx.warnings.length > 0 ? color.dim(` (${ctx.warnings.length} warning(s))`) : ''),
  );
}

main();
