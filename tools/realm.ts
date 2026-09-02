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
 * The world can go back two ways: manually via the client's Replace World, or
 * with `--upload`, which drives the captured upload flow (target + token, then
 * a POST of the archive). The flow is undocumented and reconstructed from
 * live probe captures, so `--upload` is gated behind --yes and reports the
 * host's response verbatim.
 *
 * Usage:
 *   node tools/realm.ts <slug...> --world <path> [--out <file>] [--in-place]
 *   node tools/realm.ts <slug...> --realm <id|name> [--out <file>]
 *   node tools/realm.ts <slug...> --realm <id|name> --upload [--close] [--yes]
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
 * Routes probed when looking for a world upload, run as a controlled
 * experiment rather than a pile of guesses.
 *
 * Two controls make an all-404 result mean something:
 *
 * - A known-good Bedrock route. If it fails, our auth or headers are being
 *   rejected and nothing else in the run can be interpreted.
 * - The *Java* Realms download route. Every public description of a Realms
 *   upload, including `PUT /worlds/{id}/backups/upload`, comes from the Java
 *   API. If this host answers Java-shaped paths then that upload path is
 *   plausible here; if it 404s while the positive control passes, the host
 *   simply does not serve them.
 *
 * GET is tried before PUT on each candidate: 404 says the path is absent, 405
 * proves it exists without invoking whatever a PUT would do.
 */
type ProbeKind = 'control-positive' | 'control-java' | 'candidate';

interface ProbeRoute {
  method: string;
  route: string;
  kind: ProbeKind;
  note: string;
}

const PROBE_ROUTES: ReadonlyArray<ProbeRoute> = [
  {
    method: 'GET',
    route: '/archive/download/world/{id}/{slot}/latest',
    kind: 'control-positive',
    note: 'known-good Bedrock route; proves auth and headers are accepted',
  },
  {
    method: 'GET',
    route: '/worlds/{id}/slot/{slot}/download',
    kind: 'control-java',
    note: 'the JAVA download route; shows whether this host serves Java-shaped paths',
  },
  {
    method: 'GET',
    route: '/worlds/{id}/backups/upload',
    kind: 'candidate',
    note: 'the widely reported path (Java API shape), existence check',
  },
  {
    method: 'PUT',
    route: '/worlds/{id}/backups/upload',
    kind: 'candidate',
    note: 'the widely reported path (Java API shape)',
  },
  {
    method: 'GET',
    route: '/archive/upload/world/{id}/{slot}',
    kind: 'candidate',
    note: 'mirror of the Bedrock download route',
  },
  {
    method: 'PUT',
    route: '/archive/upload/world/{id}/{slot}',
    kind: 'candidate',
    note: 'mirror of the Bedrock download route',
  },
  {
    method: 'PUT',
    route: '/worlds/{id}/slot/{slot}/upload',
    kind: 'candidate',
    note: 'slot-specific variant',
  },
];

/** Fields that would carry a pre-signed upload target, if one comes back. */
const UPLOAD_URL_HINTS = ['uploadEndpoint', 'uploadUrl', 'uploadLink', 'url', 'token', 'port'];

function expandRoute(route: string, realmId: number, slot: number): string {
  return route.replaceAll('{id}', String(realmId)).replaceAll('{slot}', String(slot));
}

