/**
 * Reading and writing Bedrock world folders.
 *
 * A world is a folder containing `level.dat`, `levelname.txt`, and a `db/`
 * directory. A `.mcworld` file is just that folder zipped, which is the format
 * the Minecraft client imports and uploads to a Realm.
 *
 * Packs are applied to a world in two places, and both are required: the pack
 * folder has to exist under `behavior_packs/` or `resource_packs/`, and the
 * pack has to be listed in `world_behavior_packs.json` or
 * `world_resource_packs.json`. A pack present in only one of the two is
 * silently ignored by the game.
 */
import fs from 'node:fs';
import path from 'node:path';

import { formatJson, readJson } from './json.ts';
import type { PackKind } from './addons.ts';

/** One entry of a `world_*_packs.json` file. */
export interface WorldPackEntry {
  pack_id: string;
  version: number[];
}

export interface WorldPaths {
  /** Folder holding level.dat. */
  dir: string;
  /** Display name from levelname.txt, or the folder name as a fallback. */
  name: string;
}

const PACK_LIST_FILES: Record<PackKind, string> = {
  behavior: 'world_behavior_packs.json',
  resource: 'world_resource_packs.json',
};

const PACK_FOLDERS: Record<PackKind, string> = {
  behavior: 'behavior_packs',
  resource: 'resource_packs',
};

export function packListFile(kind: PackKind): string {
  return PACK_LIST_FILES[kind];
}

export function packFolder(kind: PackKind): string {
  return PACK_FOLDERS[kind];
}

/** True when `dir` looks like an unpacked Bedrock world. */
export function isWorldDir(dir: string): boolean {
  return fs.existsSync(path.join(dir, 'level.dat'));
}

/**
 * Resolves the actual world root inside `dir`. Some `.mcworld` files wrap the
 * world in a single top-level folder rather than putting level.dat at the zip
 * root, so descend one level when that is what we find.
 */
export function findWorldRoot(dir: string): string | null {
  if (isWorldDir(dir)) return dir;

  const entries = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory());
  const only = entries.length === 1 ? entries[0] : undefined;
  if (only && isWorldDir(path.join(dir, only.name))) {
    return path.join(dir, only.name);
  }
  return null;
}

/** Reads a world's display name from levelname.txt. */
export function readWorldName(worldDir: string): string {
  const file = path.join(worldDir, 'levelname.txt');
  if (fs.existsSync(file)) {
    const name = fs.readFileSync(file, 'utf8').trim();
    if (name) return name;
  }
  return path.basename(worldDir);
}

/**
 * Normalizes a pack entry's version. The game writes a JSON array, but a world
 * that has been through Realms comes back with the array re-encoded as a
 * string (`"version": "[1,0,0]"`), and dropping those entries made `--list`
 * report an applied pack as absent.
 */
function normalizeVersion(value: unknown): number[] | null {
  if (Array.isArray(value) && value.every((n) => typeof n === 'number')) return value;
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value);
      if (Array.isArray(parsed) && parsed.every((n) => typeof n === 'number')) return parsed;
    } catch {
      // fall through to null
    }
  }
  return null;
}

/** Reads one of the world's pack lists, treating a missing file as empty. */
export function readPackList(worldDir: string, kind: PackKind): WorldPackEntry[] {
  const file = path.join(worldDir, packListFile(kind));
  if (!fs.existsSync(file)) return [];
  const parsed = readJson<unknown>(file);
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((entry): WorldPackEntry[] => {
    if (typeof entry !== 'object' || entry === null) return [];
    const candidate = entry as { pack_id?: unknown; version?: unknown };
    if (typeof candidate.pack_id !== 'string') return [];
    const version = normalizeVersion(candidate.version);
    return version === null ? [] : [{ pack_id: candidate.pack_id, version }];
  });
}

/** Writes a world pack list back out. */
export function writePackList(worldDir: string, kind: PackKind, entries: WorldPackEntry[]): void {
  fs.writeFileSync(path.join(worldDir, packListFile(kind)), formatJson(entries));
}

/**
 * Adds or updates one pack in a world's pack list, matching on `pack_id` so
 * re-applying an add-on bumps its version instead of duplicating the entry.
 * Returns the new list and whether an existing entry was replaced.
 */
export function upsertPackEntry(
  entries: WorldPackEntry[],
  entry: WorldPackEntry,
): { entries: WorldPackEntry[]; replaced: boolean } {
  const id = entry.pack_id.toLowerCase();
  const index = entries.findIndex((e) => e.pack_id.toLowerCase() === id);
  if (index === -1) {
    return { entries: [...entries, entry], replaced: false };
  }
  const next = [...entries];
  next[index] = entry;
  return { entries: next, replaced: true };
}
