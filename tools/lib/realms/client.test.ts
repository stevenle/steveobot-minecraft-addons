/**
 * Tests for the Realms client against a local stand-in for the service.
 *
 * The real service cannot be reached from CI, and signing in requires a
 * Microsoft account, so these tests pin down everything that does not need the
 * live API: the headers the service demands, retry behaviour, error reporting,
 * response parsing, and streaming a world archive to disk.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import type { AddressInfo } from 'node:net';

import { RealmsApiError, RealmsClient } from './client.ts';

interface RecordedRequest {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
}

interface Stub {
  status?: number;
  json?: unknown;
  body?: Buffer | string;
  contentType?: string;
  allow?: string;
}

interface StubServer {
  host: string;
  requests: RecordedRequest[];
  queue: (route: string, ...responses: Stub[]) => void;
  close: () => Promise<void>;
}

/** A tiny HTTP server that replays queued responses and records requests. */
async function startStubServer(): Promise<StubServer> {
  const requests: RecordedRequest[] = [];
  const responses = new Map<string, Stub[]>();

  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      requests.push({
        method: req.method ?? '',
        url: req.url ?? '',
        headers: req.headers,
        body: Buffer.concat(chunks),
      });
      const pending = responses.get(req.url ?? '');
      // Queued stubs are consumed in order; a single stub is reused.
      const stub = pending && pending.length > 1 ? pending.shift() : pending?.[0];

      if (stub === undefined) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('no stub');
        return;
      }
      if (stub.json !== undefined) {
        res.writeHead(stub.status ?? 200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(stub.json));
        return;
      }
      const headers: Record<string, string> = { 'Content-Type': stub.contentType ?? 'text/plain' };
      if (stub.allow !== undefined) headers['Allow'] = stub.allow;
      res.writeHead(stub.status ?? 200, headers);
      res.end(stub.body ?? '');
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    host: `http://127.0.0.1:${port}`,
    requests,
    queue: (route, ...stubs) => responses.set(route, stubs),
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

const AUTH = 'XBL3.0 x=userhash;xstoken';

