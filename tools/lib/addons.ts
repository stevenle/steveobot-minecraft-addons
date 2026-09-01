import fs from 'node:fs';
import path from 'node:path';

import { readJson } from './json.ts';
import { addonsDir, distDir } from './paths.ts';

/** The subset of a Bedrock pack manifest this tooling reads. */
export interface PackManifestHeader {
  name?: string;
  description?: string;
  uuid?: string;
  version?: number[];
  min_engine_version?: number[];
}

export interface PackManifestModule {
  type?: string;
  language?: string;
  entry?: string;
  uuid?: string;
  version?: number[];
}

export interface PackManifestDependency {
  uuid?: string;
  module_name?: string;
  version?: number[] | string;
}

export interface PackManifest {
  format_version?: number;
  header?: PackManifestHeader;
  modules?: PackManifestModule[];
  dependencies?: PackManifestDependency[];
  metadata?: Record<string, unknown>;
}

export type PackKind = 'behavior' | 'resource';

interface PackSpec {
  kind: PackKind;
  /** Authoring folder inside the add-on. */
  dirName: string;
  /** Appended to the slug to name the built folder. */
  suffix: string;
  /** Folder under com.mojang that `deploy` copies into. */
  deployDir: string;
}

export interface Pack extends PackSpec {
  dir: string;
  manifestPath: string;
  manifest: PackManifest;
  outName: string;
  outDir: string;
}

/** Contents of an add-on's `addon.json`. */
export interface AddonConfig {
  name?: string;
  description?: string;
  scriptEntry?: string;
  scriptOut?: string;
}

export interface Addon {
  slug: string;
  dir: string;
  name: string;
  description: string;
  config: AddonConfig;
  packs: Pack[];
  behaviorPack: Pack | undefined;
  resourcePack: Pack | undefined;
  /** Absolute path to the TypeScript entry point, or null when script-free. */
  scriptEntry: string | null;
  /** Path inside the built behavior pack that the bundle is written to. */
  scriptOut: string;
  version: number[];
  outDir: string;
}

/**
 * Pack kinds a single add-on may contain. `dirName` is the authoring folder,
 * `suffix` names the built folder (the name that shows up under
 * `development_*_packs`).
 */
export const PACK_KINDS: readonly PackSpec[] = [
  {
    kind: 'behavior',
    dirName: 'behavior_pack',
    suffix: '_bp',
    deployDir: 'development_behavior_packs',
  },
  {
    kind: 'resource',
    dirName: 'resource_pack',
    suffix: '_rp',
    deployDir: 'development_resource_packs',
  },
];

const SLUG_RE = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;

export const DEFAULT_SCRIPT_ENTRY = 'src/main.ts';
export const DEFAULT_SCRIPT_OUT = 'scripts/main.js';

/**
 * Loads one add-on from `addons/<slug>`. Returns the descriptor every build
 * task consumes; throws if the add-on is structurally invalid.
 */
export function loadAddon(slug: string): Addon {
  const dir = path.join(addonsDir, slug);
  if (!fs.existsSync(dir)) {
    throw new Error(`No such add-on: ${slug} (expected addons/${slug})`);
  }
  if (!SLUG_RE.test(slug)) {
    throw new Error(`Add-on folder "${slug}" must be lowercase alphanumeric with - or _ separators`);
  }

  const configPath = path.join(dir, 'addon.json');
  const config: AddonConfig = fs.existsSync(configPath) ? readJson<AddonConfig>(configPath) : {};

  const packs: Pack[] = [];
  for (const spec of PACK_KINDS) {
    const packDir = path.join(dir, spec.dirName);
    const manifestPath = path.join(packDir, 'manifest.json');
    if (!fs.existsSync(manifestPath)) continue;
    packs.push({
      ...spec,
      dir: packDir,
      manifestPath,
      manifest: readJson<PackManifest>(manifestPath),
      outName: `${slug}${spec.suffix}`,
      outDir: path.join(distDir, slug, `${slug}${spec.suffix}`),
    });
  }

  const firstPack = packs[0];
  if (firstPack === undefined) {
    throw new Error(
      `Add-on "${slug}" has no behavior_pack/manifest.json or resource_pack/manifest.json`,
    );
  }

  const behaviorPack = packs.find((p) => p.kind === 'behavior');
  const scriptEntryPath = path.join(dir, config.scriptEntry ?? DEFAULT_SCRIPT_ENTRY);
  const hasScripts = behaviorPack !== undefined && fs.existsSync(scriptEntryPath);

  const version = behaviorPack?.manifest.header?.version ?? firstPack.manifest.header?.version;

  return {
    slug,
    dir,
    name: config.name ?? slug,
    description: config.description ?? '',
    config,
    packs,
    behaviorPack,
    resourcePack: packs.find((p) => p.kind === 'resource'),
    scriptEntry: hasScripts ? scriptEntryPath : null,
    scriptOut: config.scriptOut ?? DEFAULT_SCRIPT_OUT,
    version: Array.isArray(version) ? version : [1, 0, 0],
    outDir: path.join(distDir, slug),
  };
}

/** Returns every add-on slug present in `addons/`, sorted. */
export function listAddonSlugs(): string[] {
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
export function loadAddons(slugs: string[] = []): Addon[] {
  const wanted = slugs.length > 0 ? slugs : listAddonSlugs();
  return wanted.map(loadAddon);
}

/** Formats a manifest version triple as `1.2.3`. */
export function versionString(version: number[] | string | undefined): string {
  return Array.isArray(version) ? version.join('.') : String(version);
}
