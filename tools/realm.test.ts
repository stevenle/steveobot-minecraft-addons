/**
 * End-to-end tests for `tools/realm.ts` in Realms mode.
 *
 * The real service is unreachable from CI and needs a Microsoft account, so
 * these drive the actual CLI against a stand-in Realms server: REALMS_API_HOST
 * points the client at it and REALMS_AUTHORIZATION supplies a token, which
 * together exercise everything except the OAuth handshake itself.
 */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { after, before, describe, it } from 'node:test';
import type { AddressInfo } from 'node:net';

import AdmZip from 'adm-zip';

import { repoRoot } from './lib/paths.ts';

const run = promisify(execFile);

const REALM = { id: 99, name: 'Steveo Test Realm', state: 'OPEN', activeSlot: 2, expired: false };

interface Harness {
  host: string;
  requests: string[];
  close: () => Promise<void>;
}

/** Serves a minimal Realms API plus the world archive it points at. */
async function startRealmsStub(worldArchive: Buffer): Promise<Harness> {
  const requests: string[] = [];
  let host = '';

  const server = http.createServer((req, res) => {
    const url = req.url ?? '';
    requests.push(url);

    if (url === '/worlds') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ servers: [REALM] }));
      return;
    }
    if (url.startsWith('/archive/download/world/')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          downloadLink: `${host}/archive.mcworld`,
          token: 'download-token',
          size: worldArchive.length,
        }),
      );
      return;
    }
    if (url === '/archive.mcworld') {
      res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
      res.end(worldArchive);
      return;
    }
    res.writeHead(404).end('not found');
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  host = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  return {
    host,
    requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/** Builds a .mcworld archive that looks like a real Bedrock world export. */
function makeWorldArchive(): Buffer {
  const zip = new AdmZip();
  zip.addFile('level.dat', Buffer.from('pretend level.dat'));
  zip.addFile('levelname.txt', Buffer.from('Steveo Test Realm'));
  zip.addFile('db/000003.log', Buffer.from('pretend chunk data'));
  // A pack the Realm already had, which must survive untouched.
  zip.addFile(
    'world_behavior_packs.json',
    Buffer.from(JSON.stringify([{ pack_id: '11111111-2222-3333-4444-555555555555', version: [2, 1, 0] }])),
  );
  zip.addFile(
    'behavior_packs/legacy_pack/manifest.json',
    Buffer.from(JSON.stringify({ header: { uuid: '11111111-2222-3333-4444-555555555555' } })),
  );
  return zip.toBuffer();
}

describe('realm.ts against a stand-in Realms service', () => {
  let stub: Harness;
  let outDir: string;

  const cli = (args: string[], env: Record<string, string> = {}) =>
    run(process.execPath, [path.join(repoRoot, 'tools', 'realm.ts'), ...args], {
      cwd: repoRoot,
      env: {
        ...process.env,
        REALMS_API_HOST: stub.host,
        REALMS_AUTHORIZATION: 'XBL3.0 x=hash;token',
        NO_COLOR: '1',
        ...env,
      },
    });

  before(async () => {
    stub = await startRealmsStub(makeWorldArchive());
    outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'realm-e2e-'));
  });

  after(async () => {
    await stub.close();
    fs.rmSync(outDir, { recursive: true, force: true });
  });

  it('lists the Realms the account can see', async () => {
    const { stdout } = await cli(['--list-realms']);
    assert.match(stdout, /Steveo Test Realm/);
    assert.match(stdout, /99/);
  });

  it('downloads the live world, applies packs, and writes a .mcworld', async () => {
    const out = path.join(outDir, 'applied.mcworld');
    const { stdout } = await cli(['hello-world', '--realm', '99', '--out', out]);

    assert.match(stdout, /Downloading the current world/);
    assert.ok(fs.existsSync(out), 'expected an output .mcworld');

    const entries = new AdmZip(out).getEntries().map((e) => e.entryName);
    // World data survives the round trip.
    assert.ok(entries.includes('level.dat'));
    assert.ok(entries.includes('db/000003.log'));
    // Our add-on went in, on both sides.
    assert.ok(entries.includes('behavior_packs/hello-world_bp/manifest.json'));
    assert.ok(entries.includes('behavior_packs/hello-world_bp/scripts/main.js'));
    assert.ok(entries.includes('resource_packs/hello-world_rp/manifest.json'));
    // The Realm's existing pack was not clobbered.
    assert.ok(entries.includes('behavior_packs/legacy_pack/manifest.json'));

    const bp = JSON.parse(new AdmZip(out).readAsText('world_behavior_packs.json')) as Array<{
      pack_id: string;
    }>;
    assert.equal(bp.length, 2, 'existing pack plus ours');
    assert.ok(bp.some((e) => e.pack_id === '11111111-2222-3333-4444-555555555555'));
    assert.ok(bp.some((e) => e.pack_id === '2bdba555-b0e4-4044-af7f-f9fe3cca6a20'));
  });

  it('pulls the Realm active slot by default and honours --slot', async () => {
    stub.requests.length = 0;
    await cli(['hello-world', '--realm', '99', '--out', path.join(outDir, 'a.mcworld')]);
    assert.ok(
      stub.requests.some((u) => u === `/archive/download/world/99/${REALM.activeSlot}/latest`),
      `expected active slot ${REALM.activeSlot}, saw ${JSON.stringify(stub.requests)}`,
    );

    stub.requests.length = 0;
    await cli(['hello-world', '--realm', '99', '--slot', '1', '--out', path.join(outDir, 'b.mcworld')]);
    assert.ok(stub.requests.some((u) => u === '/archive/download/world/99/1/latest'));
  });

  it('resolves a Realm by name as well as by id', async () => {
    stub.requests.length = 0;
    await cli(['hello-world', '--realm', 'steveo', '--out', path.join(outDir, 'c.mcworld')]);
    assert.ok(stub.requests.some((u) => u.startsWith('/archive/download/world/99/')));
  });

  it('fails clearly when no Realm matches', async () => {
    const err = await cli(['hello-world', '--realm', 'nope']).then(
      () => null,
      (e: { stdout?: string; stderr?: string }) => e,
    );
    assert.ok(err, 'expected a non-zero exit');
    const output = `${err.stdout ?? ''}${err.stderr ?? ''}`;
    assert.match(output, /No Realm matched/);
    // The error must list what IS available, so the user can recover.
    assert.match(output, /Steveo Test Realm/);
  });

  it('rejects a non-numeric --slot', async () => {
    const err = await cli(['hello-world', '--realm', '99', '--slot', 'abc']).then(
      () => null,
      (e: { stdout?: string; stderr?: string }) => e,
    );
    assert.ok(err, 'expected a non-zero exit');
    assert.match(`${err.stdout ?? ''}${err.stderr ?? ''}`, /--slot must be a positive whole number/);
  });

  it('explains an auth rejection instead of leaking a raw 403', async () => {
    const forbidden = http.createServer((_req, res) => {
      res.writeHead(403, { 'Content-Type': 'text/plain' }).end('Forbidden');
    });
    await new Promise<void>((resolve) => forbidden.listen(0, '127.0.0.1', resolve));
    const host = `http://127.0.0.1:${(forbidden.address() as AddressInfo).port}`;

    try {
      const err = await cli(['--list-realms'], { REALMS_API_HOST: host }).then(
        () => null,
        (e: { stdout?: string; stderr?: string }) => e,
      );
      assert.ok(err, 'expected a non-zero exit');
      assert.match(`${err.stdout ?? ''}${err.stderr ?? ''}`, /sign in again/i);
    } finally {
      await new Promise<void>((resolve) => forbidden.close(() => resolve()));
    }
  });
});
