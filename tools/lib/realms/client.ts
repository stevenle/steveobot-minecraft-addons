/**
 * Minimal typed client for the undocumented Bedrock Realms service.
 *
 * Only the endpoints this repo needs are implemented: listing the Realms an
 * account can see, downloading a Realm's current world, and the two-stage
 * upload flow — fetch an upload target for a slot, then POST the archive to
 * it. Both stages were built from responses captured live on 2026-09-01, not
 * from guesses; see `--probe-upload` in tools/realm.ts for how.
 *
 * Endpoints and headers verified against PrismarineJS/prismarine-realms, the
 * reference open-source implementation.
 */
import fs from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

import type { ProbeResult, RealmSummary, WorldDownload, WorldUploadInfo } from './types.ts';

export const REALMS_HOST = 'https://pocket.realms.minecraft.net';

/** The service rejects requests without a client version and matching agent. */
const DEFAULT_CLIENT_VERSION = '1.26.40';
const USER_AGENT = 'MCPE/UWP';

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface RealmsClientOptions {
  /** `XBL3.0 x=<hash>;<token>` from `authorizeRealms()`. */
  authorization: string;
  /** Reported to the service; should roughly track the game version. */
  minecraftVersion?: string;
  /** Target Preview Realms, which hold entirely separate worlds. */
  usePreview?: boolean;
  /** Overridable for tests. */
  host?: string;
  fetchImpl?: FetchLike;
  /** 5xx responses are retried with backoff; the service is known to flap. */
  maxRetries?: number;
  /** Backoff base in ms; lowered by tests. */
  retryBaseMs?: number;
}

/** Thrown for any non-2xx response, carrying enough context to act on. */
export class RealmsApiError extends Error {
  readonly status: number;
  readonly body: string;

  constructor(status: number, statusText: string, body: string, url: string) {
    super(`Realms API ${status} ${statusText} for ${url}${body ? `: ${body}` : ''}`);
    this.name = 'RealmsApiError';
    this.status = status;
    this.body = body;
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export class RealmsClient {
  readonly #authorization: string;
  readonly #host: string;
  readonly #fetch: FetchLike;
  readonly #minecraftVersion: string;
  readonly #usePreview: boolean;
  readonly #maxRetries: number;
  readonly #retryBaseMs: number;

  constructor(options: RealmsClientOptions) {
    this.#authorization = options.authorization;
    this.#host = options.host ?? REALMS_HOST;
    this.#fetch = options.fetchImpl ?? ((url, init) => fetch(url, init));
    this.#minecraftVersion = options.minecraftVersion ?? DEFAULT_CLIENT_VERSION;
    this.#usePreview = options.usePreview ?? false;
    this.#maxRetries = options.maxRetries ?? 4;
    this.#retryBaseMs = options.retryBaseMs ?? 1000;
  }

  #headers(): Record<string, string> {
    const headers: Record<string, string> = {
      Authorization: this.#authorization,
      'Client-Version': this.#minecraftVersion,
      'User-Agent': USER_AGENT,
    };
    if (this.#usePreview) {
      headers['is-prerelease'] = 'true';
    }
    return headers;
  }

  async #get<T>(route: string): Promise<T> {
    const url = `${this.#host}${route}`;

    for (let attempt = 0; ; attempt++) {
      const response = await this.#fetch(url, { method: 'GET', headers: this.#headers() });

      if (response.ok) {
        return (await response.json()) as T;
      }
      // 5xx from this service is usually transient; anything else is real.
      if (response.status >= 500 && response.status < 600 && attempt < this.#maxRetries) {
        await sleep(2 ** attempt * this.#retryBaseMs);
        continue;
      }
      throw new RealmsApiError(response.status, response.statusText, await response.text(), url);
    }
  }

  /**
   * PUTs to a route and tolerates an empty or non-JSON body, which is what the
   * state-change endpoints answer with. No retry: unlike the GETs, a repeated
   * state change is a second action, not a second attempt.
   */
  async #put<T>(route: string): Promise<T | undefined> {
    const url = `${this.#host}${route}`;
    const response = await this.#fetch(url, { method: 'PUT', headers: this.#headers() });
    if (!response.ok) {
      throw new RealmsApiError(response.status, response.statusText, await response.text(), url);
    }
    const text = await response.text();
    try {
      return text === '' ? undefined : (JSON.parse(text) as T);
    } catch {
      return undefined;
    }
  }

  /**
   * Closes the Realm, disconnecting players, via `PUT /worlds/{id}/close` —
   * prismarine-realms' `changeRealmState`, shared by its Bedrock client. The
   * upload flow offers this because a third upload-session request answered
   * 403 "Could not set upload state" (observed live, 2026-09-01), and the
   * Java flow closes the Realm before uploading; whether closing is what
   * clears that refusal is still unconfirmed.
   */
  async closeRealm(realmId: number): Promise<void> {
    await this.#put(`/worlds/${realmId}/close`);
  }

  /** Reopens the Realm; the counterpart of `closeRealm`. */
  async openRealm(realmId: number): Promise<void> {
    await this.#put(`/worlds/${realmId}/open`);
  }

  /** Realms the signed-in account owns or has joined. */
  async listRealms(): Promise<RealmSummary[]> {
    const data = await this.#get<{ servers?: RealmSummary[] }>('/worlds');
    return data.servers ?? [];
  }

