import fs from 'node:fs';
import path from 'node:path';

import { readJson } from './json.mjs';
import { addonsDir, distDir } from './paths.mjs';

/**
 * Pack kinds a single add-on may contain. `dirName` is the authoring folder,
 * `suffix` is appended to the add-on slug to name the built folder (the name
 * that shows up under `development_*_packs`).
 */
export const PACK_KINDS = [
  { kind: 'behavior', dirName: 'behavior_pack', suffix: '_bp', deployDir: 'development_behavior_packs' },
  { kind: 'resource', dirName: 'resource_pack', suffix: '_rp', deployDir: 'development_resource_packs' },
];

const SLUG_RE = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;

/**
 * Loads one add-on from `addons/<slug>`. Returns a descriptor used by every
 * build task; throws if the add-on is structurally invalid.
 */
export function loadAddon(slug) {
  const dir = path.join(addonsDir, slug);
  if (!fs.existsSync(dir)) {
    throw new Error(`No such add-on: ${slug} (expected addons/${slug})`);
  }
  if (!SLUG_RE.test(slug)) {
    throw new Error(`Add-on folder "${slug}" must be lowercase alphanumeric with - or _ separators`);
  }

  const configPath = path.join(dir, 'addon.json');
  const config = fs.existsSync(configPath) ? readJson(configPath) : {};

  const packs = [];
  for (const spec of PACK_KINDS) {
    const packDir = path.join(dir, spec.dirName);
    const manifestPath = path.join(packDir, 'manifest.json');
    if (!fs.existsSync(manifestPath)) continue;
    packs.push({
      ...spec,
      dir: packDir,
      manifestPath,
      manifest: readJson(manifestPath),
      outName: `${slug}${spec.suffix}`,
      outDir: path.join(distDir, slug, `${slug}${spec.suffix}`),
    });
  }

  if (packs.length === 0) {
    throw new Error(`Add-on "${slug}" has no behavior_pack/manifest.json or resource_pack/manifest.json`);
  }

  const behaviorPack = packs.find((p) => p.kind === 'behavior');
  const scriptEntryRel = config.scriptEntry ?? 'src/main.ts';
  const scriptEntry = path.join(dir, scriptEntryRel);
  const hasScripts = Boolean(behaviorPack) && fs.existsSync(scriptEntry);

  const version = behaviorPack?.manifest?.header?.version ?? packs[0].manifest?.header?.version;

  return {
    slug,
    dir,
    name: config.name ?? slug,
    description: config.description ?? '',
    config,
    packs,
    behaviorPack,
    resourcePack: packs.find((p) => p.kind === 'resource'),
    scriptEntry: hasScripts ? scriptEntry : null,
    /** Path inside the built behavior pack that the bundle is written to. */
    scriptOut: config.scriptOut ?? 'scripts/main.js',
    version: Array.isArray(version) ? version : [1, 0, 0],
    outDir: path.join(distDir, slug),
  };
}

/** Returns every add-on slug present in `addons/`, sorted. */
export function listAddonSlugs() {
  if (!fs.existsSync(addonsDir)) return [];
  return fs
    .readdirSync(addonsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .map((e) => e.name)
    .sort();
}

/**
 * Loads the add-ons named in `slugs`, or every add-on in the repo when `slugs`
 * is empty.
 */
export function loadAddons(slugs = []) {
  const wanted = slugs.length > 0 ? slugs : listAddonSlugs();
  return wanted.map(loadAddon);
}

/** Formats a manifest version triple as `1.2.3`. */
export function versionString(version) {
  return Array.isArray(version) ? version.join('.') : String(version);
}
