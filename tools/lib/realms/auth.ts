/**
 * Microsoft OAuth for the Bedrock Realms service.
 *
 * The chain is: Microsoft device-code OAuth -> Xbox Live user token -> XSTS
 * token scoped to the Realms relying party. `prismarine-auth` implements all
 * three hops and caches the results, so this module only picks the right
 * relying party and formats the header the service expects.
 *
 * Nothing here sees a password. Device-code auth means the browser sign-in
 * happens on Microsoft's own page; we only ever hold the resulting tokens, and
 * they live in the cache directory below.
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

// prismarine-auth is CommonJS and builds its exports with inline require()
// calls, which Node's CJS-to-ESM lexer cannot see. `import { Authflow }` type-
// checks but throws at runtime, so take module.exports directly.
const require = createRequire(import.meta.url);
const { Authflow, Titles } = require('prismarine-auth') as typeof import('prismarine-auth');

/**
 * XSTS relying party for Bedrock Realms. A token minted for any other relying
 * party is rejected by the service.
 */
export const REALMS_RELYING_PARTY = 'https://pocket.realms.minecraft.net/';

/**
 * Where cached Microsoft/Xbox tokens are written: REALMS_AUTH_DIR if set,
 * otherwise $XDG_CONFIG_HOME/steveobot-minecraft-addons/realms-auth, which is
 * ~/.config/... on every platform this tooling runs on. It lives outside the
 * repository so every checkout and worktree shares one sign-in, and so the
 * tokens can never end up in a commit.
 */
export const DEFAULT_CACHE_DIR = resolveCacheDir();

function resolveCacheDir(): string {
  const override = process.env['REALMS_AUTH_DIR'];
  if (override !== undefined && override !== '') return path.resolve(override);
  const xdg = process.env['XDG_CONFIG_HOME'];
  const configHome = xdg !== undefined && xdg !== '' ? xdg : path.join(os.homedir(), '.config');
  return path.join(configHome, 'steveobot-minecraft-addons', 'realms-auth');
}

export type AuthFlowKind = 'live' | 'msal' | 'sisu';

export interface DeviceCodePrompt {
  /** Code the user types on the Microsoft sign-in page. */
  user_code: string;
  /** URL the user opens. */
  verification_uri: string;
  /** Microsoft's own pre-formatted instruction sentence. */
  message: string;
}

export interface RealmsAuthOptions {
  /** Cache key. Any stable string; use an email to keep multiple accounts apart. */
  username?: string;
  cacheDir?: string;
  /**
   * Auth flow. `live` with the Nintendo Switch title is what Realms accepts and
   * is prismarine-auth's own default for this case; the others are here so a
   * future service-side change can be worked around without a code edit.
   */
  flow?: AuthFlowKind;
  /** Called with the code and URL the user must visit, on first sign-in. */
  onDeviceCode?: (prompt: DeviceCodePrompt) => void;
}

export interface RealmsAuthorization {
  /** Value for the `Authorization` header. */
  header: string;
  /** Xbox user id of the signed-in account. */
  xuid: string;
  /** Epoch ms at which the XSTS token expires. */
  expiresOn: number;
}

/**
 * Signs in (or reuses a cached token) and returns the `XBL3.0` authorization
 * header for the Realms service.
 *
 * Setting REALMS_AUTHORIZATION skips the sign-in entirely and uses that header
 * verbatim. That is the escape hatch for a token obtained elsewhere, and it is
 * what lets the pipeline be tested against a stand-in server.
 */
export async function authorizeRealms(
  options: RealmsAuthOptions = {},
): Promise<RealmsAuthorization> {
  const preset = process.env['REALMS_AUTHORIZATION'];
  if (preset !== undefined && preset !== '') {
    return { header: preset, xuid: 'preset', expiresOn: 0 };
  }

  const {
    username = 'default',
    cacheDir = DEFAULT_CACHE_DIR,
    flow = 'live',
    onDeviceCode,
  } = options;

  // prismarine-auth creates the folder too, but with default permissions;
  // these are live account tokens, so keep them readable by this user only.
  fs.mkdirSync(cacheDir, { recursive: true, mode: 0o700 });

  const authflow = new Authflow(
    username,
    cacheDir,
    { flow, authTitle: Titles.MinecraftNintendoSwitch, deviceType: 'Nintendo' },
    onDeviceCode === undefined ? undefined : (res) => onDeviceCode(res),
  );

  const token = await authflow.getXboxToken(REALMS_RELYING_PARTY);

  return {
    header: `XBL3.0 x=${token.userHash};${token.XSTSToken}`,
    xuid: token.userXUID,
    expiresOn: token.expiresOn,
  };
}
