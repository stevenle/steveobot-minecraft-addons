/**
 * Shapes returned by the Bedrock Realms service.
 *
 * This API is undocumented and unversioned: Mojang can change or withdraw it
 * without notice. Every field here is optional-tolerant on purpose — the client
 * narrows what it needs and ignores the rest, so an added or renamed field
 * elsewhere in the payload does not break us.
 */

/** One entry of `GET /worlds`. */
export interface RealmSummary {
  id: number;
  name: string;
  motd: string;
  /** OPEN, CLOSED, ... */
  state: string;
  owner: string;
  ownerUUID: string;
  expired: boolean;
  /** Which of the Realm's world slots is live. */
  activeSlot: number;
  /** False when the account was invited but has not joined. */
  member: boolean;
}

/** Response of `GET /archive/download/world/{realmId}/{slot}/{backupId}`. */
export interface WorldDownload {
  /** Time-limited URL to the .mcworld archive. */
  downloadUrl: string;
  /** Bearer token for the download URL, when the service supplies one. */
  token: string | undefined;
  /** Archive size in bytes, when reported. */
  size: number | undefined;
}

/**
 * Response of `GET /archive/upload/world/{realmId}/{slot}` — stage 1 of the
 * upload flow, captured against the live service on 2026-09-01. The protocol
 * for sending world bytes to `uploadUrl` (stage 2) is still uncaptured.
 */
export interface WorldUploadInfo {
  /** Base URL of the upload service, a different host from the Realms API. */
  uploadUrl: string;
  /** Short-lived JWT scoped to this world and slot. Never log it. */
  token: string;
}

/** Result of poking an endpoint whose existence is unknown. */
export interface ProbeResult {
  method: string;
  route: string;
  status: number;
  statusText: string;
  contentType: string | undefined;
  /** `Allow` header, the payoff of a 405: the methods the route does accept. */
  allow: string | undefined;
  /** Response body, truncated. */
  body: string;
  /** Set when the request never completed (DNS, TLS, connection). */
  networkError: string | undefined;
}
