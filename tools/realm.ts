#!/usr/bin/env node
/**
 * Bakes add-ons into a Bedrock world and writes an upload-ready `.mcworld`.
 *
 * Realms has no public API for installing packs, so a Realm cannot be deployed
 * to directly. The supported route is the client's "Replace World" flow: you
 * upload a world that already has the packs applied. This script produces
 * exactly that file, so the manual part is reduced to one upload.
 *
 * The world can come from a file you exported yourself, or be pulled straight
 * off a live Realm over the undocumented Realms service (see lib/realms/).
 * Either way the upload back is manual: the service has no endpoint for
 * replacing world content.
 *
 * Usage:
 *   node tools/realm.ts <slug...> --world <path> [--out <file>] [--in-place]
 *   node tools/realm.ts <slug...> --realm <id|name> [--out <file>]
 *   node tools/realm.ts --world <path> --list
 *   node tools/realm.ts --login
 *   node tools/realm.ts --list-realms
 *   node tools/realm.ts --realm <id> --probe-upload [--yes]
 *
 * `--world` accepts a `.mcworld` file (what "Download World" gives you) or an
 * unpacked world folder (what lives in com.mojang/minecraftWorlds/<id>).
 * `--realm` takes a Realm id or a substring of its name.
 */
import fs from 'node:fs';
import path from 'node:path';

import AdmZip from 'adm-zip';

import { boolFlag, parseArgs, selectedSlugs, stringFlag, type ParsedArgs } from './lib/args.ts';
import { buildAddon } from './build.ts';
import { loadAddons, versionString, type Addon, type Pack } from './lib/addons.ts';
import { copyDir, ensureDir, exists, rmrf } from './lib/fsx.ts';
import { color, fail, log } from './lib/log.ts';
import { realmDir, rel } from './lib/paths.ts';
import { authorizeRealms, DEFAULT_CACHE_DIR } from './lib/realms/auth.ts';
import { RealmsApiError, RealmsClient } from './lib/realms/client.ts';
import type { ProbeResult, RealmSummary } from './lib/realms/types.ts';
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

/**
 * Signs in (reusing the cached token when one is valid), printing the device
 * code the user has to enter on Microsoft's page.
 */
async function signIn(args: ParsedArgs) {
  const account = stringFlag(args, 'account');
  try {
    return await authorizeRealms({
      ...(account !== undefined ? { username: account } : {}),
      onDeviceCode: (prompt) => {
        log.info('');
        log.step('Sign in to Microsoft to authorize this tool:');
        log.info(`  ${prompt.verification_uri}  ->  code ${color.bold(prompt.user_code)}`);
        log.info('');
        log.info(color.dim('Waiting for sign-in to complete...'));
      },
    });
  } catch (err) {
    // The sign-in chain reaches login.live.com and xboxlive.com; a firewall or
    // a stale cache both surface here, and the underlying stack is not useful.
    log.error(err instanceof Error ? err.message : String(err));
    fail(
      'Microsoft sign-in failed. Check network access to login.live.com and ' +
        `xboxlive.com, then delete ${rel(DEFAULT_CACHE_DIR)} and try again.`,
    );
  }
}

/** Builds an authenticated Realms client, prompting for sign-in on first use. */
async function connect(args: ParsedArgs): Promise<RealmsClient> {
  const auth = await signIn(args);

  const clientVersion = stringFlag(args, 'client-version');
  // REALMS_API_HOST points the client at a stand-in server; used by the tests.
  const apiHost = process.env['REALMS_API_HOST'];
  const options = {
    authorization: auth.header,
    ...(apiHost !== undefined && apiHost !== '' ? { host: apiHost } : {}),
    usePreview: boolFlag(args, 'preview'),
    ...(clientVersion !== undefined ? { minecraftVersion: clientVersion } : {}),
  };
  return new RealmsClient(options);
}

/** Turns an API failure into something the user can act on. */
function explainApiError(err: unknown): never {
  if (err instanceof RealmsApiError) {
    if (err.status === 401 || err.status === 403) {
      log.error(err.message);
      fail(
        'Realms rejected the credentials. Delete .realms-auth/ and sign in again, and check ' +
          'the account actually owns or has joined a Realm.',
      );
    }
    fail(err.message);
  }
  fail(err instanceof Error ? (err.stack ?? err.message) : String(err));
}

/** Finds a Realm by numeric id or by a case-insensitive name substring. */
function resolveRealm(realms: RealmSummary[], selector: string): RealmSummary {
  const byId = realms.find((r) => String(r.id) === selector);
  if (byId) return byId;

  const needle = selector.toLowerCase();
  const matches = realms.filter((r) => (r.name ?? '').toLowerCase().includes(needle));
  const only = matches[0];
  if (only === undefined) {
    log.error(`No Realm matched "${selector}". Realms visible to this account:`);
    for (const realm of realms) log.info(`  ${realm.id}  ${realm.name}`);
    fail('Pass --realm with one of the ids above.');
  }
  if (matches.length > 1) {
    log.error(`"${selector}" matched ${matches.length} Realms:`);
    for (const realm of matches) log.info(`  ${realm.id}  ${realm.name}`);
    fail('Pass --realm with a specific id.');
  }
  return only;
}

