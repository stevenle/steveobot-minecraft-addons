#!/usr/bin/env node
/**
 * Scaffolds a new add-on in `addons/<slug>` from `tools/template`, generating
 * fresh UUIDs so the new packs never collide with existing ones.
 *
 * Usage:
 *   node tools/new-addon.ts <slug> [--name "Display Name"] [--description "..."]
 *                                  [--author "..."] [--no-resource-pack] [--no-scripts]
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { boolFlag, parseArgs, stringFlag } from './lib/args.ts';
import { copyDir, exists, rmrf } from './lib/fsx.ts';
import { readJson } from './lib/json.ts';
import type { PackManifest } from './lib/addons.ts';
import { color, fail, log } from './lib/log.ts';
import { addonsDir, rel, templateDir } from './lib/paths.ts';

const SLUG_RE = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;
const SUBSTITUTABLE = /\.(json|ts|js|lang|md)$/;

/** Turns `frost-walker` into `Frost Walker`. */
function titleCase(slug: string): string {
  return slug
    .split(/[-_]/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Serializes a manifest, keeping version triples like `[1, 0, 0]` on one line
 * the way the template writes them.
 */
function formatManifest(manifest: PackManifest): string {
  const json = JSON.stringify(manifest, null, 2);
  return `${json.replace(/\[\s+(\d+),\s+(\d+),\s+(\d+)\s+\]/g, '[$1, $2, $3]')}\n`;
}

/** Rewrites every {{PLACEHOLDER}} in the scaffolded text files. */
function substitute(dir: string, replacements: Record<string, string>): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      substitute(file, replacements);
      continue;
    }
    if (!SUBSTITUTABLE.test(entry.name)) continue;
    let text = fs.readFileSync(file, 'utf8');
    for (const [key, value] of Object.entries(replacements)) {
      text = text.replaceAll(`{{${key}}}`, value);
    }
    fs.writeFileSync(file, text);
  }
}

function main(): void {
  const args = parseArgs();
  const slug = args.positional[0];

  if (slug === undefined) {
    fail('Usage: pnpm new <slug> [--name "Display Name"] [--description "..."]');
  }
  if (!SLUG_RE.test(slug)) {
    fail(`Invalid slug "${slug}". Use lowercase letters, digits, and - or _ (e.g. frost-walker).`);
  }

  const dest = path.join(addonsDir, slug);
  if (exists(dest)) {
    fail(`${rel(dest)} already exists.`);
  }

  const name = stringFlag(args, 'name') ?? titleCase(slug);
  const description = stringFlag(args, 'description') ?? `${name} add-on.`;
  const author = stringFlag(args, 'author') ?? 'Steven Le';
  const wantResourcePack = !boolFlag(args, 'no-resource-pack');
  const wantScripts = !boolFlag(args, 'no-scripts');

  copyDir(templateDir, dest);

  const rpHeaderUuid = randomUUID();
  substitute(dest, {
    SLUG: slug,
    NAME: name,
    DESCRIPTION: description,
    AUTHOR: author,
    BP_HEADER_UUID: randomUUID(),
    BP_DATA_UUID: randomUUID(),
    BP_SCRIPT_UUID: randomUUID(),
    RP_HEADER_UUID: rpHeaderUuid,
    RP_RESOURCES_UUID: randomUUID(),
  });

  // Only rewrite the manifest when a pack was actually dropped, so the
  // template's hand-formatted JSON survives the common case untouched.
  if (!wantResourcePack || !wantScripts) {
    const manifestPath = path.join(dest, 'behavior_pack', 'manifest.json');
    const manifest = readJson<PackManifest>(manifestPath);

    if (!wantResourcePack) {
      rmrf(path.join(dest, 'resource_pack'));
      manifest.dependencies = (manifest.dependencies ?? []).filter((d) => d.uuid !== rpHeaderUuid);
    }
    if (!wantScripts) {
      rmrf(path.join(dest, 'src'));
      manifest.modules = (manifest.modules ?? []).filter((m) => m.type !== 'script');
      manifest.dependencies = (manifest.dependencies ?? []).filter(
        (d) => d.module_name !== '@minecraft/server',
      );
    }
    fs.writeFileSync(manifestPath, formatManifest(manifest));
  }

  log.done(`Created ${color.bold(rel(dest))}`);
  log.info('');
  log.info('Next steps:');
  log.info(`  1. Replace the placeholder pack_icon.png files in ${rel(dest)}`);
  if (wantScripts) log.info(`  2. Write your behavior in ${rel(path.join(dest, 'src', 'main.ts'))}`);
  log.info(`  ${wantScripts ? 3 : 2}. pnpm deploy ${slug}`);
}

main();
