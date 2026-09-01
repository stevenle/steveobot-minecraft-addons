/**
 * Minimal typed client for the undocumented Bedrock Realms service.
 *
 * Only the endpoints this repo needs are implemented: listing the Realms an
 * account can see, and downloading a Realm's current world. There is
 * deliberately no upload method — the service exposes no endpoint for
 * replacing world content, so anything claiming to do so would be a lie. The
 * world still has to go back via the client's "Replace World".
 *
 * Endpoints and headers verified against PrismarineJS/prismarine-realms, the
 * reference open-source implementation.
 */
import fs from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

import type { RealmSummary, WorldDownload } from './types.ts';

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