/** Which world slot to pull: --slot if given, otherwise the Realm's live one. */
function resolveSlot(args: ParsedArgs, realm: RealmSummary): number {
  const raw = stringFlag(args, 'slot');
  if (raw === undefined) return realm.activeSlot;

  const slot = Number(raw);
  if (!Number.isInteger(slot) || slot < 1) {
    fail(`--slot must be a positive whole number (got "${raw}").`);
  }
  return slot;
}

function printRealms(realms: RealmSummary[]): void {
  if (realms.length === 0) {
    log.warn('This account can see no Realms.');
    return;
  }
  log.info('');
  for (const realm of realms) {
    const flags = [realm.state, realm.expired ? 'EXPIRED' : null, realm.member ? null : 'not joined']
      .filter(Boolean)
      .join(', ');
    log.info(`  ${color.bold(String(realm.id))}  ${realm.name} ${color.dim(`(slot ${realm.activeSlot}; ${flags})`)}`);
  }
  log.info('');
}

/** Downloads a Realm's current world and returns the path to the .mcworld. */
async function downloadRealmWorld(args: ParsedArgs, selector: string): Promise<string> {
  const client = await connect(args);

  let realms: RealmSummary[];
  try {
    realms = await client.listRealms();
  } catch (err) {
    explainApiError(err);
  }

  const realm = resolveRealm(realms, selector);
  log.step(`Downloading the current world from ${color.bold(realm.name)} ${color.dim(`(id ${realm.id})`)}`);

  if (realm.expired) {
    log.warn('This Realm is expired; the download may fail.');
  }

  ensureDir(realmDir);
  const dest = path.join(realmDir, `realm-${realm.id}-download.mcworld`);
  try {
    const download = await client.getWorldDownload(
      realm.id,
      resolveSlot(args, realm),
      stringFlag(args, 'backup') ?? 'latest',
    );
    if (download.size !== undefined) {
      log.info(color.dim(`  ${(download.size / 1024 / 1024).toFixed(1)} MB`));
    }
    const written = await client.downloadWorldTo(download, dest);
    log.done(`downloaded ${(written / 1024 / 1024).toFixed(1)} MB`);
  } catch (err) {
    explainApiError(err);
  }
  return dest;
}

/**
 * Candidate routes for a world upload, which the Realms service has never
 * documented and which no open-source client implements.
 *
 * `PUT /worlds/{id}/backups/upload` is the shape Minecraft's *Java* Realms
 * client uses (it returns an upload endpoint plus a token); whether Bedrock
 * exposes an equivalent is exactly what this probe is for. The rest mirror the
 * Bedrock download route.
 *
 * GET comes before PUT for each path on purpose: 404 means the path is absent,
 * while 405 proves it exists without invoking it.
 */
const UPLOAD_PROBE_ROUTES: ReadonlyArray<{ method: string; route: string }> = [
  { method: 'GET', route: '/worlds/{id}/backups/upload' },
  { method: 'PUT', route: '/worlds/{id}/backups/upload' },
  { method: 'GET', route: '/archive/upload/world/{id}/{slot}' },
  { method: 'PUT', route: '/archive/upload/world/{id}/{slot}' },
  { method: 'PUT', route: '/worlds/{id}/slot/{slot}/upload' },
];

/** Fields that would carry a pre-signed upload target, if one comes back. */
const UPLOAD_URL_HINTS = ['uploadEndpoint', 'uploadUrl', 'uploadLink', 'url', 'token', 'port'];

function expandRoute(route: string, realmId: number, slot: number): string {
  return route.replaceAll('{id}', String(realmId)).replaceAll('{slot}', String(slot));
}

/** Reads extra candidates from `--probe-path "PUT:/worlds/{id}/x,GET:/y"`. */
function customProbeRoutes(args: ParsedArgs): Array<{ method: string; route: string }> {
  const raw = stringFlag(args, 'probe-path');
  if (raw === undefined) return [];

  return raw.split(',').map((entry) => {
    const [method, ...rest] = entry.trim().split(':');
    const route = rest.join(':');
    if (!method || !route.startsWith('/')) {
      fail(`--probe-path entries look like "PUT:/worlds/{id}/backups/upload" (got "${entry.trim()}")`);
    }
    return { method: method.toUpperCase(), route };
  });
}

