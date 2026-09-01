#!/usr/bin/env node
/**
 * Scaffolds a new add-on in `addons/<slug>` from `tools/template`, generating
 * fresh UUIDs so the new packs never collide with existing ones.
 *
 * Usage:
 *   node tools/new-addon.mjs <slug> [--name "Display Name"] [--description "..."]
 *                                   [--author "..."] [--no-resource-pack] [--no-scripts]
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { parseArgs } from './lib/args.mjs';
import { copyDir, exists, rmrf } from './lib/fsx.mjs';
import { color, fail, log } from './lib/log.mjs';
import { addonsDir, rel, templateDir } from './lib/paths.mjs';

const SLUG_RE = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;

/** Turns `frost-walker` into `Frost Walker`. */
function titleCase(slug) {
  return slug
    .split(/[-_]/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Serializes a manifest, keeping version triples like `[1, 0, 0]` on one line
 * the way the template writes them.
 */
function formatManifest(manifest) {
  const json = JSON.stringify(manifest, null, 2);
  return `${json.replace(/\[\s+(\d+),\s+(\d+),\s+(\d+)\s+\]/g, '[$1, $2, $3]')}\n`;
}

/** Rewrites every {{PLACEHOLDER}} in the scaffolded text files. */
function substitute(dir, replacements) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      substitute(file, replacements);
      continue;
    }
    if (!/\.(json|ts|js|lang|md)$/.test(entry.name)) continue;
    let text = fs.readFileSync(file, 'utf8');
    for (const [key, value] of Object.entries(replacements)) {
      text = text.replaceAll(`{{${key}}}`, value);
    }
    fs.writeFileSync(file, text);
  }
}

function main() {
  const args = parseArgs();
  const slug = args.positional[0];

  if (!slug) {
    fail('Usage: npm run new -- <slug> [--name "Display Name"] [--description "..."]');
  }
  if (!SLUG_RE.test(slug)) {
    fail(`Invalid slug "${slug}". Use lowercase letters, digits, and - or _ (e.g. frost-walker).`);
  }

  const dest = path.join(addonsDir, slug);
  if (exists(dest)) {
    fail(`${rel(dest)} already exists.`);
  }

  const name = typeof args.flags.name === 'string' ? args.flags.name : titleCase(slug);
  const description =
    typeof args.flags.description === 'string' ? args.flags.description : `${name} add-on.`;
  const author = typeof args.flags.author === 'string' ? args.flags.author : 'Steven Le';
  const wantResourcePack = args.flags['no-resource-pack'] !== true;
  const wantScripts = args.flags['no-scripts'] !== true;

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
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

    if (!wantResourcePack) {
      rmrf(path.join(dest, 'resource_pack'));
      manifest.dependencies = manifest.dependencies.filter((d) => d.uuid !== rpHeaderUuid);
    }
    if (!wantScripts) {
      rmrf(path.join(dest, 'src'));
      manifest.modules = manifest.modules.filter((m) => m.type !== 'script');
      manifest.dependencies = manifest.dependencies.filter((d) => d.module_name !== '@minecraft/server');
    }
    fs.writeFileSync(manifestPath, formatManifest(manifest));
  }

  log.done(`Created ${color.bold(rel(dest))}`);
  log.info('');
  log.info('Next steps:');
  log.info(`  1. Replace the placeholder pack_icon.png files in ${rel(dest)}`);
  if (wantScripts) log.info(`  2. Write your behavior in ${rel(path.join(dest, 'src', 'main.ts'))}`);
  log.info(`  ${wantScripts ? 3 : 2}. npm run deploy -- ${slug}`);
}

main();