describe('RealmsClient', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'realms-test-'));
  after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  it('sends the headers the Realms service requires', async () => {
    const server = await startStubServer();
    try {
      server.queue('/worlds', { json: { servers: [] } });
      await new RealmsClient({ authorization: AUTH, host: server.host }).listRealms();

      const request = server.requests[0];
      assert.ok(request);
      assert.equal(request.headers['authorization'], AUTH);
      assert.equal(request.headers['user-agent'], 'MCPE/UWP');
      // A missing Client-Version is rejected by the real service.
      assert.ok(request.headers['client-version']);
      assert.equal(request.headers['is-prerelease'], undefined);
    } finally {
      await server.close();
    }
  });

  it('marks requests as prerelease for Preview Realms', async () => {
    const server = await startStubServer();
    try {
      server.queue('/worlds', { json: { servers: [] } });
      await new RealmsClient({
        authorization: AUTH,
        host: server.host,
        usePreview: true,
      }).listRealms();

      assert.equal(server.requests[0]?.headers['is-prerelease'], 'true');
    } finally {
      await server.close();
    }
  });

  it('parses the realm list and tolerates a missing servers array', async () => {
    const server = await startStubServer();
    try {
      server.queue('/worlds', {
        json: { servers: [{ id: 42, name: 'Test Realm', state: 'OPEN', activeSlot: 1 }] },
      });
      const client = new RealmsClient({ authorization: AUTH, host: server.host });
      const realms = await client.listRealms();
      assert.equal(realms.length, 1);
      assert.equal(realms[0]?.id, 42);

      server.queue('/worlds', { json: {} });
      assert.deepEqual(await client.listRealms(), []);
    } finally {
      await server.close();
    }
  });

  it('retries 5xx responses and then succeeds', async () => {
    const server = await startStubServer();
    try {
      server.queue(
        '/worlds',
        { status: 503, body: 'unavailable' },
        { status: 503, body: 'unavailable' },
        { json: { servers: [{ id: 7 }] } },
      );
      const client = new RealmsClient({
        authorization: AUTH,
        host: server.host,
        retryBaseMs: 1,
      });
      const realms = await client.listRealms();
      assert.equal(realms[0]?.id, 7);
      assert.equal(server.requests.length, 3);
    } finally {
      await server.close();
    }
  });

  it('does not retry 4xx and surfaces status and body', async () => {
    const server = await startStubServer();
    try {
      server.queue('/worlds', { status: 403, body: 'Forbidden: not a member' });
      const client = new RealmsClient({
        authorization: AUTH,
        host: server.host,
        retryBaseMs: 1,
      });

      const err = await client.listRealms().then(
        () => null,
        (e: unknown) => e,
      );
      assert.ok(err instanceof RealmsApiError);
      assert.equal(err.status, 403);
      assert.match(err.body, /not a member/);
      assert.equal(server.requests.length, 1, 'a 4xx must not be retried');
    } finally {
      await server.close();
    }
  });

  it('gives up after maxRetries on a persistent 5xx', async () => {
    const server = await startStubServer();
    try {
      server.queue('/worlds', { status: 500, body: 'boom' });
      const client = new RealmsClient({
        authorization: AUTH,
        host: server.host,
        maxRetries: 2,
        retryBaseMs: 1,
      });
      await assert.rejects(() => client.listRealms(), RealmsApiError);
      assert.equal(server.requests.length, 3, 'initial attempt plus two retries');
    } finally {
      await server.close();
    }
  });

  it('accepts either downloadLink or downloadUrl, and rejects neither', async () => {
    const server = await startStubServer();
    try {
      const client = new RealmsClient({
        authorization: AUTH,
        host: server.host,
        retryBaseMs: 1,
      });

      server.queue('/archive/download/world/42/1/latest', {
        json: { downloadLink: 'http://example/a.mcworld', token: 'tok', size: 123 },
      });
      const a = await client.getWorldDownload(42, 1);
      assert.equal(a.downloadUrl, 'http://example/a.mcworld');
      assert.equal(a.token, 'tok');
      assert.equal(a.size, 123);

      server.queue('/archive/download/world/42/2/latest', {
        json: { downloadUrl: 'http://example/b.mcworld' },
      });
      const b = await client.getWorldDownload(42, 2);
      assert.equal(b.downloadUrl, 'http://example/b.mcworld');
      assert.equal(b.token, undefined);

      server.queue('/archive/download/world/42/3/latest', { json: {} });
      await assert.rejects(() => client.getWorldDownload(42, 3), /no download link/i);
    } finally {
      await server.close();
    }
  });

  it('requests the named backup rather than latest when one is given', async () => {
    const server = await startStubServer();
    try {
      server.queue('/archive/download/world/42/1/backup-id-1', {
        json: { downloadLink: 'http://example/x' },
      });
      await new RealmsClient({ authorization: AUTH, host: server.host }).getWorldDownload(
        42,
        1,
        'backup-id-1',
      );
      assert.equal(server.requests[0]?.url, '/archive/download/world/42/1/backup-id-1');
    } finally {
      await server.close();
    }
  });

  it('fetches an upload target and rejects a response missing one', async () => {
    const server = await startStubServer();
    try {
      const client = new RealmsClient({ authorization: AUTH, host: server.host });

      server.queue('/archive/upload/world/42/2', {
        json: { uploadUrl: 'http://upload.example/worlds', token: 'jwt-token' },
      });
      const info = await client.getWorldUploadInfo(42, 2);
      assert.equal(info.uploadUrl, 'http://upload.example/worlds');
      assert.equal(info.token, 'jwt-token');
      assert.equal(server.requests[0]?.url, '/archive/upload/world/42/2');

      server.queue('/archive/upload/world/42/3', { json: { uploadUrl: 'http://x' } });
      await assert.rejects(() => client.getWorldUploadInfo(42, 3), /no upload target/i);
    } finally {
      await server.close();
    }
  });

  it('probes absolute URLs with a bearer token in place of Realms headers', async () => {
    const server = await startStubServer();
    try {
      server.queue('/upload-host', { status: 405, body: 'nope' });
      const client = new RealmsClient({ authorization: AUTH, host: 'http://unused.invalid' });
      const result = await client.probe('OPTIONS', `${server.host}/upload-host`, {
        bearer: 'jwt-token',
      });

      assert.equal(result.status, 405);
      const request = server.requests[0];
      assert.ok(request);
      assert.equal(request.headers['authorization'], 'Bearer jwt-token');
      assert.equal(request.headers['client-version'], undefined, 'Realms headers must not leak');
    } finally {
      await server.close();
    }
  });

  it('captures the Allow header a probe gets back', async () => {
    const server = await startStubServer();
    try {
      server.queue('/probe-me', { status: 405, body: '', allow: 'POST, PUT' });
      const client = new RealmsClient({ authorization: AUTH, host: server.host });
      const result = await client.probe('GET', '/probe-me');
      assert.equal(result.allow, 'POST, PUT');
    } finally {
      await server.close();
    }
  });

  it('closes and reopens a Realm via the prismarine-realms state routes', async () => {
    const server = await startStubServer();
    try {
      const client = new RealmsClient({ authorization: AUTH, host: server.host });
      // The real endpoints answer an empty or bare-boolean body; both must be
      // tolerated.
      server.queue('/worlds/42/close', { body: '' });
      server.queue('/worlds/42/open', { body: 'true' });

      await client.closeRealm(42);
      await client.openRealm(42);

      assert.equal(server.requests[0]?.method, 'PUT');
      assert.equal(server.requests[0]?.url, '/worlds/42/close');
      assert.equal(server.requests[1]?.method, 'PUT');
      assert.equal(server.requests[1]?.url, '/worlds/42/open');
    } finally {
      await server.close();
    }
  });

  it('surfaces a refused state change as a RealmsApiError', async () => {
    const server = await startStubServer();
    try {
      server.queue('/worlds/42/close', { status: 403, body: 'Forbidden' });
      await assert.rejects(
        () => new RealmsClient({ authorization: AUTH, host: server.host }).closeRealm(42),
        RealmsApiError,
      );
    } finally {
      await server.close();
    }
  });

  it('POSTs a world archive with the bearer token and mcworld content type', async () => {
    const server = await startStubServer();
    try {
      const client = new RealmsClient({ authorization: AUTH, host: 'http://unused.invalid' });
      const archive = Buffer.from('pretend mcworld bytes');

      server.queue('/upload-sink', { json: { ok: true } });
      const result = await client.uploadWorldArchive(
        { uploadUrl: `${server.host}/upload-sink`, token: 'up-token' },
        archive,
      );
      assert.equal(result.status, 200);

      const request = server.requests[0];
      assert.ok(request);
      assert.equal(request.method, 'POST');
      assert.equal(request.headers['authorization'], 'Bearer up-token');
      assert.equal(request.headers['content-type'], 'application/x-mcworld');
      assert.deepEqual(request.body, archive, 'the archive must arrive byte-for-byte');
    } finally {
      await server.close();
    }
  });

  it('reports an upload rejection instead of throwing', async () => {
    const server = await startStubServer();
    try {
      server.queue('/upload-sink', { status: 403, body: 'HTTP 403 Forbidden' });
      const result = await new RealmsClient({
        authorization: AUTH,
        host: server.host,
      }).uploadWorldArchive(
        { uploadUrl: `${server.host}/upload-sink`, token: 'up-token' },
        Buffer.from('bytes'),
      );
      assert.equal(result.status, 403);
      assert.match(result.body, /Forbidden/);
    } finally {
      await server.close();
    }
  });

  it('streams a world archive to disk with the bearer token attached', async () => {
    const server = await startStubServer();
    try {
      const payload = Buffer.from('pretend mcworld archive contents');
      server.queue('/world.mcworld', { body: payload, contentType: 'application/octet-stream' });

      const dest = path.join(tmpDir, 'out.mcworld');
      const written = await new RealmsClient({
        authorization: AUTH,
        host: server.host,
      }).downloadWorldTo(
        { downloadUrl: `${server.host}/world.mcworld`, token: 'dl-token', size: payload.length },
        dest,
      );

      assert.equal(written, payload.length);
      assert.deepEqual(fs.readFileSync(dest), payload);
      assert.equal(server.requests[0]?.headers['authorization'], 'Bearer dl-token');
    } finally {
      await server.close();
    }
  });

  it('reports a failed archive download rather than writing a truncated file', async () => {
    const server = await startStubServer();
    try {
      server.queue('/world.mcworld', { status: 403, body: 'link expired' });
      const dest = path.join(tmpDir, 'bad.mcworld');
      await assert.rejects(
        () =>
          new RealmsClient({ authorization: AUTH, host: server.host }).downloadWorldTo(
            { downloadUrl: `${server.host}/world.mcworld`, token: undefined, size: undefined },
            dest,
          ),
        RealmsApiError,
      );
      assert.equal(fs.existsSync(dest), false, 'no file should be left behind');
    } finally {
      await server.close();
    }
  });
});