function classifyProbe(result: ProbeResult): { label: string; interesting: boolean } {
  if (result.networkError !== undefined) return { label: color.red('network error'), interesting: false };
  if (result.status === 404) return { label: color.dim('404 absent'), interesting: false };
  if (result.status === 405) {
    return { label: color.yellow('405 path EXISTS, wrong method'), interesting: true };
  }
  if (result.status >= 200 && result.status < 300) {
    return { label: color.green(`${result.status} RESPONDED`), interesting: true };
  }
  if (result.status === 401 || result.status === 403) {
    return { label: color.yellow(`${result.status} auth/permission`), interesting: true };
  }
  return { label: `${result.status} ${result.statusText}`, interesting: true };
}

/**
 * Probes for a world-upload endpoint and reports exactly what the service says.
 *
 * This deliberately stops at discovery. Uploading would mean inventing the rest
 * of a protocol nobody has documented, and a half-right guess writes to a live
 * Realm, so the remaining steps get implemented once a real response shows what
 * they should be.
 */
async function probeUpload(args: ParsedArgs, selector: string): Promise<void> {
  const client = await connect(args);

  let realms: RealmSummary[];
  try {
    realms = await client.listRealms();
  } catch (err) {
    explainApiError(err);
  }
  const realm = resolveRealm(realms, selector);
  const slot = resolveSlot(args, realm);

  const routes = [...UPLOAD_PROBE_ROUTES, ...customProbeRoutes(args)];

  log.step(`Probing ${routes.length} candidate upload route(s) on ${color.bold(realm.name)}`);
  for (const { method, route } of routes) {
    log.info(color.dim(`  ${method.padEnd(4)} ${expandRoute(route, realm.id, slot)}`));
  }
  log.info('');
  log.warn('These routes are guesses. If one exists, calling it may close the Realm and');
  log.warn('disconnect players, the way the Java equivalent does. Nothing is uploaded.');

  if (!boolFlag(args, 'yes')) {
    log.info('');
    log.info('Dry run. Re-run with --yes to actually send these requests.');
    return;
  }

  log.info('');
  const results: ProbeResult[] = [];
  for (const { method, route } of routes) {
    const expanded = expandRoute(route, realm.id, slot);
    const result = await client.probe(method, expanded);
    results.push(result);
    const { label } = classifyProbe(result);
    log.info(`  ${method.padEnd(4)} ${expanded}  ->  ${label}`);
  }

  const interesting = results.filter((r) => classifyProbe(r).interesting);

  log.info('');
  if (interesting.length === 0) {
    log.done('Every candidate returned 404. No upload endpoint at any of these paths.');
    log.info('That matches prismarine-authored clients, which implement no upload at all.');
    log.info('Replace World in the client stays the only way to put a world back.');
    return;
  }

  log.step(`${interesting.length} route(s) returned something other than 404:`);
  for (const result of interesting) {
    log.info('');
    log.info(`  ${color.bold(`${result.method} ${result.route}`)}`);
    log.info(`    status: ${result.status} ${result.statusText}`);
    if (result.contentType !== undefined) log.info(`    content-type: ${result.contentType}`);
    if (result.networkError !== undefined) log.info(`    network error: ${result.networkError}`);
    if (result.body) {
      log.info('    body:');
      for (const line of result.body.split('\n')) log.info(`      ${line}`);
      const hits = UPLOAD_URL_HINTS.filter((k) => result.body.includes(`"${k}"`));
      if (hits.length > 0) {
        log.info('');
        log.done(`    Looks like upload info: found ${hits.join(', ')}`);
      }
    }
  }

  log.info('');
  log.info('Paste this output into the repo issue or back to Claude Code: the upload');
  log.info('flow can be implemented once the real response shape is known, rather than');
  log.info('guessed at against a live Realm.');
}

async function main(): Promise<void> {
  const args = parseArgs();

  // Auth-only mode: verify sign-in works before trusting anything else.
  if (boolFlag(args, 'login')) {
    const auth = await signIn(args);
    log.done(`Signed in as XUID ${auth.xuid}`);
    log.info(color.dim(`Token cached until ${new Date(auth.expiresOn).toISOString()}`));
    return;
  }

  if (boolFlag(args, 'list-realms')) {
    const client = await connect(args);
    try {
      printRealms(await client.listRealms());
    } catch (err) {
      explainApiError(err);
    }
    return;
  }

  const realmSelector = stringFlag(args, 'realm');

  if (boolFlag(args, 'probe-upload')) {
    if (realmSelector === undefined) {
      fail('--probe-upload needs --realm <id|name> to know which Realm to probe.');
    }
    await probeUpload(args, realmSelector);
    return;
  }

  const source = realmSelector !== undefined
    ? await downloadRealmWorld(args, realmSelector)
    : stringFlag(args, 'world');

  if (source === undefined) {
    fail(
      'Missing --world or --realm. Pass a .mcworld file (from the Realm\'s "Download World") ' +
        'or an unpacked world folder, or --realm <id|name> to pull the live world down.',
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