  /**
   * Gets a time-limited download for a Realm's world.
   *
   * `backupId` defaults to `latest`, which is the world as it stands right now
   * rather than the most recent scheduled backup.
   */
  async getWorldDownload(
    realmId: number,
    slotId: number,
    backupId: string = 'latest',
  ): Promise<WorldDownload> {
    const data = await this.#get<{ downloadLink?: string; downloadUrl?: string; token?: string; size?: number }>(
      `/archive/download/world/${realmId}/${slotId}/${encodeURIComponent(backupId)}`,
    );
    const downloadUrl = data.downloadLink ?? data.downloadUrl;
    if (downloadUrl === undefined) {
      throw new Error('Realms returned no download link for this world.');
    }
    return { downloadUrl, token: data.token, size: data.size };
  }

  /**
   * Gets a time-limited upload target for a Realm's world slot.
   *
   * This is stage 1 of the upload flow and the only part captured from the
   * live service: it answers with the upload host's URL and a short-lived JWT
   * scoped to the world and slot. Nothing is uploaded here, and the client has
   * no method that does — the stage-2 protocol for sending bytes to
   * `uploadUrl` is unknown, so this exists for `--probe-upload` discovery and
   * as the base for a real upload once that protocol is captured too.
   */
  async getWorldUploadInfo(realmId: number, slotId: number): Promise<WorldUploadInfo> {
    const data = await this.#get<{ uploadUrl?: string; token?: string }>(
      `/archive/upload/world/${realmId}/${slotId}`,
    );
    if (data.uploadUrl === undefined || data.token === undefined) {
      throw new Error('Realms returned no upload target for this world.');
    }
    return { uploadUrl: data.uploadUrl, token: data.token };
  }

  /**
   * POSTs a `.mcworld` archive to the upload host — stage 2 of the upload
   * flow, implemented from captured evidence rather than guesswork: OPTIONS on
   * `uploadUrl` answered `Allow: HEAD, POST, GET, OPTIONS`, and the route
   * serves `application/x-mcworld`, both captured live on 2026-09-01.
   *
   * The response to a successful POST has never been observed, so this does
   * not throw on a non-2xx: it reports whatever came back and leaves judgement
   * to the caller, exactly like `probe`.
   */
  async uploadWorldArchive(info: WorldUploadInfo, archive: Uint8Array): Promise<ProbeResult> {
    const response = await this.#fetch(info.uploadUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${info.token}`,
        'Content-Type': 'application/x-mcworld',
      },
      body: archive,
    });
    const text = await response.text();
    return {
      method: 'POST',
      route: info.uploadUrl,
      status: response.status,
      statusText: response.statusText,
      contentType: response.headers.get('content-type') ?? undefined,
      allow: response.headers.get('allow') ?? undefined,
      body: text.length > 2000 ? `${text.slice(0, 2000)}... (truncated)` : text,
      networkError: undefined,
    };
  }

  /**
   * Sends a single request to an arbitrary route and reports what came back,
   * without throwing on a non-2xx. This exists to establish whether an endpoint
   * the service has never documented is actually there.
   *
   * Note the useful asymmetry: 404 means the route does not exist, while 405
   * means it does but rejects this method — so a GET can prove a path exists
   * without invoking whatever a PUT to it would do.
   *
   * `route` may be an absolute URL for probing a host other than the Realms
   * API (the upload service, say); `bearer` then replaces the Realms headers,
   * matching how the download host is authenticated.
   */
  async probe(
    method: string,
    route: string,
    options: { body?: string; bearer?: string } = {},
  ): Promise<ProbeResult> {
    const url = /^https?:\/\//.test(route) ? route : `${this.#host}${route}`;
    const headers: Record<string, string> =
      options.bearer !== undefined ? { Authorization: `Bearer ${options.bearer}` } : this.#headers();
    const init: RequestInit = { method, headers };
    if (options.body !== undefined) {
      init.body = options.body;
      init.headers = { ...headers, 'Content-Type': 'application/json' };
    }

    try {
      const response = await this.#fetch(url, init);
      const text = await response.text();
      return {
        method,
        route,
        status: response.status,
        statusText: response.statusText,
        contentType: response.headers.get('content-type') ?? undefined,
        allow: response.headers.get('allow') ?? undefined,
        body: text.length > 2000 ? `${text.slice(0, 2000)}... (truncated)` : text,
        networkError: undefined,
      };
    } catch (err) {
      return {
        method,
        route,
        status: 0,
        statusText: '',
        contentType: undefined,
        allow: undefined,
        body: '',
        networkError: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /** Streams a world archive to `destPath`. Returns the bytes written. */
  async downloadWorldTo(download: WorldDownload, destPath: string): Promise<number> {
    const headers: Record<string, string> = {};
    if (download.token !== undefined) {
      headers['Authorization'] = `Bearer ${download.token}`;
    }

    const response = await this.#fetch(download.downloadUrl, { method: 'GET', headers });
    if (!response.ok) {
      throw new RealmsApiError(
        response.status,
        response.statusText,
        await response.text(),
        download.downloadUrl,
      );
    }
    if (response.body === null) {
      throw new Error('Realms world download returned an empty response body.');
    }

    await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(destPath));
    return fs.statSync(destPath).size;
  }
}
