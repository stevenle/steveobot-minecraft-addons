import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const DEPLOY_TARGETS = ['stable', 'preview', 'education'] as const;

export type DeployTarget = (typeof DEPLOY_TARGETS)[number];

export function isDeployTarget(value: string): value is DeployTarget {
  return (DEPLOY_TARGETS as readonly string[]).includes(value);
}

/**
 * Known install locations of the `com.mojang` data folder, keyed by deploy
 * target. Everything is expressed as a list of candidates because the same
 * target lives in different places depending on platform (native Windows, WSL,
 * or a Linux/macOS launcher).
 */
const WINDOWS_PACKAGES: Partial<Record<DeployTarget, string>> = {
  stable: 'Microsoft.MinecraftUWP_8wekyb3d8bbwe',
  preview: 'Microsoft.MinecraftWindowsBeta_8wekyb3d8bbwe',
};

function windowsCandidates(target: DeployTarget): string[] {
  const localAppData = process.env['LOCALAPPDATA'];
  const appData = process.env['APPDATA'];

  if (target === 'education') {
    return appData ? [path.join(appData, 'Minecraft Education Edition', 'games', 'com.mojang')] : [];
  }
  const pkg = WINDOWS_PACKAGES[target];
  if (!pkg || !localAppData) return [];
  return [path.join(localAppData, 'Packages', pkg, 'LocalState', 'games', 'com.mojang')];
}

/** Windows installs reachable from inside WSL through the /mnt/c mount. */
function wslCandidates(target: DeployTarget): string[] {
  const usersDir = '/mnt/c/Users';
  if (!fs.existsSync(usersDir)) return [];

  let users: string[];
  try {
    users = fs
      .readdirSync(usersDir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !['Public', 'Default', 'All Users'].includes(e.name))
      .map((e) => e.name);
  } catch {
    return [];
  }

  const out: string[] = [];
  for (const user of users) {
    if (target === 'education') {
      out.push(path.join(usersDir, user, 'AppData/Roaming/Minecraft Education Edition/games/com.mojang'));
      continue;
    }
    const pkg = WINDOWS_PACKAGES[target];
    if (!pkg) continue;
    out.push(path.join(usersDir, user, 'AppData/Local/Packages', pkg, 'LocalState/games/com.mojang'));
  }
  return out;
}

/** Community Linux launcher (mcpelauncher). */
function unixCandidates(): string[] {
  const home = os.homedir();
  return [
    path.join(home, '.local/share/mcpelauncher/games/com.mojang'),
    path.join(home, 'Library/Application Support/mcpelauncher/games/com.mojang'),
  ];
}

export interface MojangResolution {
  /** The folder to deploy into, or null when nothing was found. */
  dir: string | null;
  /** Human-readable explanation of where `dir` came from. */
  source: string | null;
  /** Every path considered, so a failure can print something actionable. */
  checked: string[];
}

/**
 * Resolves the `com.mojang` folder to deploy into.
 *
 * Resolution order: the explicit `dir` argument, then the MINECRAFT_COM_MOJANG
 * environment variable, then the known per-platform locations for `target`.
 */
export function resolveMojangDir(
  options: { target?: DeployTarget; dir?: string | undefined } = {},
): MojangResolution {
  const { target = 'stable', dir } = options;

  if (dir) {
    return { dir: path.resolve(dir), source: 'the --dir flag', checked: [] };
  }
  const fromEnv = process.env['MINECRAFT_COM_MOJANG'];
  if (fromEnv) {
    return { dir: path.resolve(fromEnv), source: 'MINECRAFT_COM_MOJANG', checked: [] };
  }

  const checked = [...windowsCandidates(target), ...wslCandidates(target), ...unixCandidates()];

  for (const candidate of checked) {
    if (fs.existsSync(candidate)) {
      return { dir: candidate, source: `the detected ${target} install`, checked };
    }
  }
  return { dir: null, source: null, checked };
}
