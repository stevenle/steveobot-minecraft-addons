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
  /** Every request seen, as "METHOD /path". */
  requests: string[];
  setProbeRoute: (
    methodAndUrl: string,
    response: { status: number; json?: unknown; body?: string },
  ) => void;
  clearProbeRoutes: () => void;
  close: () => Promise<void>;
}

/** Serves a minimal Realms API plus the world archive it points at. */
async function startRealmsStub(worldArchive: Buffer): Promise<Harness> {
  const requests: string[] = [];
  const probeRoutes = new Map<string, { status: number; json?: unknown; body?: string }>();
  let host = '';

  const server = http.createServer((req, res) => {
    const url = req.url ?? '';
    requests.push(`${req.method} ${url}`);

    const probe = probeRoutes.get(`${req.method} ${url}`);
    if (probe) {
      if (probe.json !== undefined) {
        res.writeHead(probe.status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(probe.json));
      } else {
        res.writeHead(probe.status, { 'Content-Type': 'text/plain' });
        res.end(probe.body ?? '');
      }
      return;
    }

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
    // Anything unmapped is absent, which is what the probe expects to see.
    res.writeHead(404).end('not found');
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  host = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  return {
    host,
    requests,
    setProbeRoute: (methodAndUrl, response) => probeRoutes.set(methodAndUrl, response),
    clearProbeRoutes: () => probeRoutes.clear(),
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

  it('refuses to upload without --yes and sends nothing', async () => {
    stub.clearProbeRoutes();
    stub.requests.length = 0;
    const out = path.join(outDir, 'dry-upload.mcworld');
    const { stdout } = await cli(['hello-world', '--realm', '99', '--upload', '--out', out]);

    assert.match(stdout, /Dry run/);
    assert.ok(
      !stub.requests.some((r) => r.includes('/archive/upload/')),
      'a dry run must not even fetch an upload target',
    );
    assert.ok(fs.existsSync(out), 'the baked world should still be written');
  });

  it('uploads the baked world with --upload --yes and reports the response', async () => {
    stub.clearProbeRoutes();
    stub.requests.length = 0;
    stub.setProbeRoute(`GET /archive/upload/world/99/${REALM.activeSlot}`, {
      status: 200,
      json: { uploadUrl: `${stub.host}/upload-sink`, token: 'up-token' },
    });
    stub.setProbeRoute('POST /upload-sink', { status: 200, json: { ok: true } });

    const out = path.join(outDir, 'uploaded.mcworld');
    const { stdout } = await cli(['hello-world', '--realm', '99', '--upload', '--yes', '--out', out]);

    assert.ok(stub.requests.includes('POST /upload-sink'), 'the archive must be POSTed');
    assert.match(stdout, /200/);
    assert.match(stdout, /accepted the archive/);
    assert.match(stdout, /verify the world actually changed/);
  });

  it('reports an upload rejection verbatim and does not retry', async () => {
    stub.clearProbeRoutes();
    stub.requests.length = 0;
    stub.setProbeRoute(`GET /archive/upload/world/99/${REALM.activeSlot}`, {
      status: 200,
      json: { uploadUrl: `${stub.host}/upload-sink`, token: 'up-token' },
    });
    stub.setProbeRoute('POST /upload-sink', { status: 403, body: 'HTTP 403 Forbidden' });

    const out = path.join(outDir, 'rejected.mcworld');
    const { stdout, stderr } = await cli(['hello-world', '--realm', '99', '--upload', '--yes', '--out', out]);

    assert.match(stdout, /403/);
    // log.error writes to stderr.
    assert.match(stderr, /rejected the archive/);
    assert.equal(
      stub.requests.filter((r) => r === 'POST /upload-sink').length,
      1,
      'a rejection must not be retried',
    );
  });

  it('with --close, closes before minting the upload session and reopens after', async () => {
    stub.clearProbeRoutes();
    stub.requests.length = 0;
    stub.setProbeRoute('PUT /worlds/99/close', { status: 200, body: 'true' });
    stub.setProbeRoute('PUT /worlds/99/open', { status: 200, body: 'true' });
    stub.setProbeRoute(`GET /archive/upload/world/99/${REALM.activeSlot}`, {
      status: 200,
      json: { uploadUrl: `${stub.host}/upload-sink`, token: 'up-token' },
    });
    stub.setProbeRoute('POST /upload-sink', { status: 200, json: { ok: true } });

    const out = path.join(outDir, 'closed-upload.mcworld');
    await cli(['hello-world', '--realm', '99', '--upload', '--close', '--yes', '--out', out]);

    const order = stub.requests.filter((r) =>
      ['PUT /worlds/99/close', 'PUT /worlds/99/open', `GET /archive/upload/world/99/${REALM.activeSlot}`, 'POST /upload-sink'].includes(r),
    );
    assert.deepEqual(order, [
      'PUT /worlds/99/close',
      `GET /archive/upload/world/99/${REALM.activeSlot}`,
      'POST /upload-sink',
      'PUT /worlds/99/open',
    ]);
  });

  it('reopens the Realm even when the upload session is refused, and explains the 403', async () => {
    stub.clearProbeRoutes();
    stub.requests.length = 0;
    stub.setProbeRoute('PUT /worlds/99/close', { status: 200, body: 'true' });
    stub.setProbeRoute('PUT /worlds/99/open', { status: 200, body: 'true' });
    stub.setProbeRoute(`GET /archive/upload/world/99/${REALM.activeSlot}`, {
      status: 403,
      body: '{"errorCode":403, "errorMsg":"Could not set upload state"}',
    });

    const out = path.join(outDir, 'refused-upload.mcworld');
    const err = (await cli(['hello-world', '--realm', '99', '--upload', '--close', '--yes', '--out', out]).then(
      () => null,
      (e: unknown) => e,
    )) as { stdout: string; stderr: string } | null;

    assert.ok(err, 'the CLI should exit non-zero');
    // The explanation goes to stdout via log.info; errors go to stderr.
    assert.match(err.stdout, /refused to start an upload\s+session/);
    assert.match(err.stdout, /not an auth failure/);
    assert.ok(
      !err.stderr.includes('Delete .realms-auth/'),
      'must not give the generic bad-credentials advice',
    );
    assert.ok(
      stub.requests.includes('PUT /worlds/99/open'),
      'the Realm must be reopened even on failure',
    );
  });

  it('pulls the Realm active slot by default and honours --slot', async () => {
    stub.requests.length = 0;
    await cli(['hello-world', '--realm', '99', '--out', path.join(outDir, 'a.mcworld')]);
    assert.ok(
      stub.requests.some((u) => u === `GET /archive/download/world/99/${REALM.activeSlot}/latest`),
      `expected active slot ${REALM.activeSlot}, saw ${JSON.stringify(stub.requests)}`,
    );

    stub.requests.length = 0;
    await cli(['hello-world', '--realm', '99', '--slot', '1', '--out', path.join(outDir, 'b.mcworld')]);
    assert.ok(stub.requests.some((u) => u === 'GET /archive/download/world/99/1/latest'));
  });

  it('resolves a Realm by name as well as by id', async () => {
    stub.requests.length = 0;
    await cli(['hello-world', '--realm', 'steveo', '--out', path.join(outDir, 'c.mcworld')]);
    assert.ok(stub.requests.some((u) => u.startsWith('GET /archive/download/world/99/')));
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

  describe('--probe-upload', () => {
    it('sends nothing without --yes', async () => {
      stub.requests.length = 0;
      const { stdout, stderr } = await cli(['--realm', '99', '--probe-upload']);

      assert.match(stdout, /Dry run/);
      // The side-effect warning is a warning, so it belongs on stderr.
      assert.match(stderr, /may close the Realm/);
      const probeRequests = stub.requests.filter((r) => r.includes('upload'));
      assert.deepEqual(probeRequests, [], 'a dry run must not touch any candidate route');
    });

    it('reports every candidate absent when they all 404', async () => {
      stub.clearProbeRoutes();
      const { stdout } = await cli(['--realm', '99', '--probe-upload', '--yes']);

      assert.match(stdout, /404 absent/);
      assert.match(stdout, /No candidate upload route responded/);
      assert.match(stdout, /Replace World/);
    });

    it('uses the known-good Bedrock route as a positive control', async () => {
      stub.clearProbeRoutes();
      const { stdout } = await cli(['--realm', '99', '--probe-upload', '--yes']);
      assert.match(stdout, /auth and headers are accepted/);
      assert.match(stdout, /good evidence there is no upload endpoint/);
    });

    it('refuses to interpret the run when the positive control fails', async () => {
      stub.clearProbeRoutes();
      // Break only the known-good route; everything else still 404s.
      stub.setProbeRoute('GET /archive/download/world/99/2/latest', { status: 401, body: 'nope' });
      const { stdout, stderr } = await cli(['--realm', '99', '--probe-upload', '--yes']);

      const out = stdout + stderr;
      assert.match(out, /known-good Bedrock route did not succeed/);
      assert.match(out, /nothing else here is/);
      // It must not go on to draw a conclusion from meaningless 404s.
      assert.doesNotMatch(out, /good evidence there is no upload endpoint/);
      stub.clearProbeRoutes();
    });

    it('flags when the host also answers Java-shaped routes', async () => {
      stub.clearProbeRoutes();
      stub.setProbeRoute('GET /worlds/99/slot/2/download', {
        status: 200,
        json: { downloadLink: 'http://example/x' },
      });
      const { stdout, stderr } = await cli(['--realm', '99', '--probe-upload', '--yes']);
      const out = stdout + stderr;

      assert.match(out, /ALSO answers the Java-shaped download route/);
      assert.match(out, /plausible here/);
      stub.clearProbeRoutes();
    });

    it('notes the Java route being absent as expected for Bedrock', async () => {
      stub.clearProbeRoutes();
      const { stdout } = await cli(['--realm', '99', '--probe-upload', '--yes']);
      assert.match(stdout, /Java-shaped download route is absent/);
      assert.match(stdout, /come from the Java API/);
    });

    it('probes GET before PUT so a 405 can prove a path exists', async () => {
      stub.clearProbeRoutes();
      stub.requests.length = 0;
      await cli(['--realm', '99', '--probe-upload', '--yes']);

      const upload = stub.requests.filter((r) => r.endsWith('/worlds/99/backups/upload'));
      assert.deepEqual(upload, [
        'GET /worlds/99/backups/upload',
        'PUT /worlds/99/backups/upload',
      ]);
    });

    it('flags a 405 as proof the path exists', async () => {
      stub.clearProbeRoutes();
      stub.setProbeRoute('GET /worlds/99/backups/upload', { status: 405, body: 'nope' });
      const { stdout } = await cli(['--realm', '99', '--probe-upload', '--yes']);

      assert.match(stdout, /405 path EXISTS/);
      assert.match(stdout, /returned something other than 404/);
    });

    it('surfaces the body and recognises upload info when a route responds', async () => {
      stub.clearProbeRoutes();
      stub.setProbeRoute('PUT /worlds/99/backups/upload', {
        status: 200,
        json: {
          worldClosed: true,
          token: 'upload-token',
          uploadEndpoint: 'https://blob.example/upload',
          port: 443,
        },
      });
      const { stdout } = await cli(['--realm', '99', '--probe-upload', '--yes']);

      assert.match(stdout, /200 RESPONDED/);
      assert.match(stdout, /uploadEndpoint/);
      assert.match(stdout, /Looks like upload info/);
      // The operator needs the raw body to implement the next step.
      assert.match(stdout, /blob\.example/);
    });

    it('moves to stage 2 with safe methods when a route returns an upload target', async () => {
      stub.clearProbeRoutes();
      stub.requests.length = 0;
      // A JWT whose payload carries the claims the real service was seen to
      // issue; the signature is irrelevant because we only display claims.
      const claims = Buffer.from(
        JSON.stringify({ upload_id: 'abc123', region: 'TEST_REGION', exp: 1788319777 }),
      ).toString('base64url');
      stub.setProbeRoute('GET /archive/upload/world/99/2', {
        status: 200,
        json: { uploadUrl: `${stub.host}/upload-host`, token: `h.${claims}.s` },
      });
      stub.setProbeRoute('GET /upload-host', { status: 405, body: 'use POST' });
      const { stdout } = await cli(['--realm', '99', '--probe-upload', '--yes']);

      assert.match(stdout, /Stage 2/);
      assert.match(stdout, /upload_id=abc123/);
      assert.match(stdout, /region=TEST_REGION/);
      for (const method of ['OPTIONS', 'HEAD', 'GET']) {
        assert.ok(
          stub.requests.includes(`${method} /upload-host`),
          `stage 2 should ${method} the upload host`,
        );
      }
      assert.ok(
        !stub.requests.some((r) => (r.startsWith('PUT') || r.startsWith('POST')) && r.includes('/upload-host')),
        'stage 2 must never write to the upload host',
      );
    });

    it('accepts extra candidate routes via --probe-path', async () => {
      stub.clearProbeRoutes();
      stub.requests.length = 0;
      await cli([
        '--realm',
        '99',
        '--probe-upload',
        '--yes',
        '--probe-path',
        'POST:/worlds/{id}/custom/{slot}',
      ]);

      assert.ok(stub.requests.includes('POST /worlds/99/custom/2'));
    });

    it('rejects a malformed --probe-path', async () => {
      const err = await cli(['--realm', '99', '--probe-upload', '--yes', '--probe-path', 'garbage']).then(
        () => null,
        (e: { stdout?: string; stderr?: string }) => e,
      );
      assert.ok(err, 'expected a non-zero exit');
      assert.match(`${err.stdout ?? ''}${err.stderr ?? ''}`, /probe-path entries look like/);
    });

    it('requires --realm', async () => {
      const err = await cli(['--probe-upload', '--yes']).then(
        () => null,
        (e: { stdout?: string; stderr?: string }) => e,
      );
      assert.ok(err, 'expected a non-zero exit');
      assert.match(`${err.stdout ?? ''}${err.stderr ?? ''}`, /needs --realm/);
    });
  });
});