/** Reads extra candidates from `--probe-path "PUT:/worlds/{id}/x,GET:/y"`. */
function customProbeRoutes(args: ParsedArgs): ProbeRoute[] {
  const raw = stringFlag(args, 'probe-path');
  if (raw === undefined) return [];

  return raw.split(',').map((entry) => {
    const [method, ...rest] = entry.trim().split(':');
    const route = rest.join(':');
    if (!method || !route.startsWith('/')) {
      fail(`--probe-path entries look like "PUT:/worlds/{id}/backups/upload" (got "${entry.trim()}")`);
    }
    return { method: method.toUpperCase(), route, kind: 'candidate' as const, note: 'custom' };
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

  const routes: ProbeRoute[] = [...PROBE_ROUTES, ...customProbeRoutes(args)];

  log.step(`Probing ${routes.length} route(s) on ${color.bold(realm.name)}`);
  for (const route of routes) {
    const tag = route.kind === 'candidate' ? '' : color.yellow(' [control]');
    log.info(
      `  ${route.method.padEnd(4)} ${expandRoute(route.route, realm.id, slot)}${tag}` +
        color.dim(`  ${route.note}`),
    );
  }
  log.info('');
  log.warn('Candidate routes are guesses. If one exists, calling it may close the Realm');
  log.warn('and disconnect players, the way the Java equivalent does. Nothing is uploaded.');

  if (!boolFlag(args, 'yes')) {
    log.info('');
    log.info('Dry run. Re-run with --yes to actually send these requests.');
    return;
  }

  log.info('');
  const runs: Array<{ route: ProbeRoute; result: ProbeResult }> = [];
  for (const route of routes) {
    const expanded = expandRoute(route.route, realm.id, slot);
    const result = await client.probe(route.method, expanded);
    runs.push({ route, result });
    log.info(`  ${route.method.padEnd(4)} ${expanded}  ->  ${classifyProbe(result).label}`);
  }

  const ok2xx = (r: ProbeResult): boolean => r.status >= 200 && r.status < 300;
  const exists = (r: ProbeResult): boolean => ok2xx(r) || r.status === 405;

  const positive = runs.find((r) => r.route.kind === 'control-positive');
  const java = runs.find((r) => r.route.kind === 'control-java');
  const candidates = runs.filter((r) => r.route.kind === 'candidate');
  const responded = candidates.filter((r) => classifyProbe(r.result).interesting);

  log.info('');
  log.step('Reading the controls');

  if (positive === undefined || !ok2xx(positive.result)) {
    log.error('  The known-good Bedrock route did not succeed.');
    log.info('  Auth, headers, or Realm selection is wrong, so nothing else here is');
    log.info('  meaningful. Fix that first: try `pnpm realm --list-realms`.');
    return;
  }
  log.done('  Known-good Bedrock route answered, so auth and headers are accepted.');

  const javaServed = java !== undefined && exists(java.result);
  if (javaServed) {
    log.warn('  This host ALSO answers the Java-shaped download route.');
    log.info('  A Java-shaped upload path is therefore plausible here.');
  } else {
    log.done('  The Java-shaped download route is absent, as expected for Bedrock.');
    log.info('  Published upload descriptions come from the Java API, so their paths');
    log.info('  are unlikely to exist on this host.');
  }

  log.info('');
  if (responded.length === 0) {
    log.done('No candidate upload route responded; every one returned 404.');
    log.info(
      javaServed
        ? 'Java-shaped routes do exist here, so a differently named upload path may still.'
        : 'Combined with the controls, this is good evidence there is no upload endpoint.',
    );
    log.info('Replace World in the client stays the way to put a world back.');
    return;
  }

  log.step(`${responded.length} candidate route(s) returned something other than 404:`);
  for (const { result } of responded) {
    log.info('');
    log.info(`  ${color.bold(`${result.method} ${result.route}`)}`);
    log.info(`    status: ${result.status} ${result.statusText}`);
    if (result.contentType !== undefined) log.info(`    content-type: ${result.contentType}`);
    if (result.allow !== undefined) log.info(`    allow: ${result.allow}`);
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

  // Stage 2: a candidate answered with an upload target, so probe the upload
  // host itself the same way — safe methods only, no body — reusing the token
  // already in hand rather than minting another.
  const discovery = candidates.find(
    (r) => r.route.method === 'GET' && ok2xx(r.result) && r.result.body.includes('"uploadUrl"'),
  );
  if (discovery !== undefined) {
    await probeUploadHost(client, discovery.result.body);
  }

  log.info('');
  log.info('Send this output back to Claude Code: the upload flow can be implemented');
  log.info('from a real response, rather than guessed at against a live Realm.');
}

/** Decodes a JWT's claims for display. No verification — we are the audience. */
function jwtClaims(token: string): Record<string, unknown> | undefined {
  const payload = token.split('.')[1];
  if (payload === undefined) return undefined;
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >;
  } catch {
    return undefined;
  }
}

/**
 * Stage 2 of the probe: asks the upload host what it accepts, without sending
 * a byte of world data. OPTIONS/HEAD/GET are safe by definition; the goal is
 * an `Allow` header or an error body that names the request the host expects,
 * so the real upload can be written from evidence like stage 1 was.
 */
async function probeUploadHost(client: RealmsClient, discoveryBody: string): Promise<void> {
  let info: { uploadUrl?: string; token?: string };
  try {
    info = JSON.parse(discoveryBody) as { uploadUrl?: string; token?: string };
  } catch {
    return;
  }
  if (info.uploadUrl === undefined || info.token === undefined) return;

  log.info('');
  log.step('Stage 2: probing the upload host (safe methods, no body, bearer token)');
  const claims = jwtClaims(info.token);
  if (claims !== undefined) {
    const exp =
      typeof claims['exp'] === 'number' ? new Date(claims['exp'] * 1000).toISOString() : '?';
    log.info(
      color.dim(
        `  token: upload_id=${String(claims['upload_id'] ?? '?')} ` +
          `region=${String(claims['region'] ?? '?')} expires=${exp}`,
      ),
    );
  }

  for (const method of ['OPTIONS', 'HEAD', 'GET']) {
    const result = await client.probe(method, info.uploadUrl, { bearer: info.token });
    log.info(`  ${method.padEnd(7)} ${info.uploadUrl}  ->  ${classifyProbe(result).label}`);
    if (result.allow !== undefined) log.info(`    allow: ${result.allow}`);
    if (result.contentType !== undefined) log.info(`    content-type: ${result.contentType}`);
    if (result.networkError !== undefined) log.info(`    network error: ${result.networkError}`);
    if (result.body) {
      log.info('    body:');
      for (const line of result.body.split('\n')) log.info(`      ${line}`);
    }
  }
}

/**
 * Sends a baked `.mcworld` back to a Realm slot over the captured upload flow:
 * `GET /archive/upload/world/{id}/{slot}` for a target and token, then a POST
 * of the archive as `application/x-mcworld`. Every piece of that shape comes
 * from live `--probe-upload` captures (2026-09-01) — see CLAUDE.md.
 *
 * Replacing a Realm's world is irreversible without a backup, so this is
 * gated behind --yes, and a non-2xx from the host is reported verbatim rather
 * than retried or papered over.
 */
async function uploadWorldFile(args: ParsedArgs, selector: string, file: string): Promise<void> {
  const client = await connect(args);

  let realms: RealmSummary[];
  try {
    realms = await client.listRealms();
  } catch (err) {
    explainApiError(err);
  }
  const realm = resolveRealm(realms, selector);
  const slot = resolveSlot(args, realm);
  const size = fs.statSync(file).size;

  log.info('');
  log.step(
    `Uploading ${rel(file)} ${color.dim(`(${(size / 1024 / 1024).toFixed(1)} MB)`)} to ` +
      `${color.bold(realm.name)} slot ${slot}`,
  );
  const close = boolFlag(args, 'close');
  log.warn('This replaces that slot\'s world on the live Realm and may close it,');
  log.warn('disconnecting players. Back up first: Realm settings -> Download World.');
  if (close) {
    log.warn('--close: the Realm will be closed for the upload and reopened after.');
  }

  if (!boolFlag(args, 'yes')) {
    log.info('');
    log.info('Dry run. Re-run with --yes to actually upload.');
    return;
  }

  // Any exit path below must reopen a Realm we closed, so failures are stashed
  // rather than thrown past the reopen (fail() exits without running finally).
  let closed = false;
  let failure: unknown;
  let uploadUrl = '';
  let result: ProbeResult | undefined;

  try {
    if (close) {
      log.step(`Closing ${color.bold(realm.name)}`);
      await client.closeRealm(realm.id);
      closed = true;
    }
    const info = await client.getWorldUploadInfo(realm.id, slot);
    uploadUrl = info.uploadUrl;
    result = await client.uploadWorldArchive(info, fs.readFileSync(file));
  } catch (err) {
    failure = err;
  }

  if (closed) {
    log.step(`Reopening ${color.bold(realm.name)}`);
    try {
      await client.openRealm(realm.id);
      log.done('Reopened.');
    } catch (err) {
      // Seen live right after ARCHIVING_SUCCEEDED — the service likely refuses
      // to open while it is still swapping the world in. Report the actual
      // response so the pattern can be confirmed and handled.
      log.error('Could not reopen the Realm — open it from the client\'s Realm settings.');
      log.info(`  ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (failure !== undefined || result === undefined) {
    explainUploadError(failure);
  }

  log.info('');
  log.info(`  POST ${uploadUrl}  ->  ${result.status} ${result.statusText}`);
  if (result.contentType !== undefined) log.info(`    content-type: ${result.contentType}`);
  if (result.body) {
    log.info('    body:');
    for (const line of result.body.split('\n')) log.info(`      ${line}`);
  }
  log.info('');

  if (result.status >= 200 && result.status < 300) {
    log.done('The upload host accepted the archive.');
    log.info('Rejoin the Realm and verify the world actually changed and the packs are');
    log.info('active. If the world is unchanged, an uncaptured follow-up step exists —');
    log.info('send this output back to Claude Code.');
  } else {
    log.error('The upload host rejected the archive. Nothing else was tried.');
    log.info('Send this output back to Claude Code; meanwhile Replace World in the');
    log.info('client remains the reliable route.');
  }
}

/**
 * Explains an upload failure. The "Could not set upload state" 403 gets its
 * own reading because the generic 403 advice (bad credentials) is wrong for
 * it: the same account minted upload sessions moments earlier. It is the
 * service refusing to start an upload session.
 */
function explainUploadError(err: unknown): never {
  if (
    err instanceof RealmsApiError &&
    err.status === 403 &&
    err.body.includes('Could not set upload state')
  ) {
    log.error(err.message);
    log.info('');
    log.info('"Could not set upload state" means the service refused to start an upload');
    log.info('session — it is not an auth failure. Plausible causes, in order:');
    log.info('  - a previous session is still pending: each --probe-upload or --upload');
    log.info('    mints one, and they appear to expire with their token (~1h). Wait for');
    log.info('    the last token\'s expiry and retry.');
    log.info('  - the Realm needs to be closed first, as on Java: retry with --close.');
    fail('Upload not started.');
  }
  explainApiError(err);
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

    if (boolFlag(args, 'upload')) {
      if (realmSelector === undefined) {
        fail('--upload needs --realm <id|name>: the upload target is a Realm slot.');
      }
      await uploadWorldFile(args, realmSelector, outFile);
      return;
    }

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
